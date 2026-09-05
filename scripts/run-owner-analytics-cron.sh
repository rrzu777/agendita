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
analytics_run_id=''
analytics_lease_token=''
analytics_batch_sequence=''
for ((analytics_request = 0; analytics_request < analytics_max_requests; analytics_request++)); do
  (( SECONDS - analytics_started < analytics_max_seconds )) || break
  analytics_url="$OWNER_ANALYTICS_CRON_URL"
  if [[ -n "$analytics_cursor" ]]; then analytics_url+="?cursor=$analytics_cursor"; fi
  analytics_headers=(-H "Authorization: Bearer $CRON_SECRET")
  if [[ -n "$analytics_run_id" ]]; then
    analytics_headers+=(-H "X-Analytics-Run-Id: $analytics_run_id" -H "X-Analytics-Lease-Token: $analytics_lease_token" -H "X-Analytics-Batch-Sequence: $analytics_batch_sequence")
  fi
  analytics_body=$(curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 60 -X POST "${analytics_headers[@]}" "$analytics_url") || { echo 'Analytics maintenance HTTP failure' >&2; exit 1; }
  analytics_metadata=$(printf '%s' "$analytics_body" | node -e '
    let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => {
      try {
        const r=JSON.parse(body);
        const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if(r.errors!==0 || typeof r.hasMore!=="boolean" || !uuid.test(r.runId) || !uuid.test(r.leaseToken) || !Number.isInteger(r.nextBatchSequence) || r.nextBatchSequence<1) throw Error();
        if(r.hasMore && (typeof r.nextCursor!=="string" || !r.nextCursor || r.nextCursor.length>1024)) throw Error();
        if(!r.hasMore && r.backlog?.dangerous) throw Error();
        process.stdout.write([r.runId,r.leaseToken,String(r.nextBatchSequence),r.hasMore ? encodeURIComponent(r.nextCursor) : ""].join("\t"));
      } catch { process.stderr.write("Invalid or failed analytics maintenance result\n"); process.exitCode=1; }
    });') || exit 1
  IFS=$'\t' read -r analytics_run_id analytics_lease_token analytics_batch_sequence analytics_cursor <<< "$analytics_metadata"
  if [[ -z "$analytics_cursor" ]]; then echo 'Analytics maintenance drained'; exit 0; fi
done
echo 'Analytics maintenance continuation budget exhausted; backlog remains' >&2
exit 1
