#!/usr/bin/env bash
set -euo pipefail
# Independent budget: never consume the transactional cron driver's shared timeout.
: "${OWNER_ANALYTICS_CRON_URL:?Missing analytics cron URL}"
: "${CRON_SECRET:?Missing cron secret}"
[[ "$OWNER_ANALYTICS_CRON_URL" == https://* && "$OWNER_ANALYTICS_CRON_URL" != *'?'* && "$OWNER_ANALYTICS_CRON_URL" != *'#'* ]] || exit 1
[[ "$CRON_SECRET" != *$'\n'* && "$CRON_SECRET" != *$'\r'* ]] || exit 1
analytics_max_requests="${OWNER_ANALYTICS_CRON_MAX_REQUESTS:-120}"
analytics_max_seconds="${OWNER_ANALYTICS_CRON_MAX_SECONDS:-480}"
[[ "$analytics_max_requests" =~ ^[1-9][0-9]*$ && "$analytics_max_seconds" =~ ^[1-9][0-9]*$ ]] || exit 1
(( analytics_max_requests <= 120 && analytics_max_seconds <= 600 )) || exit 1
analytics_started=$SECONDS
analytics_cursor=''
for ((analytics_request = 0; analytics_request < analytics_max_requests; analytics_request++)); do
  (( SECONDS - analytics_started < analytics_max_seconds )) || break
  analytics_url="$OWNER_ANALYTICS_CRON_URL"
  if [[ -n "$analytics_cursor" ]]; then analytics_url+="?cursor=$analytics_cursor"; fi
  analytics_body=$(curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 60 -X POST -H "Authorization: Bearer $CRON_SECRET" "$analytics_url") || { echo 'Analytics maintenance HTTP failure' >&2; exit 1; }
  analytics_cursor=$(printf '%s' "$analytics_body" | node -e '
    let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => {
      try { const r=JSON.parse(body); if(r.errors!==0 || typeof r.hasMore!=="boolean") throw Error();
        if(!r.hasMore) { if(r.backlog?.dangerous || r.backlog?.hasExpired) throw Error(); return; }
        if(typeof r.nextCursor!=="string" || !r.nextCursor || r.nextCursor.length>1024) throw Error();
        process.stdout.write(encodeURIComponent(r.nextCursor));
      } catch { process.stderr.write("Invalid or failed analytics maintenance result\n"); process.exitCode=1; }
    });') || exit 1
  if [[ -z "$analytics_cursor" ]]; then echo 'Analytics maintenance drained'; exit 0; fi
done
echo 'Analytics maintenance continuation budget exhausted; backlog remains' >&2
exit 1
