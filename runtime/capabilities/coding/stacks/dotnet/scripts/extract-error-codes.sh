#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT" -name "*.cs" -print0 \
  | xargs -0 grep -nE 'Problem\(|StatusCode\(|BadRequest\(|NotFound\(|Unauthorized\(|Conflict\(' 2>/dev/null || true
