/**
 * Shared HMAC-SHA256 + signing helpers for n8n Code nodes.
 *
 * This file is injected verbatim into the three workflow JSONs by
 * `scripts/build-n8n-workflows.mjs`. It mirrors `convex/lib/hmac.ts` one-to-one;
 * `scripts/verify-webhooks.mjs` cross-checks it against Node's crypto module.
 *
 * Do not add `require()` calls here - n8n Code nodes do not guarantee them.
 */

const LL_SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const LL_SHA256_H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function llRotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function llUtf8(input) {
  const out = [];
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

function llSha256(message) {
  const len = message.length;
  const paddedLength = ((len + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLen = len * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(paddedLength - 4, bitLen >>> 0);

  const h = new Uint32Array(LL_SHA256_H0);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);

    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = llRotr(x, 7) ^ llRotr(x, 18) ^ (x >>> 3);
      const s1 = llRotr(y, 17) ^ llRotr(y, 19) ^ (y >>> 10);
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
      const S1 = llRotr(e, 6) ^ llRotr(e, 11) ^ llRotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + LL_SHA256_K[t] + w[t]) >>> 0;
      const S0 = llRotr(a, 2) ^ llRotr(a, 13) ^ llRotr(a, 22);
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

function llConcat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function llHmacSha256(key, message) {
  const normalized = key.length > 64 ? llSha256(key) : key;
  const padded = new Uint8Array(64);
  padded.set(normalized);

  const inner = new Uint8Array(64);
  const outer = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }

  return llSha256(llConcat(outer, llSha256(llConcat(inner, message))));
}

function llToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function llSha256Hex(message) {
  return llToHex(llSha256(llUtf8(message)));
}

function llHmacHex(secret, message) {
  return llToHex(llHmacSha256(llUtf8(secret), llUtf8(message)));
}

function llCanonicalString(timestamp, method, path, body) {
  return `${timestamp}\n${String(method).toUpperCase()}\n${path}\n${llSha256Hex(body)}`;
}

function llSignRequest(secret, timestamp, method, path, body) {
  return llHmacHex(secret, llCanonicalString(timestamp, method, path, body));
}

function llConstantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function llVerifyRequest(params) {
  const { secret, signature, timestamp, method, path, body } = params;
  if (!secret) return { ok: false, reason: "signing secret is not configured" };
  if (!signature || !timestamp) return { ok: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  if (Math.abs((params.now || Date.now()) - ts) > (params.maxSkewMs || 5 * 60 * 1000)) {
    return { ok: false, reason: "timestamp outside allowed skew" };
  }

  const expected = llSignRequest(secret, timestamp, method, path, body);
  if (!llConstantTimeEqual(expected, signature)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

function llSignBody(secret, timestamp, body) {
  return llHmacHex(secret, `${timestamp}\n${llSha256Hex(body)}`);
}

function llVerifyBody(params) {
  const { secret, signature, timestamp, body } = params;
  if (!secret) return { ok: false, reason: "signing secret is not configured" };
  if (!signature || !timestamp) return { ok: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  if (Math.abs((params.now || Date.now()) - ts) > (params.maxSkewMs || 5 * 60 * 1000)) {
    return { ok: false, reason: "timestamp outside allowed skew" };
  }
  if (!llConstantTimeEqual(llSignBody(secret, timestamp, body), signature)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

/** Builds the signed headers + exact body string for a callback into Convex. */
function llBuildSignedCall(params) {
  const timestamp = String(Date.now());
  return {
    timestamp,
    bodyString: params.body,
    headers: {
      "content-type": "application/json",
      "x-lendloop-timestamp": timestamp,
      "x-lendloop-signature": llSignRequest(
        params.secret,
        timestamp,
        params.method || "POST",
        params.path,
        params.body,
      ),
    },
  };
}

/**
 * Reads a secret from the n8n environment or from instance variables.
 * Self-hosted n8n needs N8N_BLOCK_ENV_ACCESS_IN_NODE=false; on n8n Cloud the
 * same names can be provided as instance variables ($vars) instead.
 */
function llConfig(name) {
  try {
    if (typeof $env !== "undefined" && $env && $env[name]) return $env[name];
  } catch (error) {
    // $env access can be blocked by configuration; fall through to $vars.
  }
  try {
    if (typeof $vars !== "undefined" && $vars && $vars[name]) return $vars[name];
  } catch (error) {
    // $vars is not available on every plan.
  }
  return undefined;
}

// Node-only export so the implementation can be cross-checked in CI. n8n Code
// nodes run without CommonJS, so this block is a no-op there.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    llConfig,
    llUtf8,
    llSha256,
    llHmacSha256,
    llToHex,
    llSha256Hex,
    llHmacHex,
    llCanonicalString,
    llSignRequest,
    llConstantTimeEqual,
    llVerifyRequest,
    llSignBody,
    llVerifyBody,
    llBuildSignedCall,
  };
}
