import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { isISODate, todayISO } from "./lib/dates";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signBody,
  verifyRequest,
} from "./lib/hmac";

const http = httpRouter();

const EVENT_ID = /^[A-Za-z0-9:_.@-]{1,160}$/;
const EVENT_TYPE = /^[a-z0-9_.:-]{1,64}$/;
const MAX_BODY_BYTES = 64 * 1024;

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

/**
 * Responses to n8n are signed too, so the workflow can tell a genuine Convex
 * response apart from a proxy or an attacker that guessed the URL.
 */
function signedJson(body: unknown, status = 200): Response {
  const payload = JSON.stringify(body);
  const secret = process.env.LENDLOOP_CALLBACK_SECRET;

  if (!secret) {
    console.error("[http] LENDLOOP_CALLBACK_SECRET is not set");
    return json({ error: "signing is not configured" }, 500);
  }

  const timestamp = String(Date.now());
  return json(body, status, {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: signBody(secret, timestamp, payload),
  });
}

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => json({ ok: true })),
});

/**
 * GET /automation/overdue?date=YYYY-MM-DD
 * Pulled daily by the n8n schedule workflow. Empty body, so the signature only
 * covers method + path + timestamp (still replay-protected by the timestamp).
 */
http.route({
  path: "/automation/overdue",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const path = `${url.pathname}${url.search}`;

    const verification = verifyRequest({
      secret: process.env.LENDLOOP_CALLBACK_SECRET,
      signature: request.headers.get(SIGNATURE_HEADER),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      method: "GET",
      path,
      body: "",
    });
    if (!verification.ok) return json({ error: verification.reason }, 401);

    const date = url.searchParams.get("date") ?? todayISO();
    if (!isISODate(date)) return json({ error: "date must be YYYY-MM-DD" }, 400);

    const loans = await ctx.runQuery(internal.automation.listOverdue, { date });
    return signedJson({ date, generatedAt: new Date().toISOString(), count: loans.length, loans });
  }),
});

/**
 * POST /automation/events
 * Single idempotent write-back endpoint used by every workflow (delivery
 * receipts, reminder receipts and workflow failures).
 */
http.route({
  path: "/automation/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const body = await request.text();

    if (body.length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);

    const verification = verifyRequest({
      secret: process.env.LENDLOOP_CALLBACK_SECRET,
      signature: request.headers.get(SIGNATURE_HEADER),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      method: "POST",
      path: `${url.pathname}${url.search}`,
      body,
    });
    if (!verification.ok) return json({ error: verification.reason }, 401);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }

    if (typeof parsed !== "object" || parsed === null) return json({ error: "invalid payload" }, 400);
    const payload = parsed as Record<string, unknown>;

    const eventId = payload.eventId;
    const type = payload.type;
    const status = payload.status;

    if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) {
      return json({ error: "invalid eventId" }, 400);
    }
    if (typeof type !== "string" || !EVENT_TYPE.test(type)) {
      return json({ error: "invalid type" }, 400);
    }
    if (status !== "delivered" && status !== "failed") {
      return json({ error: "status must be delivered or failed" }, 400);
    }

    const loanId = typeof payload.loanId === "string" ? (payload.loanId as Id<"loans">) : undefined;
    const occurredAt =
      typeof payload.occurredAt === "number" && Number.isFinite(payload.occurredAt)
        ? payload.occurredAt
        : Date.now();

    try {
      const result = await ctx.runMutation(internal.automation.recordInboundEvent, {
        eventId,
        loanId,
        type,
        status,
        detail: typeof payload.detail === "string" ? payload.detail : undefined,
        occurredAt,
      });
      return signedJson({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, 400);
    }
  }),
});

export default http;
