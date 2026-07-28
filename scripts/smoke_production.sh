#!/usr/bin/env bash
set -euo pipefail

base="${1:-https://aegisops-ai-incident-doctor.pages.dev}"
base="${base%/}"
canonical_origin="${SMOKE_CANONICAL_ORIGIN:-$base}"
canonical_origin="${canonical_origin%/}"
attempts="${SMOKE_ATTEMPTS:-3}"
retry_delay="${SMOKE_RETRY_DELAY_SECONDS:-5}"
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

check_endpoint() {
  local endpoint="$1"
  local expected_type="$2"
  local expected_path="$3"
  shift 3
  local expected_url="${base}${expected_path}"
  local attempt
  local result
  local code
  local content_type
  local effective_url
  local marker
  local valid

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    result="$(
      curl --silent --show-error --location \
        --connect-timeout 8 \
        --max-time 25 \
        --output "$body_file" \
        --write-out $'%{http_code}\t%{content_type}\t%{url_effective}' \
        "${base}${endpoint}" || true
    )"
    IFS=$'\t' read -r code content_type effective_url <<<"$result"
    valid=1

    [[ "$code" =~ ^2[0-9]{2}$ ]] || valid=0
    [[ "$content_type" == "$expected_type"* ]] || valid=0
    [[ "$effective_url" == "$expected_url" ]] || valid=0
    for marker in "$@"; do
      grep --fixed-strings --quiet "$marker" "$body_file" || valid=0
    done

    printf '[%d/%d] %s -> status=%s type=%s url=%s\n' \
      "$attempt" "$attempts" "$endpoint" "${code:-000}" "${content_type:-missing}" "${effective_url:-missing}"
    if [[ "$valid" -eq 1 ]]; then
      return 0
    fi
    sleep "$((attempt * retry_delay))"
  done

  printf 'Production identity check failed for %s\n' "$endpoint" >&2
  return 1
}

check_endpoint "/" "text/html" "/" "<title>AegisOps | incident replay copilot evidence capture</title>"
check_endpoint "/about" "text/html" "/about" "<h1>About AegisOps</h1>"
check_endpoint "/privacy" "text/html" "/privacy" "<h1>Privacy Policy</h1>"
check_endpoint "/terms" "text/html" "/terms" "<h1>Terms of Service</h1>"
check_endpoint "/contact" "text/html" "/contact" "<h1>Contact</h1>"
check_endpoint "/compliance" "text/html" "/compliance" "<h1>Compliance & Quality</h1>"
check_endpoint \
  "/robots.txt" \
  "text/plain" \
  "/robots.txt" \
  "User-agent: *" \
  "Sitemap: ${canonical_origin}/sitemap.xml"
check_endpoint \
  "/sitemap.xml" \
  "application/xml" \
  "/sitemap.xml" \
  "<loc>${canonical_origin}/</loc>" \
  "<loc>${canonical_origin}/about</loc>" \
  "<loc>${canonical_origin}/privacy</loc>" \
  "<loc>${canonical_origin}/terms</loc>" \
  "<loc>${canonical_origin}/contact</loc>" \
  "<loc>${canonical_origin}/compliance</loc>" \
  "<loc>${canonical_origin}/guide</loc>" \
  "<loc>${canonical_origin}/architecture</loc>" \
  "<loc>${canonical_origin}/verification</loc>" \
  "<loc>${canonical_origin}/publisher</loc>"

echo "Production policy and search surface smoke passed."
