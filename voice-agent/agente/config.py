import os

from dotenv import load_dotenv

load_dotenv()

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-5-5")
EMPRESA = os.getenv("EMPRESA", "Cartera Ejemplo S.A.S.")
NOMBRE_AGENTE = os.getenv("NOMBRE_AGENTE", "Valentina")
DEUDORES_ARCHIVO = os.getenv("DEUDORES_ARCHIVO", "datos/deudores.ejemplo.json")
RESULTADOS_ARCHIVO = os.getenv("RESULTADOS_ARCHIVO", "datos/resultados.jsonl")
GRABAR_LLAMADAS = os.getenv("GRABAR_LLAMADAS", "true").lower() == "true"
MAX_CONTACTOS_DIA = int(os.getenv("MAX_CONTACTOS_DIA", "1"))
MAX_CONTACTOS_SEMANA = int(os.getenv("MAX_CONTACTOS_SEMANA", "2"))
PUBLIC_HOST = os.getenv("PUBLIC_HOST", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")
