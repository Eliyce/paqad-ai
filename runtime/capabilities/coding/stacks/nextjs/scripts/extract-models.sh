#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT" \( -name "schema.prisma" -o -path "*/models/*" -o -path "*/lib/db/*" \) -type f 2>/dev/null || true
