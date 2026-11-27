/**
 * Live smoke test for the signed n8n <-> Convex boundary.
 *
 * It talks to the deployed HTTP actions with real HMAC signatures:
 *   1. unsigned request is rejected
 *   2. correctly signed GET /automation/overdue returns a signed response
 *   3. tampered signature and stale timestamp are rejected
 *   4. signed POST /automation/events is accepted and is idempotent on retry
 *
 * Run: npm run smoke
 * Requires .env (secrets) and .env.local (NEXT_PUBLIC_CONVEX_SITE_URL).
 */
import { readFileSync } from "node:fs";

import { signRequest, verifyBody } from "../convex/lib/hmac";

function loadEnv(): Map<string, string> {
  const values = new Map<string, string>();
  for (const file of [".env", ".env.local"]) {
    let contents: string;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (key && value) values.set(key, value);
    }
  }
  return values;
}

const env = loadEnv();
const siteUrl = env.get("NEXT_PUBLIC_CONVEX_SITE_URL") ?? env.get("LENDLOOP_CONVEX_SITE_URL");
const callbackSecret = env.get("LENDLOOP_CALLBACK_SECRET");

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

function signedHeaders(method: string, path: string, body: string, timestamp = String(Date.now())) {
  return {
    timestamp,
    headers: {
      "content-type": "application/json",
      "x-lendloop-timestamp": timestamp,
      "x-lendloop-signature": signRequest(callbackSecret!, timestamp, method, path, body),
    },
  };
}

async function main(): Promise<void> {
  if (!siteUrl || !callbackSecret) {
    console.error(
      "Missing configuration. Need LENDLOOP_CALLBACK_SECRET in .env and NEXT_PUBLIC_CONVEX_SITE_URL in .env.local.",
    );
    process.exit(1);
  }

  const base = siteUrl.replace(/\/$/, "");

  // 1. Unsigned request -----------------------------------------------------
  {
    const response = await fetch(`${base}/automation/overdue?date=2026-01-01`);
    check("unsigned GET is rejected", response.status === 401, `status ${response.status}`);
  }

  // 2. Signed GET + signed response ----------------------------------------
  {
    const date = new Date().toISOString().slice(0, 10);
    const path = `/automation/overdue?date=${date}`;
    const { headers } = signedHeaders("GET", path, "");
    const response = await fetch(`${base}${path}`, { headers });
    const body = await response.text();

    check("signed GET is accepted", response.status === 200, `status ${response.status}`);

    const verdict = verifyBody({
      secret: callbackSecret,
      signature: response.headers.get("x-lendloop-signature"),
      timestamp: response.headers.get("x-lendloop-timestamp"),
      body,
    });
    check("response signature verifies", verdict.ok, verdict.ok ? "" : verdict.reason);

    try {
      const parsed = JSON.parse(body) as { count?: number };
      check("response has an overdue count", typeof parsed.count === "number", `count=${parsed.count}`);
    } catch {
      check("response is JSON", false);
    }
  }

  // 3. Tampered signature / stale timestamp ---------------------------------
  {
    const path = "/automation/overdue?date=2026-01-01";
    const { headers } = signedHeaders("GET", path, "");
    const tampered = await fetch(`${base}${path}`, {
      headers: { ...headers, "x-lendloop-signature": "0".repeat(64) },
    });
    check("tampered signature is rejected", tampered.status === 401, `status ${tampered.status}`);

    const staleTimestamp = String(Date.now() - 6 * 60 * 1000);
    const { headers: staleHeaders } = signedHeaders("GET", path, "", staleTimestamp);
    const stale = await fetch(`${base}${path}`, { headers: staleHeaders });
    check("stale timestamp is rejected", stale.status === 401, `status ${stale.status}`);
  }

  // 4. Signed POST + idempotency -------------------------------------------
  {
    const path = "/automation/events";
    const eventId = `smoke:${Date.now()}`;
    const body = JSON.stringify({
      eventId,
      type: "smoke_test",
      status: "delivered",
      detail: "scripts/smoke.ts",
      occurredAt: Date.now(),
    });

    const first = await fetch(`${base}${path}`, {
      method: "POST",
      headers: signedHeaders("POST", path, body).headers,
      body,
    });
    const firstJson = (await first.json()) as { ok?: boolean; duplicate?: boolean };
    check("signed POST is accepted", first.status === 200, `status ${first.status}`);
    check("first write is not a duplicate", firstJson.duplicate === false);

    const second = await fetch(`${base}${path}`, {
      method: "POST",
      headers: signedHeaders("POST", path, body).headers,
      body,
    });
    const secondJson = (await second.json()) as { duplicate?: boolean };
    check("retry is deduplicated", secondJson.duplicate === true, `duplicate=${secondJson.duplicate}`);

    const tamperedBody = body.replace("smoke_test", "smoke_tampered");
    const bad = await fetch(`${base}${path}`, {
      method: "POST",
      headers: signedHeaders("POST", path, body).headers,
      body: tamperedBody,
    });
    check("body tampering is rejected", bad.status === 401, `status ${bad.status}`);
  }

  // 5. Public health -------------------------------------------------------
  {
    const response = await fetch(`${base}/health`);
    const body = (await response.json()) as { ok?: boolean };
    check("health endpoint", response.status === 200 && body.ok === true);
  }

  console.log(failures === 0 ? "\nAll live checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
