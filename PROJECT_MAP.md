# RunBot Project Map

RunBot is a serverless AWS backend that connects Strava and Discord. It automatically posts activity notifications, tracks personal records, and provides an integrated DeepSeek-powered AI running coach — all triggered via Discord slash commands.

## What lives where

### Root

- `package.json`: convenience scripts for building and Terraform.
- `README.md`: full feature documentation, environment setup, and deploy guide.
- `.github/workflows/cicd.yml`: GitHub Actions workflow that builds, registers Discord commands, and deploys Terraform.
- `PROJECT_MAP.md`: this file.

### `infrastructure/`

Terraform for the AWS deployment.

- `provider.tf`: Terraform provider setup.
- `backend.tf`: remote S3 backend for Terraform state and lock files.
- `bootstrap/`: one-time Terraform stack that creates the backend bucket.
- `variables.tf`: input variables such as Discord and Strava secrets.
- `main.tf`: the main infrastructure definition. It creates:
  - the HTTP Lambda function (`api`) — handles all public HTTP endpoints
  - the SQS Worker Lambda function (`strava-worker`) — processes background jobs with integrated DeepSeek AI
  - the Weekly Recap Lambda function (`weekly-recap`) — automated Sunday recap via EventBridge Scheduler
  - API Gateway routes and integrations
  - the DynamoDB table (`ActivityBot`) with a GSI (`GSI1`) for Strava ID lookups
  - SQS queue and DLQ for retry/deferral flows
  - EventBridge Scheduler for cron-based weekly recap invocation
  - IAM permissions and roles (6 roles: api, worker, weekly-recap Lambda, weekly-recap scheduler, plus KMS policies)
- `outputs.tf`: exported values such as the API URL.

### `lambdas/api/`

Application code for both the HTTP (`api`) and SQS Worker (`strava-worker`) Lambda functions. They are deployed from the same compiled bundle (`dist/`) but use different handler entry points.

- `package.json`: Lambda-local dependencies and build script.
- `tsconfig.json`: TypeScript compiler settings.
- `scripts/copy-prod-deps.js`: copies production dependencies into `dist/node_modules` after build.
- `src/`: TypeScript source code (see breakdown below).
- `dist/`: compiled output that Terraform packages and deploys. Do not edit by hand.

---

## Lambda source files (`lambdas/api/src`)

### Entry points

- `src/index.ts`: Route dispatcher for the HTTP (`api`) Lambda. Handles `GET /health`, and routes `/discord-interactions`, `/strava/callback`, and `/strava/webhook` to the correct handler.
- `src/worker.ts`: Entry point for the SQS Worker Lambda. Receives SQS Records and calls `handleProcessStravaWebhook`.
- `src/weeklyRecap.ts`: Entry point for the `weekly-recap` Lambda. Triggered by EventBridge Scheduler every Sunday. Scans all linked athletes, compiles weekly stats with DeepSeek AI insights, and posts the recap to Discord.

### Route handlers (HTTP Lambda)

- `src/handlers/discordInteractions.ts`: Validates Discord Ed25519 request signatures, enforces the global DynamoDB token-bucket rate limiter, and handles all slash commands:
  - `/strava` — returns a Strava OAuth authorization URL immediately.
  - `/stats`, `/club-activities`, `/analyse run`, `/ai`, `/prs` — enqueues SQS jobs and returns a Type 5 deferred response.
  - `/help` — returns the list of available commands immediately.
- `src/handlers/stravaWebhook.ts`: Handles `GET /strava/webhook` (webhook challenge verification) and `POST /strava/webhook` (enqueues a new `strava-webhook` SQS job).
- `src/handlers/stravaCallback.ts`: Handles `GET /strava/callback`. Exchanges the Strava authorization code for tokens, stores the user profile in DynamoDB, sends a welcome DM and channel notification to Discord, queues a 730-day historical activity backfill job, and renders a branded HTML confirmation page.
- `src/handlers/stravaConnectedPage.ts`: Static HTML confirmation page returned after successful Strava OAuth connection.

### SQS Worker (strava-worker Lambda)

- `src/handlers/processStravaWebhook.ts`: Processes all SQS job types:
  - **`strava-webhook`** — Fetches the Strava activity details, upserts the activity record in DynamoDB, incrementally updates personal records, and posts a Discord channel notification.
  - **`strava-backfill`** — Fetches up to 730 days of historical activities from Strava, saves them all to DynamoDB, and runs a full PR recalculation from scratch.
  - **`discord-slash-command / stats`** — Fetches the current week's Strava activities and posts a weekly stats summary to Discord via follow-up webhook.
  - **`discord-slash-command / club-activities`** — Fetches the latest 30 activities from the configured Strava Club and posts the formatted list via follow-up webhook.
  - **`discord-slash-command / analyse-run`** — Builds a run context payload (latest run, 5 recent runs, 10 historical runs, weekly summary) and calls `runRunAnalysis` from `src/ai/runAnalysis.ts` to generate a DeepSeek coaching report.
  - **`discord-slash-command / ai-chat`** — Calls `runNaturalLanguageAi` from `src/ai/agent.ts` with the user's prompt for free-form AI coaching.
  - **`discord-slash-command / prs`** — Reads pre-computed personal records from DynamoDB and posts a formatted PR card via follow-up webhook.

### AI (`src/ai/`)

- `src/ai/agent.ts`: Contains both AI execution engines:
  - `runNaturalLanguageAi(prompt, discordUserId)` — Conversational DeepSeek agent with a multi-turn tool-calling loop (up to 4 iterations). Tools: `get_latest_run`, `get_recent_runs`, `get_weekly_stats`, `compare_to_past_runs`, `get_personal_records`.
  - `runRunAnalysis(input)` — Single-pass DeepSeek call that builds a structured coaching report from a run context payload using a detailed prompt template.
