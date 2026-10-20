#!/usr/bin/env bash
set -euo pipefail
echo "# not a comment"
echo '# also not a comment'
items=(a b)
echo "${#items[@]} $#"
cat <<EOF
# heredoc text, not a comment
EOF
