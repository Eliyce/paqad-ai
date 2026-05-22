#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
node - "$INPUT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const parsed = JSON.parse(process.argv[2] || "{}");
  const auditPath = parsed.audit_path;

  if (!auditPath) {
    process.stderr.write(
      JSON.stringify({ message: "post-destructive-approved: missing audit_path" }),
    );
    process.exit(2);
  }

  const entry = {
    timestamp: new Date().toISOString(),
    operation: parsed.operation ?? 'unknown',
    command: parsed.command ?? null,
    approved_by: parsed.approved_by ?? 'unknown',
    actor: parsed.actor ?? 'framework',
    reason: parsed.reason ?? null,
  };

  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`);
  process.exit(0);
NODE
