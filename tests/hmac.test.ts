import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import {
  MAX_CLOCK_SKEW_MS,
  canonicalString,
  fromHex,
  hmacSha256,
  sha256Hex,
  signBody,
  signRequest,
  toHex,
  utf8,
  verifyBody,
  verifyRequest,
} from "../convex/lib/hmac";

const SECRET = "test-secret-do-not-use-in-production";

/** Deterministic pseudo-random ASCII strings, so failures are reproducible. */
function sequence(seed: number, length: number): string {
  let state = seed >>> 0;
  let out = "";
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out += String.fromCharCode(33 + (state % 90));
  }
  return out;
}

test("sha256 matches node:crypto across padding boundaries", () => {
  const inputs = [
    "",
    "a",
    "abc",
    "žćčđš",
    "漢字 and emoji 🚀🔐",
    "a".repeat(54),
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(63),
    "a".repeat(64),
    "a".repeat(65),
    "a".repeat(119),
    "a".repeat(120),
    "a".repeat(1000),
  ];
  for (let i = 1; i <= 20; i++) inputs.push(sequence(i, i * 37));

  for (const input of inputs) {
    const expected = createHash("sha256").update(input, "utf8").digest("hex");
    assert.equal(sha256Hex(input), expected, `sha256 mismatch for input length ${input.length}`);
  }
});

test("hmac-sha256 matches node:crypto for short, exact-block and long keys", () => {
  const keyLengths = [0, 1, 16, 31, 32, 63, 64, 65, 100, 200];
  const messageLengths = [0, 1, 31, 63, 64, 65, 200, 1000];

  for (const keyLength of keyLengths) {
    for (const messageLength of messageLengths) {
      const key = sequence(keyLength + 1, keyLength);
      const message = sequence(messageLength + 2, messageLength);
      const expected = createHmac("sha256", Buffer.from(key, "utf8"))
        .update(message, "utf8")
        .digest("hex");
      const actual = toHex(hmacSha256(utf8(key), utf8(message)));
      assert.equal(actual, expected, `hmac mismatch key=${keyLength} message=${messageLength}`);
    }
  }
});

test("utf8 encoder matches Buffer for non-ASCII text", () => {
  for (const input of ["", "abc", "ŽĆČĐŠ", "日本語", "🚀🔐", "mixed ž 漢 🚀 text"]) {
    assert.deepEqual(Array.from(utf8(input)), Array.from(Buffer.from(input, "utf8")));
  }
});

test("hex helpers round-trip", () => {
  const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255]);
  assert.deepEqual(Array.from(fromHex(toHex(bytes))), Array.from(bytes));
  assert.equal(fromHex("zz").length, 0);
  assert.equal(fromHex("abc").length, 0);
});

test("canonical string binds timestamp, method, path and body", () => {
  const base = canonicalString("1700000000000", "post", "/lendloop/request-event", '{"a":1}');
  assert.equal(
    base,
    `1700000000000\nPOST\n/lendloop/request-event\n${createHash("sha256").update('{"a":1}', "utf8").digest("hex")}`,
  );
  assert.notEqual(base, canonicalString("1700000000000", "POST", "/other", '{"a":1}'));
  assert.notEqual(base, canonicalString("1700000000001", "POST", "/lendloop/request-event", '{"a":1}'));
  assert.notEqual(base, canonicalString("1700000000000", "POST", "/lendloop/request-event", '{"a":2}'));
});

test("signRequest is verifiable and rejects tampering", () => {
  const now = 1_700_000_000_000;
  const timestamp = String(now);
  const body = JSON.stringify({ tool: "Cordless drill", eventId: "request:abc:request_created" });
  const signature = signRequest(SECRET, timestamp, "POST", "/lendloop/request-event", body);

  const expected = createHmac("sha256", SECRET)
    .update(canonicalString(timestamp, "POST", "/lendloop/request-event", body), "utf8")
    .digest("hex");
  assert.equal(signature, expected);

  const ok = verifyRequest({
    secret: SECRET,
    signature,
    timestamp,
    method: "POST",
    path: "/lendloop/request-event",
    body,
    now,
  });
  assert.deepEqual(ok, { ok: true });

  for (const tampered of [
    { body: body.replace("drill", "saw") },
    { path: "/lendloop/other" },
    { method: "GET" },
    { timestamp: String(now + MAX_CLOCK_SKEW_MS + 1) },
    { signature: signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0") },
    { secret: "wrong-secret" },
  ]) {
    const result = verifyRequest({
      secret: SECRET,
      signature,
      timestamp,
      method: "POST",
      path: "/lendloop/request-event",
      body,
      now,
      ...tampered,
    });
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(tampered)}`);
  }

  assert.equal(
    verifyRequest({ secret: undefined, signature, timestamp, method: "POST", path: "/x", body, now }).ok,
    false,
  );
  assert.equal(
    verifyRequest({
      secret: SECRET,
      signature: null,
      timestamp: null,
      method: "POST",
      path: "/x",
      body,
      now,
    }).ok,
    false,
  );
});

test("replay window is asymmetric-safe and boundary inclusive", () => {
  const now = 1_700_000_000_000;
  const timestamp = String(now - MAX_CLOCK_SKEW_MS);
  const body = "{}";
  const signature = signRequest(SECRET, timestamp, "GET", "/automation/overdue", body);
  assert.equal(
    verifyRequest({ secret: SECRET, signature, timestamp, method: "GET", path: "/automation/overdue", body, now }).ok,
    true,
  );
  assert.equal(
    verifyRequest({
      secret: SECRET,
      signature,
      timestamp,
      method: "GET",
      path: "/automation/overdue",
      body,
      now: now + 1,
    }).ok,
    false,
  );
});

test("signBody / verifyBody round-trip", () => {
  const now = 1_700_000_000_000;
  const timestamp = String(now);
  const body = JSON.stringify({ count: 2, loans: [] });
  const signature = signBody(SECRET, timestamp, body);

  assert.equal(signBody(SECRET, timestamp, body), signature);
  assert.deepEqual(
    verifyBody({ secret: SECRET, signature, timestamp, body, now }),
    { ok: true },
  );
  assert.equal(verifyBody({ secret: SECRET, signature, timestamp, body: body + " ", now }).ok, false);
});
