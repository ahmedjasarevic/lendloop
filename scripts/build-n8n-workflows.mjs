/**
 * Builds the three importable n8n workflow JSON files.
 *
 * Why a generator instead of hand-edited JSON?
 * - The HMAC block must be byte-identical in every Code node. Inlining a 9 KB
 *   implementation by hand is how you end up with a workflow that only *looks*
 *   right. Here `n8n/lib/hmac.js` is the single source.
 * - Node graphs get stable ids, so `git diff` only shows real changes.
 *
 * Run: npm run build:n8n
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = readFileSync(join(root, "n8n", "lib", "hmac.js"), "utf8").trimEnd();

const SETTINGS = {
  executionOrder: "v1",
  saveManualExecutions: true,
  saveDataErrorExecution: "all",
  saveDataSuccessExecution: "all",
  executionTimeout: 300,
  timezone: "UTC",
};

let nodeCounter = 0;
function nodeId() {
  nodeCounter += 1;
  return `00000000-0000-4000-8000-${String(nodeCounter).padStart(12, "0")}`;
}

function codeNode(name, position, body) {
  const jsCode = [
    "// @lendloop/shared-hmac: generated from n8n/lib/hmac.js by scripts/build-n8n-workflows.mjs",
    "// Do not edit this block by hand. Run `npm run build:n8n` instead.",
    "",
    SHARED,
    "",
    body.trim(),
    "",
  ].join("\n");

  return {
    parameters: { mode: "runOnceForAllItems", jsCode },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    id: nodeId(),
    name,
  };
}

function httpNode({ name, position, method, url, headers = [], rawBody, retries = 3, onError }) {
  const parameters = {
    method,
    url,
    sendHeaders: true,
    headerParameters: { parameters: headers },
    options: {
      response: {
        response: {
          responseFormat: "text",
          fullResponse: true,
        },
      },
    },
  };

  if (rawBody) {
    parameters.sendBody = true;
    parameters.contentType = "raw";
    parameters.rawContentType = "application/json";
    parameters.body = rawBody;
  }

  const node = {
    parameters,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    id: nodeId(),
    name,
    retryOnFail: retries > 0,
    maxTries: retries,
    waitBetweenTries: 2000,
  };

  if (onError) node.onError = onError;
  return node;
}

function ifNode({ name, position, leftValue, rightValue, operator }) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [{ id: nodeId(), leftValue, rightValue, operator }],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position,
    id: nodeId(),
    name,
  };
}

function stopNode(name, position, message) {
  return {
    parameters: { errorMessage: message },
    type: "n8n-nodes-base.stopAndError",
    typeVersion: 1,
    position,
    id: nodeId(),
    name,
  };
}

/* ------------------------------------------------------------------ */
/* Workflow 1: request notifications (Convex -> n8n)                   */
/* ------------------------------------------------------------------ */

