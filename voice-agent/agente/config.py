import os

from dotenv import load_dotenv

load_dotenv()

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-5-5")
EMPRESA = os.getenv("EMPRESA", "Xsite Group")
NOMBRE_AGENTE = os.getenv("NOMBRE_AGENTE", "Valentina")
TELEFONO_CONTACTO = os.getenv("TELEFONO_CONTACTO", "")
DEUDORES_ARCHIVO = os.getenv("DEUDORES_ARCHIVO", "datos/deudores.ejemplo.json")
RESULTADOS_ARCHIVO = os.getenv("RESULTADOS_ARCHIVO", "datos/resultados.jsonl")
GRABAR_LLAMADAS = os.getenv("GRABAR_LLAMADAS", "true").lower() == "true"
MAX_CONTACTOS_DIA = int(os.getenv("MAX_CONTACTOS_DIA", "1"))
MAX_CONTACTOS_SEMANA = int(os.getenv("MAX_CONTACTOS_SEMANA", "2"))
PUBLIC_HOST = os.getenv("PUBLIC_HOST", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")
OIDO_PROVEEDOR = os.getenv("OIDO_PROVEEDOR", "deepgram")
WHISPER_MODELO = os.getenv("WHISPER_MODELO", "small")
VOZ_PROVEEDOR = os.getenv("VOZ_PROVEEDOR", "elevenlabs")
MINIMAX_VOICE_ID = os.getenv("MINIMAX_VOICE_ID", "Spanish_SereneWoman")
MINIMAX_MODELO = os.getenv("MINIMAX_MODELO", "speech-2.8-hd")
MINIMAX_VELOCIDAD = float(os.getenv("MINIMAX_VELOCIDAD", "1.1"))
MINIMAX_GROUP_ID = os.getenv("MINIMAX_GROUP_ID", "")
