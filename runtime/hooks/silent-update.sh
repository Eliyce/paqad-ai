#!/bin/bash
# silent-update.sh — SessionStart version-check + forced background self-update.
#
# Keeps the globally-installed paqad-ai CLI current by running
#   npm install -g paqad-ai@latest
# in the background whenever a newer version exists. Never blocks, never
# prompts, never produces visible output to the user. Always exits 0.
#
# Update policy (resolved decision D-2):
#   - The "allowed" window is the latest minor and the one before it, within
#     the SAME major (e.g. latest 1.15.x => 1.15.x and 1.14.x are allowed).
#   - ANY newer version triggers a background `npm install -g paqad-ai@latest`
#     followed by `paqad-ai update --silent` to resync project artifacts.
#   - Being out-of-window (a minor older than the 2-minor band, or any older
#     major) is recorded as a FORCED update in the audit log so the gap is
#     visible. The action is identical (always background, never blocking) but
#     classified so we can see who has fallen too far behind.
#
# Project root is resolved from the host-provided env vars (CLAUDE_PROJECT_DIR /
# PAQAD_PROJECT_ROOT), falling back to the current working directory. This lets
# the single global copy under ~/.paqad-ai/current/hooks/ operate on whichever
# project the session is in — it does NOT derive the root from its own location.
set +e
trap 'exit 0' ERR EXIT

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-${PAQAD_PROJECT_ROOT:-$(pwd)}}"
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

# ── Step 3: Fetch latest version from npm (5s timeout when available) ─────────
# `timeout` ships with GNU coreutils (Linux/CI) but not stock macOS, so fall
# back to `gtimeout` and finally a bare `npm` call. Without this fallback the
# version check silently no-ops on every macOS machine.
if ! command -v npm &>/dev/null; then
  exit 0
fi
if command -v timeout &>/dev/null; then
  LATEST_VERSION=$(timeout 5 npm view paqad-ai version 2>/dev/null || true)
elif command -v gtimeout &>/dev/null; then
  LATEST_VERSION=$(gtimeout 5 npm view paqad-ai version 2>/dev/null || true)
else
  LATEST_VERSION=$(npm view paqad-ai version 2>/dev/null || true)
fi
[ -z "$LATEST_VERSION" ] && exit 0

# ── Step 4: Classify against the two-minor policy ────────────────────────────
# Prints one of: "current" | "routine" | "forced".
#   current  — already on (or ahead of) latest; nothing to do.
#   routine  — behind, but inside the allowed 2-minor window of latest.
#   forced   — out-of-window: older minor beyond the band, or an older major.
if ! command -v node &>/dev/null; then
  exit 0
fi
DECISION=$(node -e "
const cur = '$CURRENT_VERSION'.split('.').map(Number);
const lat = '$LATEST_VERSION'.split('.').map(Number);
const cmaj = cur[0]||0, cmin = cur[1]||0, cpatch = cur[2]||0;
const lmaj = lat[0]||0, lmin = lat[1]||0, lpatch = lat[2]||0;
const behind =
  cmaj < lmaj ||
  (cmaj === lmaj && cmin < lmin) ||
  (cmaj === lmaj && cmin === lmin && cpatch < lpatch);
if (!behind) { console.log('current'); process.exit(0); }
// Allowed window: same major AND within the last two minors (>= latest minor - 1).
const inWindow = cmaj === lmaj && cmin >= lmin - 1;
console.log(inWindow ? 'routine' : 'forced');
" 2>/dev/null)
[ -z "$DECISION" ] && exit 0

NOW_ISO=$(python3 -c "from datetime import datetime,timezone; print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))" 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)

if [ "$DECISION" = "current" ]; then
  # Already up to date — touch updated_at so the interval window resets.
  if [ -n "$NOW_ISO" ]; then
    sed -i.bak "s/^updated_at=.*/updated_at=$NOW_ISO/" "$VERSION_FILE" 2>/dev/null && rm -f "${VERSION_FILE}.bak" 2>/dev/null
  fi
  exit 0
fi

# ── Step 5: Acquire lock and spawn background global self-update ──────────────
mkdir -p "$PROJECT_ROOT/.paqad/locks" 2>/dev/null || true
mkdir -p "$LOGS_DIR" 2>/dev/null || true

# Single-flight lock. `flock` is GNU-only (Linux/CI) and absent on stock macOS,
# so fall back to a portable atomic-mkdir lock. Skip silently if another update
# is already running; reap a lock left behind by a killed run after 60 min.
if command -v flock &>/dev/null; then
  exec 200>"$LOCKFILE" 2>/dev/null || exit 0
  flock -n 200 2>/dev/null || exit 0
else
  LOCKDIR="$LOCKFILE.d"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    if [ -d "$LOCKDIR" ] && [ -n "$(find "$LOCKDIR" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
      rmdir "$LOCKDIR" 2>/dev/null || true
      mkdir "$LOCKDIR" 2>/dev/null || exit 0
    else
      exit 0
    fi
  fi
  trap 'rmdir "$LOCKDIR" 2>/dev/null; exit 0' EXIT
fi

# Record intent synchronously (before detaching) so the audit log captures the
# classification even if the background install is slow or fails.
echo "[${NOW_ISO:-unknown}] INFO silent-update $DECISION self-update $CURRENT_VERSION -> $LATEST_VERSION (npm install -g paqad-ai@latest)" \
  >> "$LOGS_DIR/auto-update.log" 2>/dev/null || true

# Force the actual global upgrade, then resync project artifacts with the new
# CLI. Background + disown so session start is never blocked (decision D-2).
nohup sh -c 'npm install -g paqad-ai@latest && paqad-ai update --silent' \
  >>"$LOGS_DIR/auto-update.log" 2>&1 &
disown 2>/dev/null || true

exit 0