const requestNodes = [
  {
    parameters: {
      httpMethod: "POST",
      path: "lendloop/request-event",
      responseMode: "onReceived",
      options: { rawBody: true },
    },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 0],
    id: nodeId(),
    name: "Request event",
    webhookId: "lendloop-request-event",
  },
  codeNode(
    "Verify signature",
    [220, 0],
    `
const item = $input.first().json;
const headers = item.headers || {};
const raw = item.body;
const bodyString =
  typeof raw === "string"
    ? raw
    : raw && typeof raw === "object" && typeof raw.data === "string"
      ? raw.data
      : JSON.stringify(raw || {});

const verdict = llVerifyRequest({
  secret: llConfig("LENDLOOP_WEBHOOK_SECRET"),
  signature: headers["x-lendloop-signature"],
  timestamp: headers["x-lendloop-timestamp"],
  method: "POST",
  path: "/lendloop/request-event",
  body: bodyString,
});

if (!verdict.ok) {
  return [{ json: { valid: false, reason: verdict.reason } }];
}

// Parsing stays outside the signature check so malformed JSON fails loudly.
return [{ json: { valid: true, payload: JSON.parse(bodyString) } }];
`,
  ),
  ifNode({
    name: "Signature valid?",
    position: [440, 0],
    leftValue: "={{ $json.valid }}",
    rightValue: true,
    operator: { type: "boolean", operation: "true", singleValue: true },
  }),
  codeNode(
    "Compose and deliver",
    [660, 0],
    `
const payload = $input.first().json.payload;

const bodies = {
  request_created:
    payload.borrowerName + ' would like to borrow your "' + payload.toolName + '" from ' +
    payload.startDate + " to " + payload.endDate + ".",
  request_approved:
    "Good news: " + payload.ownerName + ' approved your request for "' + payload.toolName +
    '" (' + payload.startDate + " to " + payload.endDate + ").",
  request_declined:
    payload.ownerName + ' declined your request for "' + payload.toolName + '".',
  request_cancelled:
    payload.borrowerName + ' cancelled their request for "' + payload.toolName + '".',
  loan_returned:
    payload.borrowerName + ' marked "' + payload.toolName + '" as returned. Thanks!',
};

const subjects = {
  request_created: "New borrow request: " + payload.toolName,
  request_approved: "Approved: " + payload.toolName,
  request_declined: "Declined: " + payload.toolName,
  request_cancelled: "Cancelled: " + payload.toolName,
  loan_returned: "Returned: " + payload.toolName,
};

const subject = subjects[payload.event] || "LendLoop update: " + payload.toolName;
const text =
  (bodies[payload.event] || "There is an update on your LendLoop loan.") +
  "\\n\\nOpen LendLoop: " + payload.link + "\\n";

// Delivery boundary. Swap this console.log for a Gmail / SMTP / Slack node:
// the message below is already rendered and needs no further logic.
console.log('[lendloop] to=' + payload.recipient.email + ' subject="' + subject + '"\\n' + text);

return [
  {
    json: {
      payload: payload,
      delivery: {
        channel: "log",
        to: payload.recipient.email,
        subject: subject,
        text: text,
        deliveredAt: new Date().toISOString(),
      },
    },
  },
];
`,
  ),
  codeNode(
    "Build delivery receipt",
    [880, 0],
    `
const input = $input.first().json;
const payload = input.payload;
const delivery = input.delivery;
const base = String(llConfig("LENDLOOP_CONVEX_SITE_URL") || "").replace(/\\/$/, "");

if (!base) throw new Error("LENDLOOP_CONVEX_SITE_URL is not configured");

const body = JSON.stringify({
  eventId: "delivery:" + payload.eventId,
  loanId: payload.loanId,
  type: "notification_delivered",
  status: "delivered",
  detail: delivery.channel + ":" + payload.event + " -> " + delivery.to,
  occurredAt: Date.parse(delivery.deliveredAt),
});

const call = llBuildSignedCall({
  secret: llConfig("LENDLOOP_CALLBACK_SECRET"),
  path: "/automation/events",
  method: "POST",
  body: body,
});

return [{ json: { url: base + "/automation/events", ...call } }];
`,
  ),
  httpNode({
    name: "Record receipt in Convex",
    position: [1100, 0],
    method: "POST",
    url: "={{ $json.url }}",
    headers: [
      {
        name: "x-lendloop-timestamp",
        value: "={{ $json.headers['x-lendloop-timestamp'] }}",
      },
      {
        name: "x-lendloop-signature",
        value: "={{ $json.headers['x-lendloop-signature'] }}",
      },
    ],
    rawBody: "={{ $json.bodyString }}",
  }),
  stopNode(
    "Reject unsigned request",
    [660, 220],
    "={{ 'Rejected unsigned webhook: ' + $json.reason }}",
  ),
];

const requestWorkflow = {
  name: "LendLoop — Request notifications",
  nodes: requestNodes,
  connections: {
    "Request event": {
      main: [[{ node: "Verify signature", type: "main", index: 0 }]],
    },
    "Verify signature": {
      main: [[{ node: "Signature valid?", type: "main", index: 0 }]],
    },
    "Signature valid?": {
      main: [
        [{ node: "Compose and deliver", type: "main", index: 0 }],
        [{ node: "Reject unsigned request", type: "main", index: 0 }],
      ],
    },
    "Compose and deliver": {
      main: [[{ node: "Build delivery receipt", type: "main", index: 0 }]],
    },
    "Build delivery receipt": {
      main: [[{ node: "Record receipt in Convex", type: "main", index: 0 }]],
    },
  },
  active: false,
  settings: {
    ...SETTINGS,
    // Stable id of this repo's error workflow. CLI imports keep workflow ids; a
    // UI import may assign a new one, in which case re-select it in Settings.
    errorWorkflow: "1a2b3c4d-0003-4000-8000-000000000003",
  },
  staticData: null,
  meta: { templateCredsSetupCompleted: true },
  pinData: {},
  versionId: "3f9c2f0e-6a1b-4c8e-9d21-0a1b2c3d4e5f",
  id: "1a2b3c4d-0001-4000-8000-000000000001",
  tags: [],
};

/* ------------------------------------------------------------------ */
/* Workflow 2: daily overdue reminders (n8n -> Convex -> n8n)          */
/* ------------------------------------------------------------------ */

