#!/usr/bin/env bash
# Purpose: Probe a list of high-signal paths on a locally running app and
#          report status codes for the LLM to triage. Safe (GET only).
# Usage:   bash scripts/probe-surfaces.sh <base-url> [paths-file]
#          paths-file: one path per non-comment line (default: assets/probe-paths.txt)
# Output:  status | path
# Exits:   0 ok | 1 base unreachable | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -n "${1:-}" ] || { printf 'usage: %s <base-url> [paths-file]\n' "$0" >&2; exit 2; }
base="${1%/}"

dir="$(cd "$(dirname "$0")" && pwd)"
paths="${2:-$dir/../assets/probe-paths.txt}"
[ -f "$paths" ] || { printf 'error: paths file not found: %s\n' "$paths" >&2; exit 2; }

# Confirm base reachable. curl writes the HTTP code (or "000" on connect-refused/dns-fail) to stdout.
base_status=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$base/" 2>/dev/null || true)
[ -z "$base_status" ] && base_status="000"
if [ "$base_status" = "000" ]; then
  printf 'error: base unreachable: %s\n' "$base" >&2
  exit 1
fi

printf 'status | path\n'
while IFS= read -r p; do
  case "$p" in ''|\#*) continue ;; esac
  status=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$base$p" 2>/dev/null || true)
  [ -z "$status" ] && status="000"
  printf '%s | %s\n' "$status" "$p"
done < "$paths"
