#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT" -name "*.cs" -print0 \
  | xargs -0 grep -nE 'DbSet<|:\s*DbContext|public\s+(class|record)\s+' 2>/dev/null || true
