# RunBot

Minimal AWS serverless backend for a Strava + Discord bot.

## Stack

- Node.js + TypeScript
- AWS Lambda
- API Gateway HTTP API
- Amazon SQS for webhook retry processing and deferred slash commands
- Amazon DynamoDB for activity storage, rate limiting, and personal records tracking
- Gemini API (v1beta model) for run analysis and natural language coaching
- Terraform

## Environment

Use `.env.example` as the placeholder reference:

```text
AWS_ACCESS_KEY=YOUR_KEY
AWS_SECRET_KEY=YOUR_SECRET
AWS_REGION=ap-southeast-1
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
export TF_VAR_ai_coach_token=YOUR_RANDOM_INTERNAL_TOKEN
export TF_VAR_gemini_api_key=YOUR_GEMINI_API_KEY
```

## Deploy

```bash
terraform -chdir=infrastructure/bootstrap init
terraform -chdir=infrastructure/bootstrap apply
npm --prefix lambdas/health install
npm --prefix lambdas/health run build
npm --prefix lambdas/aiAnalysis install
npm --prefix lambdas/aiAnalysis run build
cd infrastructure
terraform init
terraform apply
```

The deployment has two Terraform layers:

- `infrastructure/bootstrap` creates the remote state bucket used by the main stack.
- `infrastructure` provisions the application resources and uses the S3 backend in `backend.tf`.

Terraform creates the HTTP Lambda, an SQS queue with a DLQ, and a second worker Lambda that processes queued Strava webhook jobs and deferred Discord slash commands. Terraform packages the Lambda bundles directly from `dist/` during `terraform apply`, so there is no manual zip step in the deploy flow.

If these AWS resources already exist from an earlier run, import them into Terraform state once before applying the root stack:

```bash
terraform -chdir=infrastructure import aws_iam_role.lambda_role health-lambda-role
terraform -chdir=infrastructure import aws_dynamodb_table.activitybot ActivityBot
```

## CI/CD

The GitHub Actions workflow in [.github/workflows/cicd.yml](/Users/Andrew/RunBot/.github/workflows/cicd.yml) runs on push to `main` and manual dispatch.

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
- `STRAVA_STATE_SECRET`
- `AI_COACH_TOKEN`
- `VERIFY_TOKEN`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `GEMINI_API_KEY`

## Test

After apply, use the `api_url` Terraform output:

```bash
curl API_URL/health
```

Expected response:

```json
{"status":"ok"}
```

## Discord Interactions

Set the Discord Developer Portal Interactions Endpoint URL to:

```text
API_URL/discord-interactions
```

The Lambda verifies `X-Signature-Ed25519` and `X-Signature-Timestamp` using
the Discord application public key before responding to Discord's PING request.

The slash-command flow supports:
- `/analyse run`: Queues an AI run analysis job. The worker gathers the user's latest run, 5 recent runs, 10 historical runs, and weekly statistics, fetches the coaching report from `/ai-coach` (which queries Gemini), and posts a structured report (Summary, Trend, Risks, Next Steps) back to Discord.
- `/ai <prompt>`: Allows freeform natural-language chat with the AI coach. It uses a tool-calling loop where the Gemini agent can dynamically request Strava data (latest run, recent runs, weekly stats, or run comparisons) to construct its answer.

The AI endpoint is also exposed at:

```text
API_URL/ai-coach
```

## Personal Records Tracking

The bot automatically tracks and stores running personal records (PRs) for users in DynamoDB (`SK = PERSONAL_RECORDS`). 
- **Records tracked**: Longest Run, Biggest Climb (using activity `total_elevation_gain`), and best paces for 5k, 10k, and Half Marathon.
- **Incremental updates**: Evaluated in the worker Lambda upon receiving a new activity webhook.
- **Backfill processing**: Accessible via SQS (`strava-backfill` job) to calculate and populate historical PRs from a user's activity history.

## Global Rate Limiting

To prevent command abuse and API key exhaustion, intensive slash commands (`/stats`, `/club-activities`, `/analyse run`, `/ai`) are rate-limited via a DynamoDB token-bucket rate limiter.
- **Max capacity**: 5 tokens per user.
- **Refill rate**: 1 token refilled every 30 seconds.
- User requests exceeding the rate limit receive an ephemeral Discord warning indicating the remaining cooldown duration.

## Strava Webhooks

The `/strava/webhook` endpoint validates the webhook signature/challenge and enqueues a job in SQS. A worker Lambda consumes that job, fetches the Strava activity, stores it in DynamoDB, updates personal records, and posts to Discord. The `/discord-interactions` endpoint defers heavy interactions (`/stats`, `/club-activities`, `/analyse run`, `/ai`) by enqueuing work in SQS, responding to Discord immediately, and utilizing follow-up webhooks. Failed jobs are retried automatically and moved to the DLQ after repeated failures.

## Local Development & Testing

You can run a local mock Lambda environment to test API routes and webhook callbacks without deploying to AWS:

```bash
# Start local mock API Gateway server (runs on http://localhost:3000)
node scripts/serve-local.js
```

You can also run the interactive CLI script to test Strava API token exchanges and activity lookups:

```bash
# Run interactive Strava API client test script
node scripts/test-strava.js
```
