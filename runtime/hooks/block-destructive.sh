#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d||'{}');process.stdout.write(j.command||'')}catch{}})")

# Normalize to uppercase for case-insensitive matching
UPPER_CMD=$(printf '%s' "$COMMAND" | tr '[:lower:]' '[:upper:]')

BLOCKED=false
REASON=""

# SQL destructive operations (case-insensitive)
if [[ "$UPPER_CMD" == *"DROP TABLE"* ]]; then BLOCKED=true; REASON="DROP TABLE"; fi
if [[ "$UPPER_CMD" == *"DROP COLUMN"* ]]; then BLOCKED=true; REASON="DROP COLUMN"; fi
if [[ "$UPPER_CMD" == *"DROP INDEX"* ]]; then BLOCKED=true; REASON="DROP INDEX"; fi
if [[ "$UPPER_CMD" == *"DROP DATABASE"* ]]; then BLOCKED=true; REASON="DROP DATABASE"; fi
if [[ "$UPPER_CMD" == *"TRUNCATE TABLE"* ]]; then BLOCKED=true; REASON="TRUNCATE TABLE"; fi
if [[ "$UPPER_CMD" == *"TRUNCATE "* ]] && [[ "$UPPER_CMD" != *"TRUNCATE TABLE"* ]]; then BLOCKED=true; REASON="TRUNCATE"; fi

# Shell destructive operations (case-sensitive, these are literal commands)
if [[ "$COMMAND" == *"rm -rf"* ]]; then BLOCKED=true; REASON="rm -rf"; fi
if [[ "$COMMAND" == *"rm -fr"* ]]; then BLOCKED=true; REASON="rm -fr"; fi

# Git destructive operations
if [[ "$COMMAND" == *"git push --force"* ]]; then BLOCKED=true; REASON="git push --force"; fi
if [[ "$COMMAND" == *"git push -f"* ]]; then BLOCKED=true; REASON="git push -f"; fi
if [[ "$COMMAND" == *"git reset --hard"* ]]; then BLOCKED=true; REASON="git reset --hard"; fi
if [[ "$COMMAND" == *"git clean -f"* ]]; then BLOCKED=true; REASON="git clean -f"; fi

if [[ "$BLOCKED" == "true" ]]; then
  echo "{\"message\":\"Operation blocked: destructive command detected (${REASON})\"}" >&2
  exit 2
fi

exit 0
