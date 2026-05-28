# RunBot

Minimal AWS serverless backend for a Strava + Discord bot.

## Stack

- Node.js + TypeScript
- AWS Lambda
- API Gateway HTTP API
- Amazon SQS for webhook retry processing and deferred slash commands
- Terraform

## Environment

Use `.env.example` as the placeholder reference:

```text
AWS_ACCESS_KEY=YOUR_KEY
AWS_SECRET_KEY=YOUR_SECRET
AWS_REGION=ap-southeast-1
TF_VAR_discord_public_key=YOUR_DISCORD_APP_PUBLIC_KEY
TF_VAR_discord_application_id=YOUR_DISCORD_APP_ID
```

Terraform uses the standard AWS provider credential chain. Export credentials before applying:

```bash
export AWS_ACCESS_KEY_ID=YOUR_KEY
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET
export AWS_REGION=ap-southeast-1
export TF_VAR_discord_public_key=YOUR_DISCORD_APP_PUBLIC_KEY
export TF_VAR_discord_application_id=YOUR_DISCORD_APP_ID
export TF_VAR_ai_coach_token=YOUR_RANDOM_INTERNAL_TOKEN
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

The slash-command flow now supports `/analyse run`, which queues an AI analysis job. The worker gathers recent and historical Strava runs, sends them to the AI endpoint, and posts the resulting coaching report back to Discord.

The AI endpoint is also exposed at:

```text
API_URL/ai-coach
```

## Strava Webhooks

The `/strava/webhook` endpoint now only validates the webhook and enqueues a job in SQS. A worker Lambda consumes that job, fetches the Strava activity, stores it in DynamoDB, and posts to Discord. The `/discord-interactions` endpoint now defers `/stats` and `/club-activities` by enqueuing work in SQS, then the worker posts the final response back through Discord's interaction follow-up webhook. Failed jobs are retried automatically and moved to the DLQ after repeated failures.
