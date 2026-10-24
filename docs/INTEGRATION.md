# Kapso ↔ CRM ↔ OpenClaw (Telegram)

```
Customer ─WhatsApp─▶ Kapso ─signed webhook─▶ CRM ◀─Bearer API─▶ OpenClaw ◀─▶ You (Telegram)
                       ▲                                                    │
                       └────────── send (only after human approval) ◀───────┘
```

## 1. Kapso → CRM
1. Deploy the CRM on a host with HTTPS **and a persistent disk** (SQLite file, `CRM_DB_PATH`).
2. Set `KAPSO_WEBHOOK_SECRET` to any long random string.
3. Create the webhook (events `whatsapp.message.received`, `whatsapp.message.sent`):
   ```bash
   curl -X POST https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/$PHONE_NUMBER_ID/webhooks \
     -H "X-API-Key: $KAPSO_API_KEY" -H "Content-Type: application/json" \
     -d '{"whatsapp_webhook":{"url":"https://YOUR-CRM/api/webhooks/kapso",
          "events":["whatsapp.message.received","whatsapp.message.sent"],
          "secret_key":"<same as KAPSO_WEBHOOK_SECRET>"}}'
   ```
The CRM verifies the HMAC-SHA256 signature, ignores retries (idempotency key) and creates the customer in stage "Nuevo" when the number is unknown.

## 1b. Past WhatsApp history
The webhook only sees new messages. To bring in the chats Kapso already stored, open **CRM → Importar → Traer historial**.
It reads `GET /{phone_number_id}/messages` page by page (100 per page, short pause between pages, retries on 429),
creates missing contacts and adds each message to the customer's timeline (audio arrives transcribed). It is read-only:
it never sends anything. Safe to repeat: messages are de-duplicated by WhatsApp message id, also against the webhook.

## 2. OpenClaw → CRM
Set `CRM_AGENT_TOKEN` and give OpenClaw `CRM_BASE_URL` + the same token. Install `docs/openclaw/SKILL.md` as a skill
(OpenClaw skills are folders with a `SKILL.md`; check your version's docs for the exact path). The agent can read,
annotate and propose; proposals wait in the **Aprobaciones** tab.

## 3. Approval
- Default: you approve in the CRM web UI.
- Optional: set `CRM_APPROVER_TOKEN` and call `POST /api/agent/messages/{id}/approve` with it from a Telegram button handler.
  Do **not** give this token to the agent itself, or it can approve its own proposals.
- Safety cap: `CRM_MAX_SENDS_PER_HOUR` (default 20). Free text outside the 24 h window fails and is shown in the history.
