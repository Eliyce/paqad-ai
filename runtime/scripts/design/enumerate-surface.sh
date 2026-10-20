#!/usr/bin/env bash
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

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

find . -type d -name node_modules -prune -o -type d -name .next -prune \
  -o -type f \( -name 'page.tsx' -o -name 'page.ts' -o -name 'page.jsx' -o -name 'page.js' \) -print 2>/dev/null \
  | grep -E '/app/' >> "$tmp" || true

find . -type d -name node_modules -prune -o -type d -name .next -prune \
  -o -type d -name pages -print 2>/dev/null \
  | while read -r d; do
      find "$d" -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.jsx' -o -name '*.js' \) \
        ! -name '_*' \
        ! -path '*/api/*' 2>/dev/null >> "$tmp" || true
    done

find . -type d -name node_modules -prune -o -type d -name .next -prune \
  -o -path '*/app/routes/*' -type f \( -name '*.tsx' -o -name '*.ts' \) -print 2>/dev/null >> "$tmp" || true

sort -u "$tmp" -o "$tmp"

emit() {
  printf '{\n'
  printf '  "routes": [\n'
  first=1
  while IFS= read -r f; do
    [ -z "$f" ] && continue
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
