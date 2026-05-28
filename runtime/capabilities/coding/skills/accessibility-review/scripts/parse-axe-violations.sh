#!/usr/bin/env bash
# Purpose: Parse the JSON axe-core results emitted by runtime-checks.ts and
#          collapse them into flat TSV rows the LLM can drive findings from.
#
# Usage:   bash scripts/parse-axe-violations.sh <axe-results.json>
#
#          The input may be either:
#            - the full runtime-checks.json (with .routes[].breakpoints[].axe_violations)
#            - or a bare array of axe violation objects (test scaffolding)
#
# Output:  one TSV row per (route, axe-rule, node-target) triple, to stdout:
#            <route>\t<rule-id>\t<impact>\t<target>\t<help>
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

file="${1:-}"
[ -n "$file" ] || { printf 'error: axe-results JSON path is required\n' >&2; exit 2; }
[ -f "$file" ] || { printf 'error: file not found: %s\n' "$file" >&2; exit 2; }

node - "$file" <<'NODE'
const fs = require('node:fs');
const [, , path] = process.argv;
let data;
try { data = JSON.parse(fs.readFileSync(path, 'utf8')); }
catch (e) { console.error('error: invalid JSON: ' + e.message); process.exit(2); }

const out = [];
const emitViolations = (route, violations) => {
  if (!Array.isArray(violations)) return;
  for (const v of violations) {
    const id = v.id ?? 'unknown';
    const impact = v.impact ?? 'unknown';
    const help = (v.help ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ').slice(0, 140);
    const nodes = Array.isArray(v.nodes) && v.nodes.length > 0 ? v.nodes : [{ target: ['(no-target)'] }];
    for (const node of nodes) {
      const target = Array.isArray(node.target) ? node.target.join(' ') : String(node.target ?? '(no-target)');
      out.push([route, id, impact, target, help].join('\t'));
    }
  }
};

if (Array.isArray(data)) {
  emitViolations('(route-unknown)', data);
} else if (data && Array.isArray(data.routes)) {
  for (const r of data.routes) {
    const route = r.path ?? '(unknown)';
    for (const bp of r.breakpoints ?? []) {
      emitViolations(route, bp.axe_violations);
    }
  }
} else {
  console.error('error: expected an array of violations OR a runtime-checks.json with .routes[]');
  process.exit(2);
}

for (const line of out) console.log(line);
NODE
