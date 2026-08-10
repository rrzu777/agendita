#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Usage: run-json-cron.sh <url>' >&2
  exit 64
fi

if [ -z "${CRON_SECRET:-}" ]; then
  printf '%s\n' 'CRON_SECRET is required' >&2
  exit 64
fi

umask 077
response_file="$(mktemp "${TMPDIR:-/tmp}/agendita-cron.XXXXXX")"
trap 'rm -f "$response_file"' EXIT

curl -fsS --max-time 60 \
  --request POST \
  --header "Authorization: Bearer ${CRON_SECRET}" \
  --output "$response_file" \
  --url "$1"

jq -e '(.errors | type) == "number" and .errors == 0' "$response_file" >/dev/null