const overdueNodes = [
  {
    parameters: {
      rule: { interval: [{ field: "cronExpression", expression: "0 9 * * *" }] },
    },
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position: [0, 0],
    id: nodeId(),
    name: "Daily at 09:00 UTC",
  },
  codeNode(
    "Build signed request",
    [220, 0],
    `
const date = new Date().toISOString().slice(0, 10);
const base = String(llConfig("LENDLOOP_CONVEX_SITE_URL") || "").replace(/\\/$/, "");
if (!base) throw new Error("LENDLOOP_CONVEX_SITE_URL is not configured");

const path = "/automation/overdue?date=" + date;
const call = llBuildSignedCall({
  secret: llConfig("LENDLOOP_CALLBACK_SECRET"),
  path: path,
  method: "GET",
  body: "",
});

return [
  {
    json: {
      date: date,
      url: base + path,
      timestamp: call.headers["x-lendloop-timestamp"],
      signature: call.headers["x-lendloop-signature"],
    },
  },
];
`,
  ),
  httpNode({
    name: "Fetch overdue loans",
    position: [440, 0],
    method: "GET",
    url: "={{ $json.url }}",
    headers: [
      { name: "x-lendloop-timestamp", value: "={{ $json.timestamp }}" },
      { name: "x-lendloop-signature", value: "={{ $json.signature }}" },
    ],
  }),
  codeNode(
    "Verify response",
    [660, 0],
    `
const item = $input.first().json;
const raw =
  typeof item.body === "string"
    ? item.body
    : typeof item.data === "string"
      ? item.data
      : JSON.stringify(item.body || {});
const headers = item.headers || {};

const verdict = llVerifyBody({
  secret: llConfig("LENDLOOP_CALLBACK_SECRET"),
  signature: headers["x-lendloop-signature"],
  timestamp: headers["x-lendloop-timestamp"],
  body: raw,
});

if (!verdict.ok) {
  throw new Error("Refusing unsigned overdue response: " + verdict.reason);
}

const parsed = JSON.parse(raw);
return [{ json: { date: parsed.date, count: parsed.count, loans: parsed.loans || [] } }];
`,
  ),
  ifNode({
    name: "Any overdue?",
    position: [880, 0],
    leftValue: "={{ $json.count }}",
    rightValue: 0,
    operator: { type: "number", operation: "gt", singleValue: false },
  }),
  codeNode(
    "Prepare reminders",
    [1100, 0],
    `
const input = $input.first().json;
const loans = input.loans || [];
const base = String(llConfig("LENDLOOP_CONVEX_SITE_URL") || "").replace(/\\/$/, "");

if (loans.length === 0) return [];
if (!base) throw new Error("LENDLOOP_CONVEX_SITE_URL is not configured");

return loans.map(function (loan) {
  const subject =
    'LendLoop: "' + loan.toolName + '" is ' + loan.daysOverdue + " day(s) overdue";
  const text = [
    "Hi " + loan.borrower.name + ",",
    '"' + loan.toolName + '" was due back on ' + loan.endDate +
      ". Please return it or contact " + loan.ownerName + ".",
    "If you already returned it, open LendLoop and mark the loan as returned.",
  ].join("\\n\\n");

  // Delivery boundary, same as workflow 1. Swap for SMTP/Slack in production.
  console.log(
    "[lendloop] overdue to=" + loan.borrower.email + ' subject="' + subject + '"\\n' + text,
  );

  const body = JSON.stringify({
    eventId: "delivery:" + loan.eventId,
    loanId: loan.loanId,
    type: "overdue_reminder_delivered",
    status: "delivered",
    detail: "log:" + loan.borrower.email + " (day " + loan.daysOverdue + ")",
    occurredAt: Date.now(),
  });

  const call = llBuildSignedCall({
    secret: llConfig("LENDLOOP_CALLBACK_SECRET"),
    path: "/automation/events",
    method: "POST",
    body: body,
  });

  return { json: { url: base + "/automation/events", ...call, loanId: loan.loanId } };
});
`,
  ),
  httpNode({
    name: "Write reminder status",
    position: [1320, 0],
    method: "POST",
    url: "={{ $json.url }}",
    headers: [
      {
        name: "x-lendloop-timestamp",
        value: "={{ $json.headers['x-lendloop-timestamp'] }}",
      },
      {
        name: "x-lendloop-signature",
        value: "={{ $json.headers['x-lendloop-signature'] }}",
      },
    ],
    rawBody: "={{ $json.bodyString }}",
  }),
  {
    parameters: {},
    type: "n8n-nodes-base.noOp",
    typeVersion: 1,
    position: [1100, 220],
    id: nodeId(),
    name: "Nothing overdue",
  },
];

