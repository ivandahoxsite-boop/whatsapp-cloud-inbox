"""Cartera de deudores y registro de resultados.

Hoy lee un JSON y escribe un JSONL. Cuando Comuniquemos entregue su API,
solo hay que reemplazar esta clase por una que hable con ella.
"""

import json
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from agente.cumplimiento import ahora_colombia


@dataclass
class Deudor:
    id: str
    nombre: str
    cedula: str
    telefono: str
    saldo: float
    dias_mora: int
    acreedor: str
    referencia: str

    @property
    def primer_nombre(self) -> str:
        return self.nombre.split()[0]


class Cartera:
    def __init__(self, archivo_deudores: str, archivo_resultados: str):
        self._deudores = {
            d["id"]: Deudor(**d)
            for d in json.loads(Path(archivo_deudores).read_text(encoding="utf-8"))
        }
        self._resultados = Path(archivo_resultados)
        self._lock = threading.Lock()

    def todos(self) -> list[Deudor]:
        return list(self._deudores.values())

    def obtener(self, deudor_id: str) -> Deudor | None:
        return self._deudores.get(deudor_id)

    def _eventos(self, deudor_id: str) -> list[dict]:
        if not self._resultados.exists():
            return []
        with self._resultados.open(encoding="utf-8") as f:
            eventos = [json.loads(linea) for linea in f if linea.strip()]
        return [e for e in eventos if e["deudor_id"] == deudor_id]

    def contactos_previos(self, deudor_id: str) -> list[datetime]:
        return [
            datetime.fromisoformat(e["fecha"])
            for e in self._eventos(deudor_id)
            if e["tipo"] == "intento"
        ]

    def solicito_no_contacto(self, deudor_id: str) -> bool:
        return any(
            e.get("resultado") == "solicita_no_contacto" for e in self._eventos(deudor_id)
        )

    def registrar(self, deudor_id: str, tipo: str, **datos) -> dict:
        evento = {"deudor_id": deudor_id, "tipo": tipo, "fecha": ahora_colombia().isoformat(), **datos}
        with self._lock:
            self._resultados.parent.mkdir(parents=True, exist_ok=True)
            with self._resultados.open("a", encoding="utf-8") as f:
                f.write(json.dumps(evento, ensure_ascii=False) + "\n")
        return evento
