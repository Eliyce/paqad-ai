#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
node - "$INPUT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const parsed = JSON.parse(process.argv[2] || "{}");
  const progressPath = parsed.doc_progress_path;

  if (!progressPath) {
    process.stderr.write(
      JSON.stringify({ message: "reset-doc-progress: missing doc_progress_path" }),
    );
    process.exit(2);
  }

  if (!fs.existsSync(progressPath)) {
    process.stdout.write(JSON.stringify({ reset: [], missing: true }, null, 2));
    process.exit(0);
  }

  const projectRoot = parsed.project_root ?? process.cwd();
  const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
  const groups = [
    ...Object.values(progress.modules ?? {}),
    ...Object.values(progress.global ?? {}),
  ];
  const reset = [];

  for (const group of groups) {
    for (const entry of Object.values(group)) {
      if (!entry || entry.state !== 'generating') {
        continue;
      }

      entry.state = 'not_started';
      entry.started_at = null;
      entry.completed_at = null;
      entry.error = null;
      reset.push(entry.output_path);
      fs.rmSync(path.join(projectRoot, entry.output_path), { force: true });
    }
  }

  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ reset }, null, 2)}\n`);
  process.exit(0);
NODE
