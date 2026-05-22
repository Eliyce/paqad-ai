#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT" -name "*.py" -print0 | xargs -0 grep -nE '@[A-Za-z_][A-Za-z0-9_]*\.route\(|@app\.route\(' 2>/dev/null || true
