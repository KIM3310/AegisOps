#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="$ROOT/tools/cloudflare_pages.env"
STRICT_EXTERNAL_SCRIPT_VALUES="${STRICT_EXTERNAL_SCRIPT_VALUES:-0}"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

BUILD_COMMAND="${BUILD_COMMAND:-}"
OUTPUT_DIR="${OUTPUT_DIR:-}"
ROOT_DIR="${ROOT_DIR:-.}"
NOTES="${NOTES:-}"

IGNORE_GLOBS=(
  --glob '!.git'
  --glob '!node_modules'
  --glob '!dist'
  --glob '!.next'
  --glob '!build'
  --glob '!coverage'
  --glob '!*.png'
  --glob '!*.jpg'
  --glob '!*.jpeg'
  --glob '!*.gif'
  --glob '!*.pdf'
)

log() { printf '%s\n' "$*"; }
err() { printf 'ERROR: %s\n' "$*" >&2; }

usage() {
  cat <<USAGE
Usage:
  tools/release_ops.sh cloudflare
  tools/release_ops.sh apply-external-script <external-account-id> <slot-id>
  tools/release_ops.sh check
  tools/release_ops.sh report <external-account-id> <slot-id>

Environment:
  STRICT_EXTERNAL_SCRIPT_VALUES=1  # make placeholder external script values fail the check gate
USAGE
}

detect_web_root() {
  local candidates=(
    "site"
    "docs"
    "app/frontend/public"
    "frontend/public"
    "public"
    "."
  )

  local c
  for c in "${candidates[@]}"; do
    if [[ -f "$ROOT/$c/robots.txt" ]]; then
      printf '%s\n' "$c"
      return 0
    fi
  done

  printf '%s\n' "."
}

show_cloudflare() {
  log "[Cloudflare Pages Mapping]"
  log "repo: $(basename "$ROOT")"
  log "root_directory: ${ROOT_DIR}"
  log "build_command: ${BUILD_COMMAND:-<none>}"
  log "output_directory: ${OUTPUT_DIR:-<none>}"
  if [[ -n "$NOTES" ]]; then
    log "notes: $NOTES"
  fi
}

