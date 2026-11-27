# n8n workflows

Three importable workflows. The JSON files are **generated** — edit
`n8n/lib/hmac.js` or `scripts/build-n8n-workflows.mjs`, then run:

```bash
npm run build:n8n
npm run validate:n8n
```

`validate:n8n` checks graph connectivity, JS syntax of every Code node, and that no secret
material is embedded in the export.

## Files

| File | Trigger | What it does |
|---|---|---|
| `lendloop-request-notifications.json` | Webhook `POST /lendloop/request-event` | Verifies the Convex HMAC, renders the notification, logs delivery, writes a signed receipt back to Convex |
| `lendloop-overdue-reminders.json` | Cron `0 9 * * *` (UTC) | Pulls overdue loans from a signed Convex endpoint, sends one reminder per loan, writes the status back idempotently |
| `lendloop-error-handler.json` | Error Trigger | Reports failed executions into the app’s automation feed |

## Hosting

The workflows need a **long-running** n8n with a persistent volume and `$env` access.

| Option | Notes |
|---|---|
| Self-hosted Docker (recommended) | `docker-compose.yml` in the repo root. Full control, `$env` works. |
| Railway / Fly.io / Render | Run the official image, mount a volume at `/home/node/.n8n`, set the env vars, keep `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. Railway's n8n template is the fastest (~$5 trial credit). |
| n8n Cloud | `$env` is blocked by the platform. The Code nodes fall back to `$vars`, but instance **Variables require the Pro plan**. On Starter there is no way to inject the HMAC secrets without hardcoding them. |
| Vercel | Not possible: n8n is a long-running server with a database and scheduler; Vercel is serverless. |

If n8n is unreachable, the app keeps working — the loan's activity feed shows the failed delivery with
a reason, and Convex retries with backoff. That is intentional.

## Import

1. `docker compose up -d` and open <http://localhost:5678>.
2. **Workflows → ⋯ → Import from File** and import all three.
3. Open each of the two main workflows → ⋯ → **Settings → Error Workflow** →
   *LendLoop — Error handler*. The exported JSON already references the handler by its stable id,
   so a CLI import wires it automatically; a UI import may assign a new workflow id, in which case
   re-select it once.
4. **Activate “LendLoop — Request notifications”.** The production webhook URL only exists while
   the workflow is active.

## Secrets

The Code nodes never contain secrets. They call `llConfig("NAME")`, which resolves in this order:

1. `$env.NAME` — available when the container runs with
   `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (already set in `docker-compose.yml`).
2. `$vars.NAME` — n8n instance variables, useful on n8n Cloud where `$env` is blocked.

Required names:

```
LENDLOOP_WEBHOOK_SECRET      # verifies Convex -> n8n
LENDLOOP_CALLBACK_SECRET     # signs n8n -> Convex, verifies Convex responses
LENDLOOP_CONVEX_SITE_URL     # https://<deployment>.convex.site (HTTP actions)
```

Check what the container actually sees:

```bash
docker compose exec n8n printenv | findstr LENDLOOP
```

## Delivery channel

`Compose and deliver` (workflow 1) and `Prepare reminders` (workflow 2) end with a `console.log`
that prints the fully rendered `to / subject / text`. This is the delivery boundary.

To send real email, replace the `console.log` block with a **Send Email** node (SMTP credential) or
a **Gmail** node and wire `delivery.to`, `delivery.subject`, `delivery.text`. Nothing else in the
workflow needs to change — the receipt already records channel and recipient.

## Test mode vs production

- Convex calls the **production** URL: `https://<host>/webhook/lendloop/request-event`.
  The workflow must be active.
- To iterate, switch `N8N_REQUEST_WEBHOOK_URL` on the Convex deployment to
  `https://<host>/webhook-test/lendloop/request-event`, click **Listen for test event** in n8n,
  then create a loan request in the app. Remember to switch it back.
- The overdue workflow can be tested with **Execute workflow**; it calls Convex outbound and does
  not need an inbound tunnel.

## Notes on reliability

- Webhook response mode is `onReceived` → Convex gets a `200` immediately and is never held open by
  delivery.
- Every HTTP node has `retryOnFail` with 3 attempts, 2s apart.
- Write-backs carry deterministic `eventId`s, so retries do not duplicate rows or bump
  `reminderCount` twice.
- A failed run is visible twice: in n8n’s execution list and in the app (via the error workflow).
