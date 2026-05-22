#!/usr/bin/env bash
# Purpose: Compute the deterministic SEO metrics for a draft.
# Usage:   bash scripts/audit-seo.sh <draft> [primary-keyword]
# Output:  key: value lines (h1_count, h2_count, ..., title_len, meta_len,
#          primary_kw_count, images, images_with_alt, internal_links)
# Exits:   0 ok | 1 missing | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] || { printf 'usage: %s <draft> [kw]\n' "$0" >&2; exit 2; }
draft="$1"; kw="${2:-}"

count() { grep -cE "$1" "$draft" 2>/dev/null || true; }

h1=$(count '^# [^#]')
h2=$(count '^## [^#]')
h3=$(count '^### [^#]')

# Title tag: first H1 line.
title=$(grep -m1 -E '^# [^#]' "$draft" 2>/dev/null | sed -E 's/^# //' || true)
title_len=${#title}

# Meta-description: first paragraph after first H1, up to first blank line.
meta=$(awk '/^# [^#]/{f=1;next} f && /^$/{exit} f' "$draft" 2>/dev/null | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')
meta_len=${#meta}

# Primary keyword count (case-insensitive).
kw_count=0
if [ -n "$kw" ]; then
  kw_count=$(grep -ciE "$(printf '%s' "$kw" | sed -E 's/[][()|?+*^$.\\]/\\&/g')" "$draft" 2>/dev/null || true)
fi

images=$(count '!\[')
images_alt=$(grep -cE '!\[[^]]+\]' "$draft" 2>/dev/null || true)
internal_links=$(grep -cE '\]\((/|#|\.\./)' "$draft" 2>/dev/null || true)

printf 'h1_count: %s\nh2_count: %s\nh3_count: %s\n' "$h1" "$h2" "$h3"
printf 'title: %s\ntitle_len: %s\n' "$title" "$title_len"
printf 'meta: %s\nmeta_len: %s\n' "$meta" "$meta_len"
printf 'primary_kw: %s\nprimary_kw_count: %s\n' "$kw" "$kw_count"
printf 'images: %s\nimages_with_alt: %s\n' "$images" "$images_alt"
printf 'internal_links: %s\n' "$internal_links"
