#!/usr/bin/env bash
# Purpose: Extract explicit routing signals from raw request text via keyword
#          patterns. LLM still fills judgment dimensions (risk, scope) but the
#          deterministic ones (workflow, ui/api/db impact) come from grep.
# Usage:   bash scripts/extract-signals.sh <request-file>   (or pipe text)
# Output:  YAML key:value pairs (one per line) for matched signals.
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then text=$(cat)
elif [ -f "$1" ]; then text=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

lc=$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')

match() { printf '%s' "$lc" | grep -qE "$1"; }

# workflow inference
if   match '\bbug|broken|fix\b|regression|crash|error\b'; then printf 'workflow: bug-fix\n'
elif match '\brefactor|reorganiz|cleanup|tidy\b';        then printf 'workflow: refactor\n'
elif match '\bmigrat(e|ion)|backfill\b';                  then printf 'workflow: migration\n'
elif match '\binvestigat|why|how does|explain\b';        then printf 'workflow: investigation\n'
elif match '\b(what|where|who) (is|does|are)\b|\bdocument\b'; then printf 'workflow: project-question\n'
else                                                          printf 'workflow: feature-development\n'
fi

# UI impact
if match '\b(ui|ux|button|screen|view|page|component|css|render)\b'; then printf 'ui_impact: yes\n'
else printf 'ui_impact: no\n'
fi

# API impact
if match '\bapi|endpoint|route|controller|handler|webhook\b'; then printf 'api_impact: yes\n'
else printf 'api_impact: no\n'
fi

# DB impact
if match '\b(database|db|schema|migration|sql|table|column|index)\b'; then printf 'db_impact: yes\n'
else printf 'db_impact: no\n'
fi

# Scope
if match '\b(multi[-[:space:]]?module|cross[-[:space:]]?module|system[-[:space:]]?wide)\b'; then printf 'scope: multi-module\n'
elif match '\bplatform|infrastructure|all modules|system\b'; then printf 'scope: system-wide\n'
else printf 'scope: single-module\n'
fi

# Risk hints (LLM still confirms)
if match '\b(security|auth|payment|billing|gdpr|pii|secret|token)\b'; then printf 'risk_hint: high\n'
elif match '\b(payments?|invoices?|refund|charge)\b'; then printf 'risk_hint: medium\n'
else printf 'risk_hint: low\n'
fi
