#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

grep -RInE 'NEXT_[A-Z_]+|[A-Z]{2,5}-[0-9]{3}' "$PROJECT_ROOT/app" "$PROJECT_ROOT/src" "$PROJECT_ROOT/pages" 2>/dev/null || true
