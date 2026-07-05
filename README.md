# RunBot

> **Status (July 2026): On standby.** Strava moved their API to [subscriber-only access](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428). The API application has been deactivated, so all Strava-dependent features (webhooks, stats, club feed, AI coaching, PRs) are non-functional until a Strava subscription is active. The `/prs` command may still work if it doesn't depend on fresh Strava data. Architecture, code, and infra remain intact.

Serverless AWS backend for a Strava + Discord bot. Connects Strava accounts to Discord, posts activity notifications, tracks personal records, and provides a DeepSeek-powered AI running coach.

## Features

| Command | Description | Response |
| :--- | :--- | :--- |
| `/strava` | Generate a Strava OAuth link to connect your account | Instant |
| `/stats` | Post your weekly running stats | Deferred |
| `/club-activities` | Post the latest 30 activities from the configured Strava Club | Deferred |
| `/analyse run` | AI coaching report on your latest run | Deferred |
| `/ai <prompt>` | Chat with the AI coach in natural language | Deferred |
| `/prs` | Show personal records (5K, 10K, HM, longest run, biggest climb) | Deferred |
| `/help` | List all available commands | Instant |

**Automated Weekly Recap** — Every Monday 12:00 AM PHT, EventBridge triggers a Lambda that compiles weekly stats for all linked athletes, generates a DeepSeek AI insight for each, and posts the recap to Discord.

**Personal Records** — Automatically tracked and updated on every activity. Categories: longest run, biggest climb, best 5K/10K/half marathon pace.

**AI Coach** (`/ai`, `/analyse run`) — DeepSeek agent with 5 tools (latest run, recent runs, weekly stats, past comparisons, PRs). Conversational or structured markdown report. 4-iteration tool call cap.

**Rate Limiting** — Token-bucket (5 tokens, 1 refill per 30s) on intensive commands, stored in DynamoDB.

## Stack

- Node.js 22 + TypeScript
- AWS Lambda (3 functions), API Gateway HTTP API, SQS + DLQ, DynamoDB, EventBridge Scheduler
- DeepSeek API (`deepseek-chat`)
- Terraform

## Environment Variables

```text
TF_VAR_discord_public_key=YOUR_DISCORD_APP_PUBLIC_KEY
TF_VAR_strava_client_id=YOUR_STRAVA_CLIENT_ID
TF_VAR_strava_client_secret=YOUR_STRAVA_CLIENT_SECRET
TF_VAR_verify_token=YOUR_VERIFY_TOKEN
TF_VAR_discord_bot_token=YOUR_DISCORD_BOT_TOKEN
TF_VAR_discord_application_id=YOUR_DISCORD_APP_ID
TF_VAR_discord_channel_id=YOUR_DISCORD_CHANNEL_ID
TF_VAR_deepseek_api_key=YOUR_DEEPSEEK_API_KEY
```

Export before applying:

```bash
export AWS_ACCESS_KEY_ID=YOUR_KEY
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET
export AWS_REGION=ap-southeast-1
export TF_VAR_discord_public_key=YOUR_DISCORD_APP_PUBLIC_KEY
export TF_VAR_strava_client_id=YOUR_STRAVA_CLIENT_ID
export TF_VAR_strava_client_secret=YOUR_STRAVA_CLIENT_SECRET
export TF_VAR_verify_token=YOUR_VERIFY_TOKEN
export TF_VAR_discord_bot_token=YOUR_DISCORD_BOT_TOKEN
export TF_VAR_discord_application_id=YOUR_DISCORD_APP_ID
export TF_VAR_discord_channel_id=YOUR_DISCORD_CHANNEL_ID
export TF_VAR_deepseek_api_key=YOUR_DEEPSEEK_API_KEY
```

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

Two Terraform layers: `infrastructure/bootstrap` creates the remote state bucket, `infrastructure` provisions the app resources.

## CI/CD

GitHub Actions (`.github/workflows/cicd.yml`) on push to `main`: install → type-check → build → register Discord commands → terraform apply.

Required GitHub Secrets: `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `VERIFY_TOKEN`, `DEEPSEEK_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

## Discord Setup

Set Interactions Endpoint URL to `API_URL/discord-interactions`. Lambda verifies Ed25519 signature before responding.

## Test

```bash
curl API_URL/health
# {"status":"ok"}
```

## Local Development

```bash
npm run build
node scripts/serve-local.js   # http://localhost:3000
node scripts/test-strava.js   # Strava API test tool
```
