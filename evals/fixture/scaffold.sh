#!/usr/bin/env bash
set -euo pipefail

suite="${1:-}"
case "$suite" in
  routing | firewall | receipt) ;;
  *)
    echo "scaffold.sh: unknown suite '$suite' (expected routing, firewall or receipt)" >&2
    exit 64
    ;;
esac

fixture_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="$(cd "$fixture_dir/../.." && pwd)"

cp -R "$fixture_dir/project/." .
printf '%s\n' "$plugin_root/runtime" > .paqad/framework-path.txt

if [ "$suite" != "firewall" ]; then
  policy=".paqad/configs/.config.policy"
  grep -v '^stages_mode=off$' "$policy" > "$policy.tmp" || true
  mv "$policy.tmp" "$policy"
fi

git init -q
git config user.name "paqad eval"
git config user.email "eval@paqad.invalid"
git add -A
git commit -qm "eval fixture"
