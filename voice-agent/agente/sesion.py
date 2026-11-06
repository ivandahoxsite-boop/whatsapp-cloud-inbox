"""Estado y acciones de una llamada, compartidos por el bot de voz y el simulador.

El modelo NO conoce la cédula ni el saldo al empezar. Solo recibe los datos de
la deuda cuando la persona confirma su identidad (protección de datos, Ley 1581).
"""

from dataclasses import dataclass, field

from agente.datos import Cartera, Deudor

RESULTADOS_VALIDOS = {
    "promesa_pago",
    "ya_pago",
    "no_puede_pagar",
    "disputa",
    "numero_equivocado",
    "tercero_contesto",
    "volver_a_llamar",
    "solicita_no_contacto",
    "otro",
}

MAX_INTENTOS_VERIFICACION = 2


def formato_pesos(valor: float) -> str:
    return "$" + f"{valor:,.0f}".replace(",", ".") + " pesos"


@dataclass
class Sesion:
    deudor: Deudor
    cartera: Cartera
    verificado: bool = False
    intentos_verificacion: int = 0
    resultado: dict | None = field(default=None)

    def verificar_identidad(self, ultimos_cuatro_digitos: str) -> dict:
        digitos = "".join(c for c in ultimos_cuatro_digitos if c.isdigit())
        if len(digitos) != 4:
            return {"verificado": False, "motivo": "No son 4 dígitos. Pídele que los repita completos; esto no cuenta como intento."}
        if self.intentos_verificacion >= MAX_INTENTOS_VERIFICACION:
            return {"verificado": False, "motivo": "Se agotaron los intentos. No reveles información de la deuda."}
        self.intentos_verificacion += 1
        if self.deudor.cedula.endswith(digitos):
            return self.confirmar_titular()
        restantes = MAX_INTENTOS_VERIFICACION - self.intentos_verificacion
        return {
            "verificado": False,
            "intentos_restantes": restantes,
            "motivo": "Los dígitos no coinciden. No reveles información de la deuda.",
        }

    def confirmar_titular(self) -> dict:
        self.verificado = True
        return {
            "verificado": True,
            "acreedor": self.deudor.acreedor,
            "saldo": formato_pesos(self.deudor.saldo),
            "dias_mora": self.deudor.dias_mora,
            "referencia": self.deudor.referencia,
        }

    def registrar_resultado(
        self,
        resultado: str,
        notas: str = "",
        fecha_compromiso: str = "",
        monto_compromiso: float = 0,
    ) -> dict:
        if resultado not in RESULTADOS_VALIDOS:
            return {"ok": False, "error": f"resultado inválido; usa uno de: {sorted(RESULTADOS_VALIDOS)}"}
        if resultado == "promesa_pago" and not self.verificado:
            return {"ok": False, "error": "No se puede registrar un acuerdo sin verificar identidad."}
        if resultado == "promesa_pago" and not fecha_compromiso:
            return {"ok": False, "error": "Para una promesa de pago falta la fecha de compromiso."}
        self.resultado = self.cartera.registrar(
            self.deudor.id,
            "resultado",
            resultado=resultado,
            notas=notas,
            fecha_compromiso=fecha_compromiso or None,
            monto_compromiso=monto_compromiso or None,
            verificado=self.verificado,
        )
        return {"ok": True}


# Esquemas de herramientas en formato de la API de Claude (los usa el simulador).
CONFIRMAR_TITULAR = {
    "name": "confirmar_titular",
    "description": "Úsala solo cuando la persona confirmó claramente que es el titular. Devuelve los datos de la deuda.",
    "input_schema": {"type": "object", "properties": {}},
}

HERRAMIENTAS_CLAUDE = [
    {
        "name": "verificar_identidad",
        "description": "Verifica que quien contesta es el titular, con los últimos 4 dígitos de su cédula. Si es correcto, devuelve los datos de la deuda.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ultimos_cuatro_digitos": {"type": "string", "description": "Los 4 últimos dígitos que dijo la persona."}
            },
            "required": ["ultimos_cuatro_digitos"],
        },
    },
    {
        "name": "registrar_resultado",
        "description": "Registra el resultado de la gestión. Llámala una sola vez, antes de despedirte.",
        "input_schema": {
            "type": "object",
            "properties": {
                "resultado": {"type": "string", "enum": sorted(RESULTADOS_VALIDOS)},
                "notas": {"type": "string", "description": "Resumen breve de lo que dijo la persona."},
                "fecha_compromiso": {"type": "string", "description": "Fecha de pago acordada, formato AAAA-MM-DD."},
                "monto_compromiso": {"type": "number", "description": "Monto que se compromete a pagar, en pesos."},
            },
            "required": ["resultado"],
        },
    },
    {
        "name": "terminar_llamada",
        "description": "Cuelga la llamada. Úsala solo después de despedirte.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


def herramientas_claude(verificacion: str) -> list[dict]:
    if verificacion == "cedula":
        return HERRAMIENTAS_CLAUDE
    return [CONFIRMAR_TITULAR] + HERRAMIENTAS_CLAUDE[1:]
