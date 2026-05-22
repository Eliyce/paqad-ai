#!/usr/bin/env bash
# Purpose: Merge multiple advisory artifacts (npm audit, pnpm audit, OSV, etc.)
#          into one dedup'd JSONL stream keyed by (ecosystem, package, advisory_id).
# Usage:   bash scripts/normalize-advisories.sh <artifact> [<artifact> ...]
# Output:  One JSON object per line: {ecosystem,package,version,advisory_id,severity,title,sources}
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ "$#" -ge 1 ] || { printf 'usage: %s <artifact> ...\n' "$0" >&2; exit 2; }

node -e '
const fs = require("fs");
const path = require("path");

const seen = new Map();

function add(eco, pkg, version, adv, severity, title, source) {
  const key = `${eco}|${pkg}|${adv}`;
  const cur = seen.get(key) || { ecosystem: eco, package: pkg, version, advisory_id: adv, severity, title, sources: [] };
  if (severity && (!cur.severity || severityRank(severity) > severityRank(cur.severity))) cur.severity = severity;
  if (title && title.length > (cur.title?.length || 0)) cur.title = title;
  if (!cur.sources.includes(source)) cur.sources.push(source);
  seen.set(key, cur);
}

function severityRank(s) { return ({critical:4, high:3, moderate:2, medium:2, low:1, info:0})[s.toLowerCase()] || 0; }

for (const file of process.argv.slice(1)) {
  if (!fs.existsSync(file)) { console.error("missing: " + file); continue; }
  const txt = fs.readFileSync(file, "utf8");
  const source = path.basename(file);
  // Try JSON.
  let data; try { data = JSON.parse(txt); } catch { data = null; }
  if (!data) continue;

  // npm/pnpm audit shape: { vulnerabilities: { pkg: { name, severity, via: [...] } } }
  if (data.vulnerabilities && typeof data.vulnerabilities === "object") {
    for (const [name, v] of Object.entries(data.vulnerabilities)) {
      const sev = v.severity || "info";
      const via = Array.isArray(v.via) ? v.via : [];
      const advs = via.filter(x => typeof x === "object" && (x.url || x.source)).map(x => x.url || ("npm-" + (x.source || "0")));
      const ids = advs.length ? advs : ["npm-" + name];
      for (const id of ids) add("npm", name, v.range || "", id, sev, (typeof via[0] === "object" && via[0].title) || "", source);
    }
  }

  // OSV shape: { vulns: [ { id, summary, affected: [{package:{ecosystem,name}, ranges}], database_specific:{severity}}]}
  if (Array.isArray(data.vulns)) {
    for (const v of data.vulns) {
      const sev = v.database_specific?.severity || "info";
      for (const aff of (v.affected || [])) {
        const eco = aff.package?.ecosystem || "?";
        const pkg = aff.package?.name || "?";
        add(eco.toLowerCase(), pkg, "", v.id || "?", sev, v.summary || "", source);
      }
    }
  }
}

for (const v of seen.values()) console.log(JSON.stringify(v));
' "$@"
