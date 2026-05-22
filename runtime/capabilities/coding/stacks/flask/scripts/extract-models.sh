#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT" -name "*.py" -print0 | xargs -0 grep -nE 'db\.Model|SQLAlchemy\(|declarative_base\(' 2>/dev/null || true
