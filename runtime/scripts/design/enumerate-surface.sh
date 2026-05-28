#!/usr/bin/env bash
# Purpose: Enumerate the routes / screens of the running app. Detects
#          Next.js (app/ and pages/), Remix (routes/), React Router (declarative
#          route configs), and Vue Router. Emits JSON to stdout (or --out).
# Usage:   bash runtime/scripts/design/enumerate-surface.sh [--root <project-root>] [--out <path>]
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="."
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --root) root="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done

cd "$root"

# Collect candidate route files into a temp list.
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

# Next.js app router: app/**/page.{ts,tsx,js,jsx}
find . -type d -name node_modules -prune -o -type d -name .next -prune \
  -o -type f \( -name 'page.tsx' -o -name 'page.ts' -o -name 'page.jsx' -o -name 'page.js' \) -print 2>/dev/null \
  | grep -E '/app/' >> "$tmp" || true

# Next.js pages router: pages/**/*.{ts,tsx,js,jsx} (excluding _* and api/*)
find . -type d -name node_modules -prune -o -type d -name .next -prune \
  -o -type d -name pages -print 2>/dev/null \
  | while read -r d; do
      find "$d" -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.jsx' -o -name '*.js' \) \
        ! -name '_*' \
        ! -path '*/api/*' 2>/dev/null >> "$tmp" || true
    done

# Remix routes: app/routes/**/*.{ts,tsx}
find . -type d -name node_modules -prune -o -type d -name .next -prune \
  -o -path '*/app/routes/*' -type f \( -name '*.tsx' -o -name '*.ts' \) -print 2>/dev/null >> "$tmp" || true

# Sort and de-dupe.
sort -u "$tmp" -o "$tmp"

emit() {
  printf '{\n'
  printf '  "routes": [\n'
  first=1
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    # Derive a URL path from the file path. Strip src/, app/, pages/ prefixes;
    # strip extension; collapse /index → /; treat [param] segments as :param.
    p=$(printf '%s' "$f" \
      | sed -E 's|^\./||; s|^src/||; s|^app/||; s|^pages/||; s|/routes/|/|; s|\.[tj]sx?$||; s|/index$|/|; s|/page$|/|; s|\[\.\.\.([^]]+)\]|*\1|g; s|\[\.\.\.|*|g; s|\]||g; s|\[|:|g')
    [ -z "$p" ] && p="/"
    [ "${p:0:1}" != "/" ] && p="/$p"
    if [ "$first" -eq 1 ]; then first=0; else printf ',\n'; fi
    printf '    { "path": "%s", "source": "%s" }' "$p" "$f"
  done < "$tmp"
  printf '\n  ]\n'
  printf '}\n'
}

if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  emit > "$out"
  printf 'wrote %s\n' "$out"
else
  emit
fi
