/**
 * Static checks for the exported n8n workflows. This is the closest thing to an
 * integration test without spinning up n8n in CI:
 *
 * - every file is valid JSON with the expected node/connection shape
 * - every connection points at a node that exists
 * - every node is reachable from a trigger (no dead branches)
 * - Code node scripts are syntactically valid JavaScript
 * - no secret material is embedded in the exported JSON
 *
 * Run: npm run validate:n8n
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "n8n");

const TRIGGERS = new Set([
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.errorTrigger",
]);

const errors = [];
const files = readdirSync(dir).filter((file) => file.endsWith(".json"));

function fail(file, message) {
  errors.push(`${file}: ${message}`);
}

if (files.length < 3) {
  fail("n8n/", `expected at least 3 workflow files, found ${files.length}`);
}

for (const file of files) {
  const raw = readFileSync(join(dir, file), "utf8");

  let workflow;
  try {
    workflow = JSON.parse(raw);
  } catch (error) {
    fail(file, `invalid JSON (${error.message})`);
    continue;
  }

  if (typeof workflow.name !== "string" || workflow.name.length === 0) {
    fail(file, "missing workflow name");
  }
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    fail(file, "missing nodes");
    continue;
  }
  if (typeof workflow.connections !== "object" || workflow.connections === null) {
    fail(file, "missing connections");
  }

  const names = new Set();
  for (const node of workflow.nodes) {
    for (const key of ["id", "name", "type", "typeVersion", "position", "parameters"]) {
      if (node[key] === undefined) fail(file, `node ${node.name ?? "?"} missing ${key}`);
    }
    if (names.has(node.name)) fail(file, `duplicate node name ${node.name}`);
    names.add(node.name);
    if (!Array.isArray(node.position) || node.position.length !== 2) {
      fail(file, `node ${node.name} has invalid position`);
    }

    if (node.type === "n8n-nodes-base.code") {
      const jsCode = node.parameters?.jsCode;
      if (typeof jsCode !== "string" || jsCode.length < 100) {
        fail(file, `code node ${node.name} has no script`);
      } else {
        try {
          // Compiles without executing; catches syntax errors in exported workflows.
          new Function(jsCode);
        } catch (error) {
          fail(file, `code node ${node.name} has invalid JavaScript: ${error.message}`);
        }
        if (!jsCode.includes("llVerifyRequest") && !jsCode.includes("llSignRequest")) {
          fail(file, `code node ${node.name} does not use the shared signing helpers`);
        }
      }
    }

    if (node.type === "n8n-nodes-base.webhook") {
      if (node.parameters?.options?.rawBody !== true) {
        fail(file, `webhook ${node.name} must keep rawBody enabled for signature verification`);
      }
    }

    if (node.credentials) {
      fail(file, `node ${node.name} embeds credentials in the export`);
    }
  }

  // Connections must reference known nodes, and nothing may be orphaned.
  const adjacency = new Map();
  for (const [source, groups] of Object.entries(workflow.connections ?? {})) {
    if (!names.has(source)) fail(file, `connection from unknown node ${source}`);
    const targets = [];
    for (const output of groups.main ?? []) {
      for (const connection of output ?? []) {
        if (!names.has(connection.node)) {
          fail(file, `connection to unknown node ${connection.node}`);
        }
        targets.push(connection.node);
      }
    }
    adjacency.set(source, targets);
  }

  const triggers = workflow.nodes.filter((node) => TRIGGERS.has(node.type)).map((n) => n.name);
  if (triggers.length === 0) fail(file, "no trigger node");

  const visited = new Set();
  const queue = [...triggers];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) queue.push(next);
  }
  for (const name of names) {
    if (!visited.has(name)) fail(file, `node ${name} is unreachable from a trigger`);
  }

  // Secret material must never live in an exported workflow.
  const secretPatterns = [
    { re: /[0-9a-f]{32,}/i, label: "long hex string (possible secret)" },
    { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "private key" },
    { re: /\bsk_(live|test)_[A-Za-z0-9]+/, label: "Stripe-style key" },
    { re: /\bxox[baprs]-[A-Za-z0-9-]+/, label: "Slack token" },
    { re: /password"?\s*:\s*"[^"]+"/i, label: "inline password" },
  ];
  for (const { re, label } of secretPatterns) {
    if (re.test(raw)) fail(file, `contains ${label}`);
  }
}

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) found:\n`);
  for (const error of errors) console.error(`  ✖ ${error}`);
  process.exit(1);
}

console.log(`✔ ${files.length} workflow files validated (structure, graph, JS syntax, no secrets)`);
