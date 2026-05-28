#!/usr/bin/env bash
# Purpose: Run axe-core against component snapshots (HTML output) without
#          booting the dev server. Designed for the "static-first" pass — the
#          live phase (runtime-checks.ts) does the same against the running app.
# Usage:   bash runtime/scripts/design/axe-static.sh [--snapshots <dir>] [--out <path>]
#          Default snapshots dir: storybook-static (Storybook build) or
#          .paqad/design-test/snapshots/ if the project produces its own.
# Exits:   0 ok | 1 missing inputs (treated as blocked_check) | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

snapshots=""
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --snapshots) snapshots="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -z "$snapshots" ]; then
  if [ -d "storybook-static" ]; then snapshots="storybook-static";
  elif [ -d ".paqad/design-test/snapshots" ]; then snapshots=".paqad/design-test/snapshots";
  else
    printf 'blocked: no snapshots dir found (Storybook build or .paqad/design-test/snapshots/)\n' >&2
    [ -n "$out" ] && { mkdir -p "$(dirname "$out")"; printf '{ "blocked": "no-snapshots", "violations": [] }\n' > "$out"; }
    exit 1
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  printf 'error: node is required\n' >&2
  exit 2
fi

# axe-core is expected to be on the framework side (paqad-ai dep), not the
# project's. We invoke it via a small inline runner.
node - "$snapshots" "$out" <<'NODE'
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
const [, , snapshotsDir, outPath] = process.argv;

let axe;
try { axe = await import('axe-core'); } catch {
  const payload = { blocked: 'axe-core-not-installed', violations: [] };
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n'); }
  else console.log(JSON.stringify(payload, null, 2));
  process.exit(1);
}

let jsdom;
try { jsdom = await import('jsdom'); } catch {
  const payload = { blocked: 'jsdom-not-installed', violations: [] };
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n'); }
  else console.log(JSON.stringify(payload, null, 2));
  process.exit(1);
}

const allViolations = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extname(entry.name) === '.html') {
      const html = readFileSync(full, 'utf8');
      const dom = new jsdom.JSDOM(html, { runScripts: 'outside-only' });
      const { window } = dom;
      try {
        const results = axe.default ? axe.default.run(window.document) : axe.run(window.document);
        const r = results.then ? null : results;
        if (r) for (const v of r.violations || []) allViolations.push({ file: full, ...v });
      } catch (e) { allViolations.push({ file: full, error: String(e) }); }
    }
  }
};
walk(snapshotsDir);

const payload = { violations: allViolations };
if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n'); }
else console.log(JSON.stringify(payload, null, 2));
NODE
