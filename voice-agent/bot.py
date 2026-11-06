"""Servidor del agente de voz: hace llamadas por Twilio y conversa con Pipecat.

    uvicorn bot:app --port 8000

Endpoints:
    POST /llamar/{deudor_id}  Llama a un deudor (si las reglas de contacto lo permiten).
    POST /campana             Llama a todos los deudores que se pueden contactar ahora.
    WS   /ws                  Twilio envía aquí el audio de la llamada.
"""

import os
from xml.sax.saxutils import quoteattr

import aiohttp
from fastapi import FastAPI, HTTPException, WebSocket
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndWorkerFrame, LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import WebSocketRunnerArguments
from pipecat.runner.utils import create_transport, parse_telephony_websocket
from pipecat.services.anthropic.llm import AnthropicLLMService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.minimax.tts import MiniMaxHttpTTSService
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transcriptions.language import Language
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams
from pipecat.workers.runner import WorkerRunner
from twilio.rest import Client as TwilioClient

from agente import config
from agente.cumplimiento import ahora_colombia, puede_contactar
from agente.datos import Cartera
from agente.prompt import instrucciones
from agente.sesion import Sesion

app = FastAPI(title="Agente de voz de cobranza")
cartera = Cartera(config.DEUDORES_ARCHIVO, config.RESULTADOS_ARCHIVO)


# --- Herramientas que la agente puede usar durante la llamada ---


async def verificar_identidad(params: FunctionCallParams, ultimos_cuatro_digitos: str):
    """Verifica que quien contesta es el titular, con los últimos 4 dígitos de su cédula. Si es correcto, devuelve los datos de la deuda.

    Args:
        ultimos_cuatro_digitos: Los 4 últimos dígitos que dijo la persona.
    """
    sesion: Sesion = params.app_resources
    await params.result_callback(sesion.verificar_identidad(ultimos_cuatro_digitos))


async def registrar_resultado(
    params: FunctionCallParams,
    resultado: str,
    notas: str = "",
    fecha_compromiso: str = "",
    monto_compromiso: float = 0,
):
    """Registra el resultado de la gestión. Llámala una sola vez, antes de despedirte.

    Args:
        resultado: Uno de: promesa_pago, ya_pago, no_puede_pagar, disputa, numero_equivocado, tercero_contesto, volver_a_llamar, solicita_no_contacto, otro.
        notas: Resumen breve de lo que dijo la persona.
        fecha_compromiso: Fecha de pago acordada, formato AAAA-MM-DD.
        monto_compromiso: Monto que se compromete a pagar, en pesos.
    """
    sesion: Sesion = params.app_resources
    await params.result_callback(
        sesion.registrar_resultado(resultado, notas, fecha_compromiso, monto_compromiso)
    )


async def terminar_llamada(params: FunctionCallParams):
    """Cuelga la llamada. Úsala solo después de despedirte."""
    await params.result_callback({"ok": True})
    await params.llm.push_frame(EndWorkerFrame())


# --- Conversación de voz ---


async def conversar(websocket: WebSocket) -> None:
    transport_type, call_data = await parse_telephony_websocket(websocket)
    deudor = cartera.obtener(call_data.body.get("deudor_id", ""))
    if deudor is None:
        logger.error(f"Llamada sin deudor válido: {call_data.body}")
        await websocket.close()
        return

    runner_args = WebSocketRunnerArguments(websocket=websocket)
    transport = await create_transport(
        runner_args,
        {"twilio": lambda: FastAPIWebsocketParams(audio_in_enabled=True, audio_out_enabled=True)},
    )
    sesion = Sesion(deudor=deudor, cartera=cartera)

    stt = crear_oido()
    http = aiohttp.ClientSession(trust_env=True)
    tts = crear_voz(http)
    llm = AnthropicLLMService(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        settings=AnthropicLLMService.Settings(
            model=config.CLAUDE_MODEL,
            max_tokens=400,
            system_instruction=instrucciones(
                deudor,
                config.EMPRESA,
                config.NOMBRE_AGENTE,
                config.GRABAR_LLAMADAS,
                ahora_colombia().date(),
                config.TELEFONO_CONTACTO,
            ),
        ),
    )
    context = LLMContext(tools=[verificar_identidad, registrar_resultado, terminar_llamada])
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context, user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer())
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(audio_in_sample_rate=8000, audio_out_sample_rate=8000),
        idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
        app_resources=sesion,
    )
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        context.add_message({"role": "developer", "content": "La persona acaba de contestar. Saluda."})
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        if sesion.resultado is None:
            cartera.registrar(deudor.id, "resultado", resultado="colgo_sin_resultado", verificado=sesion.verificado)
        await runner.cancel()

    try:
        await runner.run()
    finally:
        await http.close()


def crear_oido():
    if config.OIDO_PROVEEDOR == "whisper":
        return WhisperSTTService(
            device="cpu",
            compute_type="int8",
            settings=WhisperSTTService.Settings(
                model=config.WHISPER_MODELO,
                language=Language.ES,
                hotwords="cédula pesos consignar abono Bancolombia Nequi Daviplata",
            ),
        )
    return DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        settings=DeepgramSTTService.Settings(model="nova-3", language=Language.ES),
    )


def crear_voz(http: aiohttp.ClientSession):
    if config.VOZ_PROVEEDOR == "minimax":
        return MiniMaxHttpTTSService(
            api_key=os.environ["MINIMAX_API_KEY"],
            group_id=config.MINIMAX_GROUP_ID,
            aiohttp_session=http,
            settings=MiniMaxHttpTTSService.Settings(
                model="speech-2.8-turbo", voice=config.MINIMAX_VOICE_ID, language_boost="Spanish"
            ),
        )
    return ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsTTSService.Settings(
            voice=config.ELEVENLABS_VOICE_ID, model="eleven_flash_v2_5", language=Language.ES
        ),
    )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await conversar(websocket)


# --- Marcación saliente ---


def _twilio() -> TwilioClient:
    return TwilioClient(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])


def twiml_para(deudor_id: str) -> str:
    return (
        "<Response><Connect>"
        f'<Stream url="wss://{config.PUBLIC_HOST}/ws">'
        f"<Parameter name=\"deudor_id\" value={quoteattr(deudor_id)}/>"
        "</Stream></Connect></Response>"
    )


def _llamar(deudor_id: str) -> dict:
    deudor = cartera.obtener(deudor_id)
    if deudor is None:
        raise HTTPException(404, f"No existe el deudor {deudor_id}")
    ok, motivo = puede_contactar(
        cartera.contactos_previos(deudor_id),
        ahora_colombia(),
        config.MAX_CONTACTOS_DIA,
        config.MAX_CONTACTOS_SEMANA,
        cartera.solicito_no_contacto(deudor_id),
    )
    if not ok:
        return {"deudor_id": deudor_id, "llamado": False, "motivo": motivo}
    llamada = _twilio().calls.create(
        to=deudor.telefono,
        from_=config.TWILIO_FROM_NUMBER,
        twiml=twiml_para(deudor_id),
        record=config.GRABAR_LLAMADAS,
    )
    cartera.registrar(deudor_id, "intento", call_sid=llamada.sid)
    return {"deudor_id": deudor_id, "llamado": True, "call_sid": llamada.sid}


@app.post("/llamar/{deudor_id}")
def llamar(deudor_id: str):
    resultado = _llamar(deudor_id)
    if not resultado["llamado"]:
        raise HTTPException(409, resultado["motivo"])
    return resultado


@app.post("/campana")
def campana():
    return [_llamar(d.id) for d in cartera.todos()]
