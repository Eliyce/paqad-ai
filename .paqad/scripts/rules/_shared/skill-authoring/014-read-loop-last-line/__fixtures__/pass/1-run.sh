while IFS= read -r x || [ -n "${x:-}" ]; do echo "$x"; done < f
