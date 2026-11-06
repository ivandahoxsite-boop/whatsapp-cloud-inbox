"""Prueba el guion por texto en la terminal, sin teléfono ni voz.

Solo necesita ANTHROPIC_API_KEY. Tú haces de deudor y escribes sus respuestas.

    python simulador.py D001
"""

import json
import sys

import anthropic

from agente import config
from agente.cumplimiento import ahora_colombia
from agente.datos import Cartera
from agente.prompt import instrucciones
from agente.sesion import HERRAMIENTAS_CLAUDE, Sesion


def main() -> None:
    deudor_id = sys.argv[1] if len(sys.argv) > 1 else "D001"
    cartera = Cartera(config.DEUDORES_ARCHIVO, config.RESULTADOS_ARCHIVO)
    deudor = cartera.obtener(deudor_id)
    if deudor is None:
        sys.exit(f"No existe el deudor {deudor_id}")

    sesion = Sesion(deudor=deudor, cartera=cartera)
    sistema = instrucciones(
        deudor,
        config.EMPRESA,
        config.NOMBRE_AGENTE,
        config.GRABAR_LLAMADAS,
        ahora_colombia().date(),
        config.TELEFONO_CONTACTO,
    )
    cliente = anthropic.Anthropic()
    mensajes = [{"role": "user", "content": "(La persona acaba de contestar el teléfono.)"}]
    print(f"Simulando llamada a {deudor.nombre}. Escribe 'salir' para terminar.\n")

    while True:
        respuesta = cliente.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=400,
            system=sistema,
            tools=HERRAMIENTAS_CLAUDE,
            messages=mensajes,
        )
        mensajes.append({"role": "assistant", "content": respuesta.content})

        colgar = False
        resultados_herramientas = []
        for bloque in respuesta.content:
            if bloque.type == "text" and bloque.text.strip():
                print(f"{config.NOMBRE_AGENTE}: {bloque.text.strip()}")
            elif bloque.type == "tool_use":
                if bloque.name == "verificar_identidad":
                    salida = sesion.verificar_identidad(**bloque.input)
                elif bloque.name == "registrar_resultado":
                    salida = sesion.registrar_resultado(**bloque.input)
                else:
                    salida, colgar = {"ok": True}, True
                print(f"  [herramienta {bloque.name}: {json.dumps(bloque.input, ensure_ascii=False)} -> {json.dumps(salida, ensure_ascii=False)}]")
                resultados_herramientas.append(
                    {"type": "tool_result", "tool_use_id": bloque.id, "content": json.dumps(salida, ensure_ascii=False)}
                )

        if colgar:
            print("\n(La llamada terminó.)")
            break
        if resultados_herramientas:
            mensajes.append({"role": "user", "content": resultados_herramientas})
            continue

        texto = input("Tú: ").strip()
        if texto.lower() == "salir":
            break
        mensajes.append({"role": "user", "content": texto or "(silencio)"})

    print(f"\nResultado registrado: {json.dumps(sesion.resultado, ensure_ascii=False, indent=2)}")


if __name__ == "__main__":
    main()
