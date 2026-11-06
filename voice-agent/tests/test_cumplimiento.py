from datetime import datetime

from agente.cumplimiento import ZONA_COLOMBIA, dentro_de_horario, puede_contactar


def bogota(*args):
    return datetime(*args, tzinfo=ZONA_COLOMBIA)


def test_lunes_en_horario():
    assert dentro_de_horario(bogota(2026, 11, 9, 10, 0))[0]


def test_antes_de_las_7_no():
    assert not dentro_de_horario(bogota(2026, 11, 10, 6, 59))[0]


def test_despues_de_las_7_pm_no():
    assert not dentro_de_horario(bogota(2026, 11, 10, 19, 0))[0]


def test_sabado_hasta_las_3():
    assert dentro_de_horario(bogota(2026, 11, 7, 14, 59))[0]
    assert not dentro_de_horario(bogota(2026, 11, 7, 15, 0))[0]


def test_domingo_no():
    assert not dentro_de_horario(bogota(2026, 11, 8, 10, 0))[0]


def test_festivo_no():
    # 2026-11-16 es lunes festivo (Independencia de Cartagena)
    ok, motivo = dentro_de_horario(bogota(2026, 11, 16, 10, 0))
    assert not ok and "festivo" in motivo


def test_hora_utc_se_convierte_a_colombia():
    # 13:00 UTC = 8:00 a.m. en Bogotá
    from datetime import timezone

    assert dentro_de_horario(datetime(2026, 11, 10, 13, 0, tzinfo=timezone.utc))[0]


def test_maximo_por_dia():
    previos = [bogota(2026, 11, 10, 8, 0)]
    ok, _ = puede_contactar(previos, bogota(2026, 11, 10, 15, 0), max_por_dia=1, max_por_semana=2)
    assert not ok


def test_maximo_por_semana():
    previos = [bogota(2026, 11, 9, 8, 0), bogota(2026, 11, 10, 8, 0)]
    ok, _ = puede_contactar(previos, bogota(2026, 11, 12, 9, 0), max_por_dia=1, max_por_semana=2)
    assert not ok
    # La semana siguiente ya se puede
    assert puede_contactar(previos, bogota(2026, 11, 17, 9, 0), 1, 2)[0]


def test_no_contactar_si_lo_pidio():
    ok, _ = puede_contactar([], bogota(2026, 11, 10, 9, 0), 1, 2, solicito_no_contacto=True)
    assert not ok
