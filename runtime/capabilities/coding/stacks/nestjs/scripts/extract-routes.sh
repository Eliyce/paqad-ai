#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT/src" -name "*.controller.ts" -print0 2>/dev/null | xargs -0 grep -nE '@Controller\(|@(Get|Post|Put|Delete|Patch|All|Head|Options)\(' 2>/dev/null || true
