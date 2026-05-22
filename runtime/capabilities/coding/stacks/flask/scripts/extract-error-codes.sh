#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT" -name "*.py" -print0 | xargs -0 grep -nE 'abort\(|HTTPException|[A-Z]{2,5}-[0-9]{3}' 2>/dev/null || true
