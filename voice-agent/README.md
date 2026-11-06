# Agente de voz de cobranza ("Valentina")

Agente de voz femenina con acento paisa que llama a deudores, verifica su identidad,
informa el saldo y busca un compromiso de pago. Está construido sobre
[Pipecat](https://github.com/pipecat-ai/pipecat) 1.15, de código abierto.

## Qué necesitas

| Pieza | Servicio | Para qué |
|---|---|---|
| Cerebro | Claude (console.anthropic.com) | Entiende y decide qué decir |
| Oído | Deepgram (deepgram.com) | Convierte la voz del deudor en texto |
| Voz | ElevenLabs (elevenlabs.io) | La voz paisa de Valentina |
| Teléfono | Twilio (twilio.com), con número colombiano | Hace las llamadas |
| Servidor | Cualquier VPS con dominio público (o ngrok para probar) | Corre este código |

**La voz paisa:** en ElevenLabs puedes crear la voz con *Voice Design* (describes
"mujer joven de Medellín, cálida, acento paisa") o clonarla a partir de grabaciones
de una persona real **con su autorización por escrito**. Copia el ID de la voz en
`ELEVENLABS_VOICE_ID`.

## Instalación

```bash
cd voice-agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # y llena las llaves
```

## Paso 1: probar el guion por texto (solo necesitas la llave de Claude)

```bash
.venv/bin/python simulador.py D001
```

Tú haces de deudor. Así ajustas el tono y el guion sin gastar en llamadas.
El número de cédula de prueba de `D001` termina en `6789`.

## Paso 2: llamadas reales

```bash
ngrok http 8000                       # copia el dominio en PUBLIC_HOST
.venv/bin/uvicorn bot:app --port 8000
curl -X POST localhost:8000/llamar/D001   # llama a un deudor
curl -X POST localhost:8000/campana       # llama a todos los que se pueda
```

Los resultados quedan en `datos/resultados.jsonl`, una línea por intento o resultado.

## Qué hace la agente

1. Saluda, dice que es asistente virtual y avisa que la llamada se graba.
2. Confirma que habla con el titular. Si contesta otra persona, no menciona la deuda.
3. Verifica identidad con los últimos 4 dígitos de la cédula (máximo 2 intentos).
   El modelo **no conoce** la cédula ni el saldo: solo recibe los datos de la deuda
   si la verificación es correcta.
4. Informa saldo, acreedor y días de mora, y busca fecha y monto de pago.
5. Registra el resultado: `promesa_pago`, `ya_pago`, `no_puede_pagar`, `disputa`,
   `numero_equivocado`, `tercero_contesto`, `volver_a_llamar`, `solicita_no_contacto`, `otro`.
6. Se despide y cuelga.

## Reglas de contacto (Ley 2300 de 2023)

`agente/cumplimiento.py` bloquea llamadas:
- fuera de lunes a viernes de 7:00 a.m. a 7:00 p.m. y sábados de 8:00 a.m. a 3:00 p.m.;
- domingos y festivos de Colombia;
- por encima de `MAX_CONTACTOS_DIA` y `MAX_CONTACTOS_SEMANA`;
- a quien pidió no ser contactado.

**Valida los límites de frecuencia y el guion con un abogado antes de producción.**

## Conectar con Comuniquemos

`agente/datos.py` lee los deudores de un JSON. Cuando Comuniquemos entregue su API
(o una exportación CSV), solo hay que cambiar la clase `Cartera` para leer de ahí y
enviarle los resultados. Si Comuniquemos ofrece troncal SIP, Pipecat también puede
conectarse por SIP en lugar de Twilio.

## Pruebas

```bash
.venv/bin/python -m pytest -q
```

Cubren horarios y festivos, límites de frecuencia, la verificación de identidad,
que el guion no filtre datos de la deuda y que el TwiML pase el deudor a la llamada.

## Estructura

```
bot.py                 Servidor: marcación por Twilio + conversación de voz (Pipecat)
simulador.py           Prueba del guion por texto
agente/prompt.py       Personalidad paisa, guion y reglas
agente/sesion.py       Verificación de identidad y registro de resultados
agente/cumplimiento.py Horarios, festivos y frecuencia de contacto
agente/datos.py        Cartera de deudores (hoy JSON; mañana Comuniquemos)
datos/                 Datos de ejemplo (ficticios)
```
