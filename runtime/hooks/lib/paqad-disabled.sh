#!/usr/bin/env bash

__paqad_read_key() {
  local file="$1" key="$2"
  [ -f "${file}" ] || return 0
  grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "${file}" 2>/dev/null \
    | tail -n1 \
    | sed -E 's/^[^=]*=//; s/[[:space:]]#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' \
    | tr '[:upper:]' '[:lower:]'
}

__paqad_resolve_enable() {
  local root="$1" value="" v dir f
  dir="${root}/.paqad/configs"
  if [ -d "${dir}" ]; then
    while IFS= read -r f; do
      [ -e "${f}" ] || continue
      v=$(__paqad_read_key "${f}" 'paqad_enable')
      [ -n "${v}" ] && value="${v}"
    done < <(LC_ALL=C find "${dir}" -maxdepth 1 -name '.config.*' ! -name '.config.example' -type f 2>/dev/null | LC_ALL=C sort)
  fi
  v=$(__paqad_read_key "${root}/.paqad/.config" 'paqad_enable')
  [ -n "${v}" ] && value="${v}"
  v=$(printf '%s' "${PAQAD_ENABLE:-}" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//')
  [ -n "${v}" ] && value="${v}"
  printf '%s' "${value}"
}

__paqad_resolve_project_root() {
  local cwd="${1:-}" dir parent
  if [ -n "${cwd}" ]; then
    dir="${cwd}"
    while :; do
      if [ -d "${dir}/.paqad" ]; then
        printf '%s' "${dir}"
        return 0
      fi
      parent="$(dirname "${dir}")"
      [ "${parent}" = "${dir}" ] && break
      dir="${parent}"
    done
  fi
  printf '%s' "${CLAUDE_PROJECT_DIR:-${PAQAD_PROJECT_ROOT:-$(pwd)}}"
}

paqad_is_disabled() {
  case "$(printf '%s' "${PAQAD_DISABLED:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on)
      return 0
      ;;
  esac

  local root resolved
  root="$(__paqad_resolve_project_root "${1:-}")"
  resolved=$(__paqad_resolve_enable "${root}")
  case "${resolved}" in
    false | 0 | no | off)
      return 0
      ;;
  esac

  return 1
}
