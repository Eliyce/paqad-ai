#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT/src" -name "*.ts" -print0 2>/dev/null | xargs -0 grep -nE '@Entity\(|model\s+[A-Z]|class\s+.*(Dto|Entity)' 2>/dev/null || true