apply_external_script() {
  local client="${1:-}"
  local slot="${2:-}"

  if [[ -z "$client" || -z "$slot" ]]; then
    err "apply-external-script requires <client> <slot>."
    usage
    exit 1
  fi
  local normalized_slot="external-slot-${slot}"
  mapfile -t files < <(
    rg -l "external-account-id|external-slot-id|EXTERNAL_SCRIPT_PLACEHOLDER" \
      "$ROOT" "${IGNORE_GLOBS[@]}" \
      --glob '!*.md' \
      --glob '!README*'
  )

  if [[ ${#files[@]} -eq 0 ]]; then
    log "No placeholder targets found."
    return 0
  fi

  local f
  for f in "${files[@]}"; do
    perl -i -pe "s/external-account-id/${client}/g; s/external-slot-id/${normalized_slot}/g; s/EXTERNAL_SCRIPT_PLACEHOLDER/configured-external-script/g" "$f"
  done

  log "Updated ${#files[@]} files with external script values."
  git -C "$ROOT" diff --name-only
}

check_one_file() {
  local path="$1"
  local label="$2"
  if [[ -f "$path" ]]; then
    log "OK   $label"
  else
    log "FAIL $label"
    return 1
  fi
}

check_policy() {
  local name="$1"
  local root_path="$2"

  if [[ -f "$ROOT/$root_path/${name}.html" || -f "$ROOT/${name}.html" || -f "$ROOT/src/app/${name}/page.tsx" ]]; then
    log "OK   policy:${name}"
    return 0
  fi

  log "FAIL policy:${name}"
  return 1
}

contains_any() {
  local target="$1"
  shift
  local pattern
  for pattern in "$@"; do
    if rg -n -i "$pattern" "$target" >/dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

check_robots_quality() {
  local path="$1"
  local fail=0

  if ! rg -n "^User-agent:" "$path" >/dev/null; then
    log "FAIL robots: missing User-agent"
    fail=1
  fi
  if ! rg -n "^Allow:" "$path" >/dev/null; then
    log "FAIL robots: missing Allow"
    fail=1
  fi
  if ! rg -n "^Sitemap:" "$path" >/dev/null; then
    log "FAIL robots: missing Sitemap"
    fail=1
  fi

  if [[ $fail -eq 0 ]]; then
    log "OK   robots quality"
    return 0
  fi

  return 1
}

check_index_discoverability() {
  local fail=0
  local scan_targets=()

  if [[ -d "$ROOT/$1" ]]; then
    scan_targets+=("$ROOT/$1")
  fi
  if [[ -d "$ROOT/src/app" ]]; then
    scan_targets+=("$ROOT/src/app")
  fi
  if [[ -d "$ROOT/src/components" ]]; then
    scan_targets+=("$ROOT/src/components")
  fi
  if [[ -d "$ROOT/components" ]]; then
    scan_targets+=("$ROOT/components")
  fi
  if [[ -d "$ROOT/app/frontend/src" ]]; then
    scan_targets+=("$ROOT/app/frontend/src")
  fi
  if [[ -d "$ROOT/frontend/src" ]]; then
    scan_targets+=("$ROOT/frontend/src")
  fi

  if [[ ${#scan_targets[@]} -eq 0 ]]; then
    log "WARN discoverability: no scan targets"
    return 0
  fi

  if rg -n -i "privacy" "${scan_targets[@]}" --glob '*.{html,js,jsx,ts,tsx}' >/dev/null; then
    log "OK   homepage links privacy"
  else
    log "FAIL homepage links privacy"
    fail=1
  fi
  if rg -n -i "terms" "${scan_targets[@]}" --glob '*.{html,js,jsx,ts,tsx}' >/dev/null; then
    log "OK   homepage links terms"
  else
    log "FAIL homepage links terms"
    fail=1
  fi
  if rg -n -i "contact" "${scan_targets[@]}" --glob '*.{html,js,jsx,ts,tsx}' >/dev/null; then
    log "OK   homepage links contact"
  else
    log "FAIL homepage links contact"
    fail=1
  fi
  if rg -n -i "compliance" "${scan_targets[@]}" --glob '*.{html,js,jsx,ts,tsx}' >/dev/null; then
    log "OK   homepage links compliance"
  else
    log "FAIL homepage links compliance"
    fail=1
  fi
  if rg -n -i "about" "${scan_targets[@]}" --glob '*.{html,js,jsx,ts,tsx}' >/dev/null; then
    log "OK   homepage links about"
  else
    log "WARN homepage links about (recommended)"
  fi

  return $fail
}

check_contact_quality() {
  local fail=0
  local scan_targets=()

  if [[ -d "$ROOT/$1" ]]; then
    scan_targets+=("$ROOT/$1")
  fi
  if [[ -d "$ROOT/src/app" ]]; then
    scan_targets+=("$ROOT/src/app")
  fi
  if [[ -d "$ROOT/components" ]]; then
    scan_targets+=("$ROOT/components")
  fi
  if [[ -d "$ROOT/app/frontend/src" ]]; then
    scan_targets+=("$ROOT/app/frontend/src")
  fi
  if [[ -d "$ROOT/frontend/src" ]]; then
    scan_targets+=("$ROOT/frontend/src")
  fi

  if [[ ${#scan_targets[@]} -eq 0 ]]; then
    log "WARN contact quality: no scan targets"
    return 0
  fi

  if rg -n -i "@[^[:space:]]+\\.(local|test)\\b|ops\\.local|team\\.local" "${scan_targets[@]}" \
    --glob '*.{html,js,jsx,ts,tsx}' >/dev/null; then
    log "FAIL contact quality: local/test address found"
    fail=1
  else
    log "OK   contact quality: no local/test address"
  fi

  return $fail
}

check_optional_embed_signal() {
  local fail=0
  local scan_targets=()

  if [[ -d "$ROOT/$1" ]]; then
    scan_targets+=("$ROOT/$1")
  fi
  if [[ -d "$ROOT/src" ]]; then
    scan_targets+=("$ROOT/src")
  fi
  if [[ -d "$ROOT/components" ]]; then
    scan_targets+=("$ROOT/components")
  fi
  if [[ -d "$ROOT/app/frontend/src" ]]; then
    scan_targets+=("$ROOT/app/frontend/src")
  fi
  if [[ -d "$ROOT/frontend/src" ]]; then
    scan_targets+=("$ROOT/frontend/src")
  fi

  if [[ ${#scan_targets[@]} -eq 0 ]]; then
    log "WARN optional embed separation: no scan targets"
    return 0
  fi

  if rg -n -i "optional embed" "${scan_targets[@]}" --glob '*.{html,js,jsx,ts,tsx}' >/dev/null; then
    log "OK   optional embed separation label signal"
  else
    log "FAIL optional embed separation label signal"
    fail=1
  fi

  return $fail
}

check_review() {
  local fail=0
  local web_root
  web_root="$(detect_web_root)"

  log "[External Script/Cloudflare Architecture Check]"
  log "repo: $(basename "$ROOT")"
  log "web_root: $web_root"
  check_one_file "$ROOT/$web_root/robots.txt" "robots.txt" || fail=1
  check_one_file "$ROOT/$web_root/sitemap.xml" "sitemap.xml" || fail=1
  check_robots_quality "$ROOT/$web_root/robots.txt" || fail=1

  if [[ -f "$ROOT/$web_root/_headers" || -f "$ROOT/_headers" ]]; then
    log "OK   _headers"
  else
    log "WARN _headers (recommended)"
  fi

  check_policy "privacy" "$web_root" || fail=1
  check_policy "terms" "$web_root" || fail=1
  check_policy "contact" "$web_root" || fail=1
  check_policy "compliance" "$web_root" || fail=1
  check_policy "about" "$web_root" || fail=1
  check_index_discoverability "$web_root" || fail=1
  check_contact_quality "$web_root" || fail=1
  check_optional_embed_signal "$web_root" || fail=1

  if rg -n "external-script-account" "$ROOT" "${IGNORE_GLOBS[@]}" --glob '!*.md' >/dev/null; then
    log "OK   external script account meta"
  else
    log "FAIL external script account meta"
    fail=1
  fi

  if rg -n "external-account-id|external-slot-id|EXTERNAL_SCRIPT_PLACEHOLDER" \
    "$ROOT" "${IGNORE_GLOBS[@]}" --glob '!*.md' --glob '!README*' >/dev/null; then
    if [[ "$STRICT_EXTERNAL_SCRIPT_VALUES" == "1" ]]; then
      log "FAIL placeholder external script values remain (STRICT_EXTERNAL_SCRIPT_VALUES=1)"
      fail=1
    else
      log "WARN placeholder external script values remain (expected before production external script onboarding)"
    fi
  else
    log "OK   no placeholder external script values"
  fi

  show_cloudflare

  if [[ $fail -eq 0 ]]; then
    log "PASS quality gate"
    return 0
  fi

  log "FAIL quality gate"
  return 1
}

cmd="${1:-help}"
case "$cmd" in
  cloudflare)
    show_cloudflare
    ;;
  apply-external-script)
    apply_external_script "${2:-}" "${3:-}"
    ;;
  check)
    check_review
    ;;
  report)
    apply_external_script "${2:-}" "${3:-}"
    check_review
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    err "Unknown command: $cmd"
    usage
    exit 1
    ;;
esac
