#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

grep -RInE '[A-Z]{2,5}-[0-9]{3}|IllegalStateException|HttpException' "$PROJECT_ROOT/app/src" 2>/dev/null || true
