#!/bin/bash
# silent-update.sh — version check and background update hook
# Called at the start of every agent session. Always exits 0.
# Never blocks, prompts, or produces visible output to the user.
set +e
trap 'exit 0' ERR EXIT

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERSION_FILE="$PROJECT_ROOT/.paqad/framework-version.txt"
PROFILE_FILE="$PROJECT_ROOT/.paqad/project-profile.yaml"
LOCKFILE="$PROJECT_ROOT/.paqad/locks/update.lock"
LOGS_DIR="$PROJECT_ROOT/.paqad/logs"

# ── Step 1: Read local version ───────────────────────────────────────────────
[ ! -f "$VERSION_FILE" ] && exit 0
CURRENT_VERSION=$(grep '^version=' "$VERSION_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
[ -z "$CURRENT_VERSION" ] && exit 0

# ── Step 2: Check skip conditions ────────────────────────────────────────────
# 2a — skip_version_check flag
if [ -f "$PROFILE_FILE" ] && command -v python3 &>/dev/null; then
  SKIP=$(python3 -c "
import re
try:
    content = open('$PROFILE_FILE').read()
    if re.search(r'skip_version_check:\s*true', content):
        print('true')
    else:
        print('false')
except:
    print('false')
" 2>/dev/null)
  [ "$SKIP" = "true" ] && exit 0
fi

# 2b — interval check
INTERVAL=12
if [ -f "$PROFILE_FILE" ] && command -v python3 &>/dev/null; then
  INTERVAL=$(python3 -c "
import re
try:
    content = open('$PROFILE_FILE').read()
    m = re.search(r'version_check_interval_hours:\s*(\d+)', content)
    print(m.group(1) if m else '12')
except:
    print('12')
" 2>/dev/null)
  INTERVAL="${INTERVAL:-12}"
fi

UPDATED_AT=$(grep '^updated_at=' "$VERSION_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
if [ -n "$UPDATED_AT" ] && command -v python3 &>/dev/null; then
  NOW_EPOCH=$(python3 -c "import time; print(int(time.time()))" 2>/dev/null || echo 0)
  UPDATED_EPOCH=$(python3 -c "
from datetime import datetime, timezone
try:
    s = '$UPDATED_AT'.replace('Z', '+00:00')
    dt = datetime.fromisoformat(s)
    print(int(dt.timestamp()))
except:
    print(0)
" 2>/dev/null || echo 0)
  if [ "$NOW_EPOCH" -gt 0 ] && [ "$UPDATED_EPOCH" -gt 0 ]; then
    ELAPSED=$(( (NOW_EPOCH - UPDATED_EPOCH) / 3600 ))
    if [ "$ELAPSED" -lt "$INTERVAL" ] 2>/dev/null; then
      exit 0
    fi
  fi
fi

# ── Step 3: Fetch latest version from npm (5s timeout) ───────────────────────
if ! command -v npm &>/dev/null; then
  exit 0
fi
LATEST_VERSION=$(timeout 5 npm view paqad-ai version 2>/dev/null || true)
[ -z "$LATEST_VERSION" ] && exit 0

# ── Step 4: Compare versions ─────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  exit 0
fi
node -e "
const cur = '$CURRENT_VERSION'.split('.').map(Number);
const lat = '$LATEST_VERSION'.split('.').map(Number);
for (let i = 0; i < 3; i++) {
  if ((cur[i]||0) < (lat[i]||0)) process.exit(1);
  if ((cur[i]||0) > (lat[i]||0)) process.exit(0);
}
process.exit(0);
" 2>/dev/null
COMPARE_EXIT=$?

if [ "$COMPARE_EXIT" -ne 1 ]; then
  # Already up to date — touch updated_at so the interval window resets
  NOW_ISO=$(python3 -c "from datetime import datetime,timezone; print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))" 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)
  if [ -n "$NOW_ISO" ]; then
    sed -i.bak "s/^updated_at=.*/updated_at=$NOW_ISO/" "$VERSION_FILE" 2>/dev/null && rm -f "${VERSION_FILE}.bak" 2>/dev/null
  fi
  exit 0
fi

# ── Step 5: Acquire lockfile and spawn background update ─────────────────────
mkdir -p "$PROJECT_ROOT/.paqad/locks" 2>/dev/null || true
mkdir -p "$LOGS_DIR" 2>/dev/null || true

# Try lockfile — skip silently if another update is running
exec 200>"$LOCKFILE" 2>/dev/null || exit 0
flock -n 200 2>/dev/null || exit 0

nohup npx paqad-ai@latest update --silent \
  >"$LOGS_DIR/auto-update.log" 2>&1 &
disown 2>/dev/null || true

exit 0
