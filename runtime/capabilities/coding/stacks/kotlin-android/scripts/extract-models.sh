#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

grep -RInE '@Entity|data class |RoomDatabase' "$PROJECT_ROOT/app/src" 2>/dev/null || true
