#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-.}"

grep -RInE 'android:name=|NavHost|composable\(' "$PROJECT_ROOT/app/src/main" 2>/dev/null || true
