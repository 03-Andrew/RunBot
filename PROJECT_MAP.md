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
  - the Lambda function
  - API Gateway routes
  - the DynamoDB table
  - IAM permissions
- `outputs.tf`: exported values such as the API URL.

### `lambdas/health/`

This is the actual application code that runs in Lambda.

- `package.json`: Lambda-local dependencies and build script.
- `tsconfig.json`: TypeScript compiler settings.
- `scripts/copy-prod-deps.js`: copies production dependencies into `dist/node_modules` after build.
- `src/`: TypeScript source.
- `dist/`: compiled output that Terraform packages and deploys. This is generated, not edited by hand.

## Lambda source files

### Entry point

- `src/index.ts`: the route dispatcher. It looks at the HTTP path and method, then forwards to the correct handler.

### Route handlers

- `src/handlers/health.ts`: `GET /health` response.
- `src/handlers/discordInteractions.ts`: Discord slash command webhook handler that defers slow commands to SQS.
- `src/handlers/stravaCallback.ts`: Strava OAuth callback after a user connects their account.
- `src/handlers/stravaWebhook.ts`: Strava webhook receiver for new activities and updates.

### Shared helpers

- `src/http.ts`: helpers for JSON, HTML, and plain text responses.
- `src/requestUtils.ts`: request body and header helpers.
- `src/storage.ts`: DynamoDB client setup.
- `src/discord.ts`: Discord request verification and Strava auth URL builder.
- `src/stravaApi.ts`: Strava token refresh, activity fetches, and DynamoDB lookup helpers.
- `src/stravaStats.ts`: weekly stats calculation and formatting.
- `src/stravaActivityMessage.ts`: formats the activity notification sent to Discord.
- `src/stravaConnectedPage.ts`: the HTML page shown after Strava OAuth succeeds.
- `src/lambdaTypes.ts`: local type definitions for the Lambda event shape.

## Current data flow

1. Discord sends an interaction to `/discord-interactions`.
2. The Lambda verifies the request signature.
3. `/strava` returns a Strava connect URL.
4. `/stats` and `/club-activities` enqueue an SQS job and return a deferred Discord response.
5. Strava redirects back to `/strava/callback` after OAuth.
6. The callback stores the user tokens in DynamoDB.
7. Strava webhook events arrive at `/strava/webhook`.
8. The webhook fetches the activity details from Strava, stores a copy in DynamoDB, and posts a message to Discord.
9. The worker later posts the final slash-command result back to Discord through the interaction follow-up webhook.

## DynamoDB layout

One table is used: `ActivityBot`.

Common item shapes:

- User profile:
  - `PK = USER#{discordId}`
  - `SK = PROFILE`
- Activity record:
  - `PK = USER#{discordId}`
  - `SK = ACTIVITY#{activityId}`

The table is schema-less, so the code controls what fields each item stores.

## Important scripts

- `npm run build` at the repo root: builds the Lambda.
- `npm --prefix lambdas/health run build`: compiles TypeScript and copies production dependencies into `dist/`.
- `node scripts/registerCommand.js`: registers Discord slash commands.
- `terraform -chdir=infrastructure apply`: deploys AWS infrastructure.
- `terraform -chdir=infrastructure/bootstrap apply`: creates the remote Terraform backend.

## Generated files

Do not edit these by hand:

- `lambdas/health/dist/`
- `lambdas/health/function.zip`

They are produced by the build/package flow.
