#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT" \( -path "*/app/**/page.tsx" -o -path "*/app/**/page.ts" -o -path "*/app/**/route.ts" -o -path "*/pages/**/*.tsx" -o -path "*/pages/**/*.ts" -o -path "*/pages/**/*.jsx" -o -path "*/pages/**/*.js" \) -type f 2>/dev/null || true
