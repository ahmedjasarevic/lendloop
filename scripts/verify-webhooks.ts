import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { signBody, signRequest, verifyBody, verifyRequest } from "../convex/lib/hmac";

type Verdict = { ok: boolean; reason?: string };

type N8nHmac = {
  llSignRequest: (secret: string, timestamp: string, method: string, path: string, body: string) => string;
  llVerifyRequest: (params: {
    secret?: string;
    signature?: string | null;
    timestamp?: string | null;
    method: string;
    path: string;
    body: string;
    now?: number;
  }) => Verdict;
  llSignBody: (secret: string, timestamp: string, body: string) => string;
  llVerifyBody: (params: {
    secret?: string;
    signature?: string | null;
    timestamp?: string | null;
    body: string;
    now?: number;
  }) => Verdict;
  llBuildSignedCall: (params: {
    secret?: string;
    method?: string;
    path: string;
    body: string;
  }) => { timestamp: string; bodyString: string; headers: Record<string, string> };
};

const require = createRequire(import.meta.url);
const n8n = require("../n8n/lib/hmac.js") as N8nHmac;

const SECRET = "4f1c9a7b2e8d4c6fa1b3d5e7f9012345678abcdef0123456789abcdef01234567";

const PAYLOADS = [
  JSON.stringify({
    eventId: "request:jd7abcdef123:request_created",
    event: "request_created",
    loanId: "jd7abcdef123",
    toolName: "Cordless drill",
    category: "power-tools",
    startDate: "2026-12-01",
    endDate: "2026-12-03",
    status: "pending",
    borrowerName: "Amina",
    ownerName: "Tarik",
    recipient: { name: "Tarik", email: "tarik@example.com" },
    link: "https://lendloop.example/incoming",
    occurredAt: "2026-11-27T10:00:00.000Z",
  }),
  JSON.stringify({ count: 2, loans: [], date: "2026-11-27" }),
  JSON.stringify({ unicode: "Žćčđš 漢字 🚀", nested: { a: [1, 2, 3], b: null } }),
  "",
  "not-json-at-all",
];

test("n8n implementation produces byte-identical signatures to Convex", () => {
  const timestamp = "1764242400000";
  for (const body of PAYLOADS) {
    for (const [method, path] of [
      ["POST", "/lendloop/request-event"],
      ["POST", "/automation/events"],
      ["GET", "/automation/overdue?date=2026-11-27"],
    ] as const) {
      assert.equal(
        n8n.llSignRequest(SECRET, timestamp, method, path, body),
        signRequest(SECRET, timestamp, method, path, body),
        `signature mismatch for ${method} ${path}`,
      );
    }
    assert.equal(n8n.llSignBody(SECRET, timestamp, body), signBody(SECRET, timestamp, body));
  }
});

test("a webhook signed by Convex verifies inside n8n", () => {
  const now = 1_764_242_400_000;
  const timestamp = String(now);
  const body = PAYLOADS[0];
  const signature = signRequest(SECRET, timestamp, "POST", "/lendloop/request-event", body);

  assert.deepEqual(
    n8n.llVerifyRequest({
      secret: SECRET,
      signature,
      timestamp,
      method: "POST",
      path: "/lendloop/request-event",
      body,
      now,
    }),
    { ok: true },
  );

  assert.equal(
    n8n.llVerifyRequest({
      secret: SECRET,
      signature,
      timestamp,
      method: "POST",
      path: "/lendloop/request-event",
      body: body.replace("Cordless drill", "Cordless saw"),
      now,
    }).ok,
    false,
  );

  assert.equal(
    n8n.llVerifyRequest({
      secret: "wrong-secret",
      signature,
      timestamp,
      method: "POST",
      path: "/lendloop/request-event",
      body,
      now,
    }).ok,
    false,
  );

  assert.equal(
    n8n.llVerifyRequest({
      secret: SECRET,
      signature,
      timestamp,
      method: "POST",
      path: "/lendloop/request-event",
      body,
      now: now + 6 * 60 * 1000,
    }).ok,
    false,
  );
});

test("a callback signed by n8n verifies in Convex", () => {
  const body = JSON.stringify({
    eventId: "delivery:request:jd7abcdef123:request_created",
    loanId: "jd7abcdef123",
    type: "notification_delivered",
    status: "delivered",
    detail: "log:notification_delivered",
    occurredAt: 1_764_242_400_000,
  });

  const call = n8n.llBuildSignedCall({
    secret: SECRET,
    method: "POST",
    path: "/automation/events",
    body,
  });

  assert.equal(call.bodyString, body);

  const verdict = verifyRequest({
    secret: SECRET,
    signature: call.headers["x-lendloop-signature"],
    timestamp: call.headers["x-lendloop-timestamp"],
    method: "POST",
    path: "/automation/events",
    body,
    now: Number(call.timestamp),
  });
  assert.deepEqual(verdict, { ok: true });
});

test("a GET without a body verifies on both sides", () => {
  const call = n8n.llBuildSignedCall({
    secret: SECRET,
    method: "GET",
    path: "/automation/overdue?date=2026-11-27",
    body: "",
  });

  assert.deepEqual(
    verifyRequest({
      secret: SECRET,
      signature: call.headers["x-lendloop-signature"],
      timestamp: call.headers["x-lendloop-timestamp"],
      method: "GET",
      path: "/automation/overdue?date=2026-11-27",
      body: "",
      now: Number(call.timestamp),
    }),
    { ok: true },
  );
});

test("a response signed by Convex verifies inside n8n", () => {
  const timestamp = "1764242400000";
  const body = PAYLOADS[1];
  assert.deepEqual(
    n8n.llVerifyBody({
      secret: SECRET,
      signature: signBody(SECRET, timestamp, body),
      timestamp,
      body,
      now: Number(timestamp),
    }),
    { ok: true },
  );
  assert.equal(
    n8n.llVerifyBody({
      secret: SECRET,
      signature: signBody(SECRET, timestamp, `${body} `),
      timestamp,
      body,
      now: Number(timestamp),
    }).ok,
    false,
  );
});
