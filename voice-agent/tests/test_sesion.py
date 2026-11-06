import json
from datetime import date

import pytest

from agente.datos import Cartera
from agente.prompt import instrucciones
from agente.sesion import Sesion


@pytest.fixture
def cartera(tmp_path):
    return Cartera("datos/deudores.ejemplo.json", str(tmp_path / "resultados.jsonl"))


@pytest.fixture
def sesion(cartera):
    return Sesion(deudor=cartera.obtener("D001"), cartera=cartera)


def test_verificacion_correcta_entrega_deuda(sesion):
    r = sesion.verificar_identidad("6789")
    assert r["verificado"] and r["saldo"] == "$850.000 pesos"


def test_acepta_digitos_hablados_con_espacios(sesion):
    assert sesion.verificar_identidad("6 7 8 9")["verificado"]


def test_verificacion_incorrecta_no_entrega_deuda(sesion):
    r = sesion.verificar_identidad("1234")
    assert not r["verificado"] and "saldo" not in r


def test_maximo_dos_intentos(sesion):
    sesion.verificar_identidad("0000")
    sesion.verificar_identidad("1111")
    assert not sesion.verificar_identidad("6789")["verificado"]


def test_promesa_requiere_verificacion(sesion):
    assert not sesion.registrar_resultado("promesa_pago", fecha_compromiso="2026-11-20")["ok"]


def test_promesa_requiere_fecha(sesion):
    sesion.verificar_identidad("6789")
    assert not sesion.registrar_resultado("promesa_pago")["ok"]


def test_registra_promesa(sesion, cartera, tmp_path):
    sesion.verificar_identidad("6789")
    assert sesion.registrar_resultado("promesa_pago", "pagará en Bancolombia", "2026-11-20", 400000)["ok"]
    evento = json.loads((tmp_path / "resultados.jsonl").read_text().strip())
    assert evento["resultado"] == "promesa_pago" and evento["monto_compromiso"] == 400000


def test_resultado_invalido(sesion):
    assert not sesion.registrar_resultado("lo_que_sea")["ok"]


def test_no_contacto_bloquea_futuras_llamadas(sesion, cartera):
    sesion.registrar_resultado("solicita_no_contacto")
    assert cartera.solicito_no_contacto("D001")


def test_prompt_no_filtra_datos_de_la_deuda(cartera):
    d = cartera.obtener("D001")
    texto = instrucciones(d, "Empresa X", "Valentina", True, date(2026, 11, 10))
    assert d.cedula not in texto and "850" not in texto and d.acreedor not in texto
    assert "grabada" in texto and "Valentina" in texto


def test_digitos_incompletos_no_gastan_intento(sesion):
    assert not sesion.verificar_identidad("seis")["verificado"]
    sesion.verificar_identidad("0000")
    assert sesion.verificar_identidad("6789")["verificado"]
