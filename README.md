# CRM de cartera (Medellín + Cali)

CRM solo de cartera: lee la hoja de Google «Cartera por vendedor» y «Cartera Cali», muestra Resumen y Extracto,
el semáforo «Por vencer», «Quién debe» y la pestaña **Aprobaciones** para los recordatorios. Nunca envía WhatsApp
solo: abre WhatsApp con el texto y la persona lo envía.

- Reglas, textos para clientes, hoja y base de datos: **[LEEME.md](LEEME.md)** (léalo completo antes de tocar código).
- Instalación en el servidor, **aparte del CRM original**: sección 9 del LEEME.

## Probar en local (CRM de prueba)

```bash
npm ci
node tests/hoja-simulada.js          # otra terminal
npm run build
CRM_DB_PATH=/tmp/prueba.db INBOX_PASSWORD=prueba CARTERA_SHEET_URL=http://127.0.0.1:4112/exec CARTERA_SHEET_KEY=prueba npx next start -p 4102
node tests/cartera.e2e.js            # debe terminar en «Todo bien»
```
