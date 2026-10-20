#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

sidecar=""
run_id="retest-$(date +%s)"
while [ $# -gt 0 ]; do
  case "$1" in
    --sidecar) sidecar="$2"; shift 2 ;;
    --run-id) run_id="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[ -n "$sidecar" ] || { printf 'error: --sidecar <path> is required\n' >&2; exit 2; }
[ -f "$sidecar" ] || { printf 'error: sidecar not found: %s\n' "$sidecar" >&2; exit 2; }

artifact_dir=".paqad/design-test/runs/${run_id}/artifacts"
mkdir -p "$artifact_dir"

printf 'design-retest run_id=%s sidecar=%s\n' "$run_id" "$sidecar"

bash runtime/scripts/design/scan-tokens.sh src --out "$artifact_dir/scan-tokens.txt" || true
bash runtime/scripts/design/scan-overrides.sh src --out "$artifact_dir/scan-overrides.txt" || true

cp "$sidecar" "$artifact_dir/source-sidecar.json"

if [ -n "${DESIGN_TEST_TARGET_URL:-}" ]; then
  DESIGN_TEST_RUN_ID="$run_id" DESIGN_TEST_ARTIFACT_DIR="$artifact_dir" \
    npx tsx runtime/scripts/design/runtime-checks.ts || true
fi

printf 'retest evidence ready at %s\n' "$artifact_dir"
