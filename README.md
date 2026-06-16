# RunBot

A serverless AWS backend for a Strava + Discord bot. RunBot connects users' Strava accounts to Discord, automatically posts activity notifications, tracks personal records, and provides an integrated DeepSeek-powered AI running coach.

## Features

### Discord Slash Commands

| Command | Description | Response |
| :--- | :--- | :--- |
| `/strava` | Generate a Strava OAuth link to connect your account | Instant |
| `/stats` | Post your weekly running stats — distance, runs, pace, longest run, total time | Deferred |
| `/club-activities` | Post the latest 30 activities from the configured Strava Club | Deferred |
| `/analyse run` | Generate an AI coaching report on your latest run (Summary, Trend, Risks, Next Steps) | Deferred |
| `/ai <prompt>` | Chat with the DeepSeek AI running coach in natural language | Deferred |
| `/help` | List all available commands | Instant |

### Automated Weekly Recap

Every **Monday at 12:00 AM Philippine Time** (16:00 UTC), EventBridge Scheduler invokes `weekly-recap` Lambda. The function scans all linked athletes, compiles each athlete's weekly running stats, generates a DeepSeek AI coaching insight, and posts a full recap to the configured Discord channel. No manual command needed.

Deferred commands return an immediate Type 5 acknowledgement to Discord (within Discord's 3-second limit) and post results asynchronously via a follow-up webhook once the background SQS Worker has finished.

### Strava Integration

- **OAuth Connect Flow** — Full authorization code exchange at `GET /strava/callback`. Tokens are persisted in DynamoDB and a branded HTML confirmation page is returned.
- **Webhook Ingestion** — Validates Strava webhook challenges (`GET /strava/webhook`) and ingests new activity events (`POST /strava/webhook`) via SQS.
- **Real-time Activity Notifications** — On every new or updated Strava activity, fetches full details, stores them in DynamoDB, and posts a Discord channel message with distance, pace, elapsed time, and PR count.
- **Historical Backfill** — On account link, automatically queues a **730-day backfill** of historical Strava activities into DynamoDB.
- **Automatic Token Refresh** — Checks token expiry before every Strava API call and refreshes if expiring within 1 hour.
- **Discord DM on Link** — Sends the user a welcome DM listing available commands after successfully linking Strava.
- **Channel Notification on Link** — Posts a public `@mention` in the configured channel announcing a new account connection.

### Personal Records (PRs)

- **Automatic Tracking** — Every incoming webhook activity is compared against stored PRs. Records are updated immediately if it is a new best.
- **Categories** — Longest Run, Biggest Climb, Best 5K pace, Best 10K pace, Best Half Marathon pace.
- **Bulk Recalculation** — After a full backfill, recalculates all PRs from scratch across the entire activity history.
- **Incremental Updates** — Each new activity triggers a targeted read → compare → write update without reprocessing all history.
- **Self-healing Fallback** — If the pre-computed PR record is missing, the AI agent falls back to on-the-fly PR calculations from all stored activities.

### Weekly Recap (DeepSeek)

- **Automated Weekly Post** — Every Monday at 12:00 am PH time, EventBridge triggers a Lambda that scans all linked athletes and posts a weekly recap to Discord.
- **Per-Athlete Stats** — Each athlete gets distance, run count, average pace, longest run, and total elapsed time.
- **AI Coaching Insight** — DeepSeek generates a 1-2 sentence personalized coaching note for each athlete who ran that week.
- **Multi-Message Splitting** — Recap entries are packed into Discord messages up to 1900 characters each to avoid hitting the 2000-char limit.

### AI Running Coach (DeepSeek)

- **Natural Language Chat** (`/ai`) — Conversational DeepSeek agent with tool-calling. Dynamically fetches run data to answer questions about training, pace, comparisons, and PRs.
- **Structured Run Analysis** (`/analyse run`) — Generates a markdown coaching report using the latest run, 5 recent runs, 10 historical runs, and weekly stats summary.
- **DeepSeek Tools** — The agent can call 5 tools: `get_latest_run`, `get_recent_runs`, `get_weekly_stats`, `compare_to_past_runs`, `get_personal_records`.
- **Strava-aware Context** — Detects if a Strava account is linked and adjusts the system prompt accordingly.
- **Tool Call Depth Limit** — Capped at 4 tool-call iterations to prevent runaway loops.

### Platform & Infrastructure

- **Global Rate Limiting** — Token-bucket limiter stored in DynamoDB, applied to all intensive commands. Max 5 tokens per user, 1 token refilled every 30 seconds. Rate-limited users receive an ephemeral Discord warning.
- **Discord Signature Verification** — All incoming Discord webhook requests are verified with Ed25519 cryptographic signature validation using `tweetnacl`.
- **SQS Retry with DLQ** — All background jobs are retried up to 5 times automatically before landing in a Dead Letter Queue.
- **EventBridge Scheduler** — Automated weekly recap fires every Sunday via AWS EventBridge Scheduler with a flexible 5-minute window.
- **`GET /health` Endpoint** — Returns `{"status":"ok"}` for uptime monitoring and post-deploy health checks.

---

## Stack

- Node.js 22 + TypeScript
- AWS Lambda (3 functions: `api` gateway, `strava-worker`, `weekly-recap`)
- API Gateway HTTP API
- Amazon SQS (webhook retry + deferred slash commands)
- Amazon DynamoDB (activities, personal records, rate limiting)
- AWS EventBridge Scheduler (weekly recap trigger)
- DeepSeek API (`deepseek-chat`) for run analysis and AI coaching
- Terraform

---

```text
AWS_ACCESS_KEY_ID=YOUR_KEY
AWS_SECRET_ACCESS_KEY=YOUR_SECRET
AWS_REGION=YOUR_REGION
TF_VAR_discord_public_key=YOUR_DISCORD_APP_PUBLIC_KEY
TF_VAR_discord_application_id=YOUR_DISCORD_APP_ID
TF_VAR_ai_coach_token=YOUR_RANDOM_INTERNAL_TOKEN
TF_VAR_gemini_api_key=YOUR_GEMINI_API_KEY
```

Terraform uses the standard AWS provider credential chain. Export credentials before applying:

```bash
export AWS_ACCESS_KEY_ID=YOUR_KEY
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET
export AWS_REGION=ap-southeast-1
export TF_VAR_discord_public_key=YOUR_DISCORD_APP_PUBLIC_KEY
export TF_VAR_discord_application_id=YOUR_DISCORD_APP_ID
export TF_VAR_deepseek_api_key=YOUR_DEEPSEEK_API_KEY
```

---

## Deploy

```bash
terraform -chdir=infrastructure/bootstrap init
terraform -chdir=infrastructure/bootstrap apply
npm --prefix lambdas/api install
npm --prefix lambdas/api run build
cd infrastructure
terraform init
terraform apply
```

The deployment has two Terraform layers:

- `infrastructure/bootstrap` creates the remote state bucket used by the main stack.
- `infrastructure` provisions the application resources and uses the S3 backend in `backend.tf`.

Terraform packages the Lambda bundles directly from `dist/` during `terraform apply`, so there is no manual zip step in the deploy flow.

If these AWS resources already exist from an earlier run, import them into Terraform state once before applying the root stack:

```bash
terraform -chdir=infrastructure import aws_iam_role.lambda_role api-lambda-role
terraform -chdir=infrastructure import aws_dynamodb_table.activitybot ActivityBot
```

---

## CI/CD

The GitHub Actions workflow in `.github/workflows/cicd.yml` runs on push to `main` and manual dispatch.

It does four things:

1. Installs Lambda dependencies.
2. Runs `npx tsc` and builds the Lambda bundle.
3. Registers Discord slash commands with `scripts/registerCommand.js`.
4. Runs `terraform init` and `terraform apply` against the remote S3 backend.

Required GitHub Secrets:

- `DISCORD_PUBLIC_KEY`
- `DISCORD_APPLICATION_ID`
- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNEL_ID`
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `VERIFY_TOKEN`
- `DEEPSEEK_API_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

---

## Discord Setup

Set the Discord Developer Portal **Interactions Endpoint URL** to:

```
API_URL/discord-interactions
```

The Lambda verifies `X-Signature-Ed25519` and `X-Signature-Timestamp` headers using the Discord application public key before responding to Discord's PING challenge.

---

## Test

After apply, verify the deployment using the `api_url` Terraform output:

```bash
curl API_URL/health
```

Expected response:

```json
{"status":"ok"}
```

---

## Local Development

Run a local mock API Gateway to test HTTP routes without deploying to AWS:

```bash
npm run build
node scripts/serve-local.js
# Server runs at http://localhost:3000
```

Test Strava API token exchange and activity lookups interactively:

```bash
node scripts/test-strava.js
```
