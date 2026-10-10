# FRH / TopAhead Postiz: ops notes (kvm4, /opt/postiz-app)

Updated: 2026-10-06 by Mike's infra agent. Read this before touching Postiz.

## Where it runs
- Host: kvm4 (2.25.108.123), Docker Compose project `postiz-app`, file `/opt/postiz-app/docker-compose.yaml` + `.env` (mode 600).
- `/docker/postiz` is an OLD, unused copy (compose project `postiz` in state "created", no containers). Don't edit it.
- Public URL: https://postiz.topahead.com (Cloudflare to host port 4007). Scheduler: Temporal (`temporal` container); each scheduled post has a workflow `post_<postId>`.

## RULE: never write posts straight into the database
- Do NOT `INSERT` into `"Post"` (psql, `docker exec postiz-postgres`, scripts). A row created that way gets no Temporal `post_<id>` workflow, so it stays QUEUE forever.
  Incident: on 2026-09-30 19:59 UTC an SSH agent session (key comment `generated-by-oz`) cloned 43 FRH Facebook rows into Instagram rows (`cmuig…`). 19 Instagram posts never published.
- A guard trigger `frh_block_direct_post_insert` on `"Post"` now rejects INSERTs from psql/unix-socket sessions. The app (Prisma over TCP) is unaffected.
  The override and the removal SQL are in the function comment (`\sf frh_block_direct_post_insert`).
- Create, schedule and fix posts ONLY through:
  - the Public API: `POST https://postiz.topahead.com/api/public/v1/posts` (header `Authorization: <org API key>`), `POST /upload` or `/upload-from-url` for media
  - the Postiz MCP: `integrationSchedulePostTool`, `uploadFromUrlTool`, `postsListTool`
- Don't delete a post through the API/UI when it shares a `group` with another channel's post. Postiz deletes the whole group. That's how the published Sep 30 FRH Facebook posts were soft-deleted.
  To retire one row only: `UPDATE "Post" SET "deletedAt"=now() WHERE id='<id>'`. That's a soft delete; don't hard-delete.

## Monitoring
- `/etc/cron.d/frh-postiz-stuck-alert` runs `/opt/frh-postiz-alert/stuck_alert.py` every 5 min. Any post still QUEUE 15+ min after its publishDate is alerted once.
  Output goes to `/var/log/frh-postiz/stuck-alerts.{jsonl,log}`, plus Slack if `SLACK_SOCIAL_ALERT_WEBHOOK_URL` is set in `/opt/frh-postiz-alert/alert.env` (empty today).

## Analytics (read-only)
- `GET /api/public/v1/analytics/post/<postId>?date=<days>` and `GET /api/public/v1/analytics/<integrationId>?date=<days>`, same API key header.

## Restart
- `cd /opt/postiz-app && docker compose up -d postiz` (recreates the container with the new env; startup = `python3 /patch-facebook-scopes.py && nginx && pnpm run pm2`).
  Then check `curl -s -o /dev/null -w '%{http_code}' https://postiz.topahead.com/` returns 200, not 502.
- Note: in the compose file, `OPENAI_API_KEY: ''` is hard-coded and overrides `.env`. To enable ask_postiz, change it to `${OPENAI_API_KEY:-}` and set the key in `.env`.
