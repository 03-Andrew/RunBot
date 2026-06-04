# RunBot Project Map

This repo is a small AWS backend for a Strava + Discord bot.

## What lives where

### Root

- `package.json`: convenience scripts for building and Terraform.
- `README.md`: high-level deploy and test notes.
- `.github/workflows/cicd.yml`: GitHub Actions workflow that builds, registers commands, and deploys Terraform.
- `PROJECT_MAP.md`: this file.

### `infrastructure/`

Terraform for the AWS deployment.

- `provider.tf`: Terraform provider setup.
- `backend.tf`: remote S3 backend for Terraform state and lock files.
- `bootstrap/`: one-time Terraform stack that creates the backend bucket.
- `variables.tf`: input variables such as Discord and Strava secrets.
- `main.tf`: the main infrastructure definition. It creates:
  - the HTTP Lambda function (`health`)
  - the AI Lambda function (`ai_worker`)
  - the SQS Worker Lambda function (`strava_worker`)
  - API Gateway routes and integrations
  - the DynamoDB table (`ActivityBot`) with a GSI (`GSI1`) for Strava ID lookups
  - SQS queue and DLQ for retry/deferral flows
  - IAM permissions and roles
- `outputs.tf`: exported values such as the API URL.

### `lambdas/health/`

This is the application code for both the HTTP Lambda and the SQS Worker Lambda.

- `package.json`: Lambda-local dependencies and build script.
- `tsconfig.json`: TypeScript compiler settings (uses Node 16 module resolution).
- `scripts/copy-prod-deps.js`: copies production dependencies into `dist/node_modules` after build.
- `src/`: TypeScript source code.
- `dist/`: compiled output that Terraform packages and deploys. This is generated, not edited by hand.

### `lambdas/aiAnalysis/`

AI-based run analysis Lambda (`ai_worker`) using Gemini.

- `package.json`: Lambda-local build script.
- `tsconfig.json`: TypeScript compiler settings (uses Node 16 module resolution).
- `src/`: TypeScript source code.
  - `src/index.ts`: Entry point handler. Routes `/ai-coach` POST requests and handles key auth.
  - `src/agent.ts`: The main running coach agent. Implements Gemini-based natural language chat with tool-calling (weekly stats, latest run, comparison) via DynamoDB.
  - `src/stravaApi.ts`: Helper functions to fetch linked Strava user, stored activities, and personal records.
  - `src/stravaStats.ts`: Calculation helpers for weekly summaries.
  - `src/storage.ts`: DynamoDB client initialization.
- `dist/`: compiled output packaged by Terraform.

## Lambda source files (`lambdas/health/src`)

### Entry points

- `src/index.ts`: The route dispatcher for the HTTP Lambda. Handles `/health` directly and routes callbacks/webhooks/interactions.
- `src/worker.ts`: The entry point for the SQS Worker Lambda. Invokes `handleProcessStravaWebhook`.

### Route and Queue handlers

- `src/handlers/discordInteractions.ts`: Validates request signatures, enforces global rate limits, and routes slash commands (queues `/stats`, `/club-activities`, `/analyse run`, `/ai` to SQS).
- `src/handlers/stravaWebhook.ts`: Verifies Strava's webhook challenge and pushes new webhook activities into SQS.
- `src/handlers/stravaCallback.ts`: Exchanges authorization codes for Strava tokens and renders an inline HTML confirmation page.
- `src/handlers/processStravaWebhook.ts`: SQS job worker. Processes webhook events (creates activities, stores them in DynamoDB, checks/updates personal records, posts to Discord) and deferred commands (`stats`, `club-activities`, `analyse-run`, `ai-chat`).

### Shared helpers

- `src/http.ts`: Standardized JSON, text, and HTML HTTP response creators.
- `src/storage.ts`: DynamoDB client initialization.
- `src/discord.ts`: Cryptographic request signature validator and auth URL builder.
- `src/stravaApi.ts`: Fetches activities from Strava, handles OAuth refresh, queries DynamoDB.
- `src/stravaFormatting.ts`: Centralizes stats compilation, message formatting (activity messages and club feeds), and Discord content formatting.
- `src/types.ts`: Central TypeScript definitions for SQS jobs, API events, and type-guards (e.g., `DiscordSlashCommandJob`, `StravaWebhookJob`, `StravaBackfillJob`).

## Current data flow

1. Discord sends an interaction to `/discord-interactions`.
2. The HTTP Lambda verifies the signature and checks global rate limits for intensive commands.
3. `/strava` responds with a link. `/stats`, `/club-activities`, `/analyse run`, and `/ai` enqueue SQS jobs and return deferred (type 5) responses.
4. Strava webhook events arrive at `/strava/webhook`, validate immediately, and are enqueued as jobs in SQS.
5. The SQS Queue triggers the Worker Lambda.
6. The Worker Lambda executes:
   - For webhooks: Fetches Strava details, updates DynamoDB activities, evaluates/saves running Personal Records (PRs), and pushes notifications to Discord.
   - For `/stats` and `/club-activities`: Gathers activity logs, formats messages, and posts them via follow-up webhooks.
   - For `/analyse run`: Retrieves the user's run history, requests an analysis from the AI endpoint (`/ai-coach`), and responds with the coaching report.
   - For `/ai` chat: Queries the AI endpoint (`/ai-coach`) with a natural language prompt, allowing Gemini to invoke tool-calling for user stats before returning the answer.

## DynamoDB layout

One table is used: `ActivityBot`. It has a Global Secondary Index (`GSI1`) for querying users by their Strava ID.

Common item shapes:

- **User profile**:
  - `PK = USER#{discordId}`
  - `SK = PROFILE`
  - `GSI1PK = STRAVA#{stravaAthleteId}`
  - `GSI1SK = PROFILE`
- **Activity record**:
  - `PK = USER#{discordId}`
  - `SK = ACTIVITY#{activityId}`
- **Personal Records (PRs)**:
  - `PK = USER#{discordId}`
  - `SK = PERSONAL_RECORDS`
  - Attributes: `personalRecords` (map of longest run, climb, 5k, 10k, half marathon).
- **Rate Limit**:
  - `PK = USER#{discordId}`
  - `SK = RATE_LIMIT`
  - Attributes: `tokens` (number of available tokens), `lastRefill` (epoch timestamp).

The table is schema-less, so the code controls what fields each item stores.

## Important scripts

- `npm run build` at the repo root: builds all Lambdas.
- `npm --prefix lambdas/health run build`: compiles health/worker code and copies prod dependencies.
- `npm --prefix lambdas/aiAnalysis run build`: compiles AI agent code.
- `node scripts/registerCommand.js`: registers Discord slash commands.
- `node scripts/serve-local.js`: runs local mock API Gateway for handler testing.
- `node scripts/test-strava.js`: tests Strava API authorization and retrieval.
- `terraform -chdir=infrastructure apply`: deploys AWS infrastructure.
- `terraform -chdir=infrastructure/bootstrap apply`: creates the remote Terraform backend.

## Generated files

Do not edit these by hand:

- `lambdas/health/dist/`
- `lambdas/health/function.zip`

They are produced by the build/package flow.