const overdueWorkflow = {
  name: "LendLoop — Overdue reminders",
  nodes: overdueNodes,
  connections: {
    "Daily at 09:00 UTC": {
      main: [[{ node: "Build signed request", type: "main", index: 0 }]],
    },
    "Build signed request": {
      main: [[{ node: "Fetch overdue loans", type: "main", index: 0 }]],
    },
    "Fetch overdue loans": { main: [[{ node: "Verify response", type: "main", index: 0 }]] },
    "Verify response": { main: [[{ node: "Any overdue?", type: "main", index: 0 }]] },
    "Any overdue?": {
      main: [
        [{ node: "Prepare reminders", type: "main", index: 0 }],
        [{ node: "Nothing overdue", type: "main", index: 0 }],
      ],
    },
    "Prepare reminders": {
      main: [[{ node: "Write reminder status", type: "main", index: 0 }]],
    },
  },
  active: false,
  settings: {
    ...SETTINGS,
    errorWorkflow: "1a2b3c4d-0003-4000-8000-000000000003",
  },
  staticData: null,
  meta: { templateCredsSetupCompleted: true },
  pinData: {},
  versionId: "8b7d5c3a-1e2f-4a6b-8c9d-7e6f5a4b3c2d",
  id: "1a2b3c4d-0002-4000-8000-000000000002",
  tags: [],
};

/* ------------------------------------------------------------------ */
/* Workflow 3: error handler (never fail silently)                     */
/* ------------------------------------------------------------------ */

const errorNodes = [
  {
    parameters: {},
    type: "n8n-nodes-base.errorTrigger",
    typeVersion: 1,
    position: [0, 0],
    id: nodeId(),
    name: "Workflow failed",
  },
  codeNode(
    "Format failure",
    [220, 0],
    `
const payload = $input.first().json || {};
const execution = payload.execution || {};
const workflow = payload.workflow || {};
const message =
  (execution.error && execution.error.message) || "Unknown workflow error";
const detail = (workflow.name || "unknown workflow") + ": " + message;

console.error("[lendloop] workflow failure ->", detail);

const base = String(llConfig("LENDLOOP_CONVEX_SITE_URL") || "").replace(/\\/$/, "");
if (!base) throw new Error("LENDLOOP_CONVEX_SITE_URL is not configured");

const body = JSON.stringify({
  eventId: "error:" + (execution.id || Date.now()),
  type: "workflow_failed",
  status: "failed",
  detail: detail.slice(0, 500),
  occurredAt: Date.now(),
});

const call = llBuildSignedCall({
  secret: llConfig("LENDLOOP_CALLBACK_SECRET"),
  path: "/automation/events",
  method: "POST",
  body: body,
});

return [{ json: { url: base + "/automation/events", ...call } }];
`,
  ),
  httpNode({
    name: "Report failure to Convex",
    position: [440, 0],
    method: "POST",
    url: "={{ $json.url }}",
    headers: [
      {
        name: "x-lendloop-timestamp",
        value: "={{ $json.headers['x-lendloop-timestamp'] }}",
      },
      {
        name: "x-lendloop-signature",
        value: "={{ $json.headers['x-lendloop-signature'] }}",
      },
    ],
    rawBody: "={{ $json.bodyString }}",
    retries: 2,
    // If Convex is down we must not trigger the error workflow recursively.
    onError: "continueRegularOutput",
  }),
];

const errorWorkflow = {
  name: "LendLoop — Error handler",
  nodes: errorNodes,
  connections: {
    "Workflow failed": { main: [[{ node: "Format failure", type: "main", index: 0 }]] },
    "Format failure": {
      main: [[{ node: "Report failure to Convex", type: "main", index: 0 }]],
    },
  },
  active: false,
  settings: SETTINGS,
  staticData: null,
  meta: { templateCredsSetupCompleted: true },
  pinData: {},
  versionId: "c4d5e6f7-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
  id: "1a2b3c4d-0003-4000-8000-000000000003",
  tags: [],
};

/* ------------------------------------------------------------------ */

const outputs = [
  ["lendloop-request-notifications.json", requestWorkflow],
  ["lendloop-overdue-reminders.json", overdueWorkflow],
  ["lendloop-error-handler.json", errorWorkflow],
];

for (const [filename, workflow] of outputs) {
  writeFileSync(join(root, "n8n", filename), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  console.log(
    `wrote n8n/${filename} (${workflow.nodes.length} nodes, ${(JSON.stringify(workflow).length / 1024).toFixed(1)} KB)`,
  );
}
