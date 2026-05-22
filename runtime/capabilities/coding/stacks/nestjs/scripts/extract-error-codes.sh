#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

find "$PROJECT_ROOT/src" -name "*.ts" -print0 2>/dev/null | xargs -0 grep -nE 'HttpException|RpcException|[A-Z]{2,5}-[0-9]{3}' 2>/dev/null || true
