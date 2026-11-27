/**
 * Dependency-free HMAC-SHA256 + request-signing primitives.
 *
 * Why not `node:crypto` or WebCrypto?
 * The exact same code has to run in three places:
 *   1. Convex functions (V8 isolate runtime, no Node built-ins).
 *   2. Convex HTTP actions (same isolate).
 *   3. n8n Code nodes (sandboxed VM where `require("crypto")` is not guaranteed).
 *
 * A single pure implementation keeps the canonical string byte-identical on both
 * sides of the integration. `hmac.test.ts` verifies it against Node's `crypto`
 * module so this is not "trust me" crypto.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** UTF-8 encoder that does not rely on TextEncoder being present in the runtime. */
export function utf8(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(++i);
      code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

export function sha256(message: Uint8Array): Uint8Array {
  const len = message.length;
  const paddedLength = ((len + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLen = len * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(paddedLength - 4, bitLen >>> 0);

  const h = new Uint32Array(H0);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);

    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

const BLOCK_SIZE = 64;

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const normalized = key.length > BLOCK_SIZE ? sha256(key) : key;
  const padded = new Uint8Array(BLOCK_SIZE);
  padded.set(normalized);

  const inner = new Uint8Array(BLOCK_SIZE);
  const outer = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }

  return sha256(concat(outer, sha256(concat(inner, message))));
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return new Uint8Array(0);
    out[i] = byte;
  }
  return out;
}

/** Length-independent comparison to avoid leaking signature prefixes via timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function hmacHex(secret: string, message: string): string {
  return toHex(hmacSha256(utf8(secret), utf8(message)));
}

export function sha256Hex(message: string): string {
  return toHex(sha256(utf8(message)));
}

/**
 * Canonical string used for every signed HTTP call in either direction:
 *
 *   <timestamp>\n<METHOD>\n<path[?query]>\n<sha256(raw body)>
 *
 * Hashing the body first means the signature is stable regardless of how a
 * proxy re-serializes JSON, and including the method/path prevents a captured
 * signature from being replayed against a different endpoint.
 */
export function canonicalString(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${sha256Hex(body)}`;
}

export function signRequest(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
): string {
  return hmacHex(secret, canonicalString(timestamp, method, path, body));
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
/** 5 minutes: enough for clock drift and slow deliveries, short enough to bound replay. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function verifyRequest(params: {
  secret: string | undefined;
  signature: string | null;
  timestamp: string | null;
  method: string;
  path: string;
  body: string;
  now?: number;
  maxSkewMs?: number;
}): VerifyResult {
  const { secret, signature, timestamp, method, path, body } = params;
  if (!secret) return { ok: false, reason: "signing secret is not configured" };
  if (!signature || !timestamp) return { ok: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };

  const skew = Math.abs((params.now ?? Date.now()) - ts);
  if (skew > (params.maxSkewMs ?? MAX_CLOCK_SKEW_MS)) return { ok: false, reason: "timestamp outside allowed skew" };

  const expected = signRequest(secret, timestamp, method, path, body);
  if (!constantTimeEqual(expected, signature)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

/** Response signing (server -> n8n) uses a shorter canonical form: timestamp + body hash. */
export function signBody(secret: string, timestamp: string, body: string): string {
  return hmacHex(secret, `${timestamp}\n${sha256Hex(body)}`);
}

export function verifyBody(params: {
  secret: string | undefined;
  signature: string | null;
  timestamp: string | null;
  body: string;
  now?: number;
  maxSkewMs?: number;
}): VerifyResult {
  const { secret, signature, timestamp, body } = params;
  if (!secret) return { ok: false, reason: "signing secret is not configured" };
  if (!signature || !timestamp) return { ok: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  if (Math.abs((params.now ?? Date.now()) - ts) > (params.maxSkewMs ?? MAX_CLOCK_SKEW_MS)) {
    return { ok: false, reason: "timestamp outside allowed skew" };
  }

  if (!constantTimeEqual(signBody(secret, timestamp, body), signature)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
