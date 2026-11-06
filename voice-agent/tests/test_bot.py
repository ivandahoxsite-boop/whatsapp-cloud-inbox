from xml.etree import ElementTree

import bot


def test_twiml_pasa_deudor_al_stream(monkeypatch):
    monkeypatch.setattr(bot.config, "PUBLIC_HOST", "ejemplo.ngrok.app")
    raiz = ElementTree.fromstring(bot.twiml_para('D001"<x>'))
    stream = raiz.find("Connect/Stream")
    assert stream.get("url") == "wss://ejemplo.ngrok.app/ws"
    assert stream.find("Parameter").get("value") == 'D001"<x>'


def test_no_llama_fuera_de_horario(monkeypatch):
    from datetime import datetime

    from agente.cumplimiento import ZONA_COLOMBIA

    monkeypatch.setattr(bot, "ahora_colombia", lambda: datetime(2026, 11, 8, 10, tzinfo=ZONA_COLOMBIA))
    monkeypatch.setattr(bot, "_twilio", lambda: (_ for _ in ()).throw(AssertionError("no debe llamar")))
    r = bot._llamar("D001")
    assert r["llamado"] is False and "domingo" in r["motivo"]