- `src/ai/deepseek.ts`: DeepSeek API client. Calls `https://api.deepseek.com/v1/chat/completions` with tool definitions, handles responses.
- `src/ai/tools.ts`: Tool definitions (5 tools) and `executeTool` dispatcher. Tools: `get_latest_run`, `get_recent_runs`, `get_weekly_stats`, `compare_to_past_runs`, `get_personal_records`. On-the-fly PR fallback if pre-computed record is missing.
- `src/ai/run-data.ts`: Shared helpers for AI tools — `loadRunHistory`, `summarizeRun`, `dedupeAndSortRuns`, plus PR threshold constants.
- `src/ai/runAnalysis.ts`: Builds and sends structured run analysis prompt to DeepSeek for `/analyse run`.
- `src/ai/conversation.ts`: Loads/saves multi-turn conversation history from DynamoDB (10-turn cap).
- `src/ai/types.ts`: Type definitions for AI agent — messages, tool calls, agent context, analysis input.

### Shared helpers

- `src/http.ts`: Standardized JSON, text, and HTML HTTP response creators.
- `src/storage.ts`: DynamoDB client initialization (`DynamoDBDocumentClient`).
- `src/discord.ts`: Ed25519 request signature validator, Strava OAuth URL builder, `postDiscordMessage`, `postDiscordInteractionFollowUp`, and `sendDiscordDM`.
- `src/stravaApi.ts`: Strava API client. Handles OAuth token refresh, fetches individual activities, paginated activity lists, club activities, and queries the DynamoDB user and activity stores.
- `src/stravaFormatting.ts`: Stats compilation (`calculateWeeklyStats`, `getCurrentWeekStartUnixSeconds`), Discord message formatters for activities (`buildStravaActivityMessage`), weekly stats (`buildWeeklyStatsMessage`), and club feeds (`buildClubActivitiesMessageForClub`).
- `src/types.ts`: Central TypeScript type definitions and runtime type-guards for `DiscordSlashCommandJob`, `StravaWebhookJob`, `StravaBackfillJob`, and `ApiGatewayEvent`.

---

## Data flow

```
Discord User
    │
    ▼
POST /discord-interactions
    │
    ├── Verify Ed25519 signature
    ├── Check DynamoDB rate limit
    │
    ├── /strava → return OAuth URL (instant)
    ├── /help   → return command list (instant)
    │
    └── /stats, /club-activities, /analyse run, /ai, /prs
            │
            ▼
        SQS Queue (strava-webhook-queue)
            │
            ▼
        strava-worker Lambda
            │
            ├── stats          → fetch Strava activities → post weekly stats to Discord
            ├── club-activities→ fetch club activities → post feed to Discord
            ├── analyse-run    → build run context → DeepSeek analysis → post report to Discord
            ├── ai-chat        → DeepSeek tool-calling agent → post response to Discord
            └── prs            → read pre-computed PRs from DynamoDB → post PR card to Discord

POST /strava/webhook (Strava event)
    │
    ▼
SQS Queue
    │
    ▼
strava-worker Lambda
    │
    ├── Fetch activity from Strava API
    ├── Upsert activity in DynamoDB
    ├── Incrementally update Personal Records
    └── Post Discord notification

GET /strava/callback (OAuth return)
    │
    ├── Exchange code for tokens
    ├── Store user profile in DynamoDB
    ├── Post Discord channel + DM notification
    ├── Queue 730-day historical backfill
    └── Return HTML confirmation page

EventBridge Scheduler (cron)
    │
    ▼
weekly-recap Lambda
    │
    ├── Scan DynamoDB (all USER# profiles)
    ├── Fetch each athlete's current-week activities
    ├── Calculate weekly stats
    ├── Call DeepSeek for AI coaching insight
    └── Post recap to Discord channel
```

---

## DynamoDB layout

One table: `ActivityBot`. One GSI: `GSI1` for querying users by Strava athlete ID.

| Item type | PK | SK | Key attributes |
| :--- | :--- | :--- | :--- |
| User profile | `USER#{discordId}` | `PROFILE` | `AccessToken`, `RefreshToken`, `ExpiresAt`, `GSI1PK`, `GSI1SK` |
| Activity record | `USER#{discordId}` | `ACTIVITY#{activityId}` | All Strava activity fields, `DiscordID`, `UpdatedAt` |
| Personal Records | `USER#{discordId}` | `PERSONAL_RECORDS` | `personalRecords` map: `longestRun`, `biggestClimb`, `best5k`, `best10k`, `bestHalfMarathon` |
| Rate Limit | `USER#{discordId}` | `RATE_LIMIT` | `tokens`, `lastRefill`, `UpdatedAt` |

---

## Important scripts

- `npm run build` — builds the Lambda from the repo root.
- `npm --prefix lambdas/api run build` — compiles TypeScript and copies prod dependencies into `dist/`.
- `node scripts/registerCommand.js` — registers Discord slash commands via the Discord API.
- `node scripts/serve-local.js` — runs a local mock API Gateway server on `http://localhost:3000`.
- `node scripts/ddb.js` — CLI for direct DynamoDB table inspection (get/query/scan/put/update).
- `node scripts/test-strava.js` — interactive CLI for testing Strava API token exchanges and activity lookups.
- `terraform -chdir=infrastructure apply` — deploys AWS infrastructure.
- `terraform -chdir=infrastructure/bootstrap apply` — creates the remote Terraform state backend.

## Generated files

Do not edit these by hand:

- `lambdas/api/dist/`
- `lambdas/api/function.zip`

They are produced by the build/package flow.
