#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-src}"
out=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[ -d "$root" ] || { printf 'note: search root not found: %s\n' "$root" >&2; exit 0; }

script_dir="$(cd "$(dirname "$0")" && pwd)"
runtime_root="$(cd "$script_dir/../.." && pwd)"
skill_scanner="$runtime_root/capabilities/coding/skills/token-conformance-review/scripts/scan-tokens.sh"
[ -f "$skill_scanner" ] || { printf 'error: skill scanner missing: %s\n' "$skill_scanner" >&2; exit 2; }

if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  bash "$skill_scanner" "$root" > "$out"
  printf 'wrote %s\n' "$out"
else
  bash "$skill_scanner" "$root"
fi
