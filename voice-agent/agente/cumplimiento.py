"""Reglas de contacto para cobranza en Colombia.

Basado en la Ley 2300 de 2023 ("Dejen de fregar"): solo se puede contactar
de lunes a viernes de 7:00 a.m. a 7:00 p.m. y sábados de 8:00 a.m. a 3:00 p.m.,
nunca domingos ni festivos. Los límites de frecuencia son configurables:
valídalos con tu abogado antes de salir a producción.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import holidays

ZONA_COLOMBIA = ZoneInfo("America/Bogota")

# weekday() -> (hora de inicio, hora de fin). Domingo (6) no aparece: prohibido.
HORARIO_PERMITIDO = {
    0: (7, 19),
    1: (7, 19),
    2: (7, 19),
    3: (7, 19),
    4: (7, 19),
    5: (8, 15),
}


def ahora_colombia() -> datetime:
    return datetime.now(ZONA_COLOMBIA)


def es_festivo(momento: datetime) -> bool:
    return momento.date() in holidays.Colombia(years=momento.year)


def dentro_de_horario(momento: datetime) -> tuple[bool, str]:
    """Indica si en `momento` (hora de Colombia) se puede llamar."""
    momento = momento.astimezone(ZONA_COLOMBIA)
    if es_festivo(momento):
        return False, "es festivo en Colombia"
    rango = HORARIO_PERMITIDO.get(momento.weekday())
    if rango is None:
        return False, "los domingos no se puede contactar"
    inicio, fin = rango
    if not inicio <= momento.hour < fin:
        return False, f"fuera del horario permitido ({inicio}:00 a {fin}:00)"
    return True, "ok"


def dentro_de_frecuencia(
    contactos_previos: list[datetime],
    momento: datetime,
    max_por_dia: int,
    max_por_semana: int,
) -> tuple[bool, str]:
    """Revisa que no se exceda el número de contactos por día y por semana."""
    momento = momento.astimezone(ZONA_COLOMBIA)
    previos = [c.astimezone(ZONA_COLOMBIA) for c in contactos_previos]
    hoy = sum(1 for c in previos if c.date() == momento.date())
    if hoy >= max_por_dia:
        return False, f"ya se contactó {hoy} vez/veces hoy (máximo {max_por_dia})"
    inicio_semana = (momento - timedelta(days=momento.weekday())).date()
    semana = sum(1 for c in previos if inicio_semana <= c.date() <= momento.date())
    if semana >= max_por_semana:
        return False, f"ya se contactó {semana} veces esta semana (máximo {max_por_semana})"
    return True, "ok"


def puede_contactar(
    contactos_previos: list[datetime],
    momento: datetime,
    max_por_dia: int,
    max_por_semana: int,
    solicito_no_contacto: bool = False,
) -> tuple[bool, str]:
    if solicito_no_contacto:
        return False, "la persona pidió no ser contactada por este medio"
    ok, motivo = dentro_de_horario(momento)
    if not ok:
        return ok, motivo
    return dentro_de_frecuencia(contactos_previos, momento, max_por_dia, max_por_semana)
