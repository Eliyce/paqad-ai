#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT" \( -path "*/Controllers/*.cs" -o -path "*/Endpoints/*.cs" -o -name "Program.cs" \) -type f -print0 \
  | xargs -0 grep -nE '\[(Route|HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)|\.(MapGet|MapPost|MapPut|MapDelete|MapPatch)\(' 2>/dev/null || true
