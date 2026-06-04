#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Helper to load environment variables from .env file
function loadEnv(envPath) {
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const firstEquals = trimmed.indexOf('=');
      if (firstEquals === -1) return;
      const key = trimmed.substring(0, firstEquals).trim();
      let val = trimmed.substring(firstEquals + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    });
  }
}

// Load env files
loadEnv(path.join(__dirname, '../.env'));
loadEnv(path.join(__dirname, '.env'));

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

function printUsage() {
  console.log(`
\x1b[1mStrava API Testing Tool\x1b[0m
=======================
This script allows you to test Strava API operations directly from your terminal.
It reads \x1b[36mSTRAVA_CLIENT_ID\x1b[0m and \x1b[36mSTRAVA_CLIENT_SECRET\x1b[0m from your \x1b[34m.env\x1b[0m file.

\x1b[1mUsage:\x1b[0m
  node scripts/test-strava.js <command> [arguments] [options]

\x1b[1mCommands:\x1b[0m
  \x1b[32mexchange\x1b[0m <code>                              Exchange an authorization code for a refresh token.
  \x1b[32mathlete\x1b[0m <refresh_token>                     Fetch the authenticated athlete's profile.
  \x1b[32mactivities\x1b[0m <refresh_token> [options]         Fetch activities with filtering options.
                                                Options:
                                                  --before <epoch>   Filter activities before this epoch timestamp.
                                                  --after <epoch>    Filter activities after this epoch timestamp.
                                                  --page <number>    Page number (default: 1).
                                                  --per-page <num>   Number of items (default: 5, API default: 30).
  \x1b[32mactivity\x1b[0m <refresh_token> <activity_id>      Fetch detailed data for a specific activity.
  \x1b[32mclub\x1b[0m <refresh_token> <club_id>              Fetch recent activities for a specific Strava club.
  \x1b[32mrefresh\x1b[0m <refresh_token>                     Test refreshing the Access Token.

\x1b[1mConfiguration Status:\x1b[0m
  STRAVA_CLIENT_ID: ${STRAVA_CLIENT_ID ? `\x1b[32mConfigured (${STRAVA_CLIENT_ID})\x1b[0m` : '\x1b[31mMissing\x1b[0m'}
  STRAVA_CLIENT_SECRET: ${STRAVA_CLIENT_SECRET ? '\x1b[32mConfigured\x1b[0m' : '\x1b[31mMissing\x1b[0m'}

${STRAVA_CLIENT_ID ? `\x1b[1mManual Authorization Steps:\x1b[0m
  1. Open this URL in your browser and authorize:
     \x1b[34mhttps://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all\x1b[0m
  2. You will be redirected to localhost (which may fail to load - that's fine).
  3. Copy the \x1b[36mcode\x1b[0m parameter from the URL address bar (e.g. \x1b[36m?code=xxxxxxx\x1b[0m).
  4. Exchange that code for a refresh token using this script:
     \x1b[32mnode scripts/test-strava.js exchange <your_code>\x1b[0m` : ''}
`);
}

// Ensure Strava Client configuration is loaded
if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
  printUsage();
  process.exit(1);
}

// Helper to refresh a token
async function getAccessToken(refreshToken) {
  console.log(`Refreshing access token using refresh token...`);
  try {
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || JSON.stringify(data));
    }

    console.log(`\x1b[32mSuccess!\x1b[0m Access token retrieved.`);
    console.log(`Access Token: \x1b[36m${data.access_token}\x1b[0m`);
    console.log(`Expires At:   \x1b[36m${new Date(data.expires_at * 1000).toLocaleString()}\x1b[0m`);
    return data.access_token;
  } catch (error) {
    console.error(`\x1b[31mError refreshing access token:\x1b[0m`, error.message);
    process.exit(1);
  }
}

// API request helper
async function callStravaApi(endpoint, accessToken) {
  console.log(`Calling Strava API: https://www.strava.com/api/v3${endpoint}...`);
  try {
    const response = await fetch(`https://www.strava.com/api/v3${endpoint}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      const details = data.errors ? ` (details: ${JSON.stringify(data.errors)})` : '';
      throw new Error(`${data.message}${details}`);
    }
    return data;
  } catch (error) {
    console.error(`\x1b[31mAPI Error:\x1b[0m`, error.message);
    if (error.message.includes('Authorization Error')) {
      console.log(`\n\x1b[33mTip:\x1b[0m An 'Authorization Error' during API calls (when token refresh succeeded) usually means your token lacks the required scopes (e.g., 'activity:read' or 'activity:read_all').`);
      console.log(`To fix this, re-authorize your Strava account using a link that includes '&scope=activity:read_all'.`);
    }
    process.exit(1);
  }
}

async function exchangeCodeForToken(code) {
  console.log(`Exchanging authorization code for tokens...`);
  try {
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || JSON.stringify(data));
    }

    console.log(`\n\x1b[32mSuccess!\x1b[0m Tokens retrieved:`);
    console.log(`Refresh Token: \x1b[36m${data.refresh_token}\x1b[0m`);
    console.log(`Access Token:  \x1b[36m${data.access_token}\x1b[0m`);
    console.log(`Athlete ID:    ${data.athlete ? data.athlete.id : 'N/A'}`);
    console.log(`Athlete Name:  ${data.athlete ? `${data.athlete.firstname} ${data.athlete.lastname}` : 'N/A'}`);
    console.log(`\nYou can now use this \x1b[1mRefresh Token\x1b[0m to test the other commands.`);
  } catch (error) {
    console.error(`\x1b[31mError exchanging code:\x1b[0m`, error.message);
    process.exit(1);
  }
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return;
  }

  const command = args[0];
  const refreshToken = args[1]; // represents code for 'exchange' command
  const extraArg = args[2];

  if (!refreshToken) {
    const isExchange = command === 'exchange';
    console.error(`\x1b[31mError:\x1b[0m ${isExchange ? '<code>' : '<refresh_token>'} argument is required.\n`);
    printUsage();
    process.exit(1);
  }

  // Parse optional command-line flags
  const options = {};
  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--before' && i + 1 < args.length) {
      options.before = args[++i];
    } else if (arg === '--after' && i + 1 < args.length) {
      options.after = args[++i];
    } else if (arg === '--page' && i + 1 < args.length) {
      options.page = args[++i];
    } else if (arg === '--per-page' && i + 1 < args.length) {
      options.per_page = args[++i];
    }
  }

  switch (command) {
    case 'exchange': {
      await exchangeCodeForToken(refreshToken);
      break;
    }

    case 'refresh': {
      await getAccessToken(refreshToken);
      break;
    }

    case 'athlete': {
      const token = await getAccessToken(refreshToken);
      const data = await callStravaApi('/athlete', token);
      console.log('\n\x1b[1mAthlete Profile:\x1b[0m');
      console.log(JSON.stringify({
        id: data.id,
        username: data.username,
        firstname: data.firstname,
        lastname: data.lastname,
        city: data.city,
        state: data.state,
        premium: data.premium,
        created_at: data.created_at
      }, null, 2));
      break;
    }

    case 'activities': {
      const token = await getAccessToken(refreshToken);
      
      const queryParams = new URLSearchParams();
      if (options.before) queryParams.set('before', options.before);
      if (options.after) queryParams.set('after', options.after);
      if (options.page) queryParams.set('page', options.page);
      if (options.per_page) queryParams.set('per_page', options.per_page);
      else queryParams.set('per_page', '5'); // default to 5 to avoid overflowing the console
      
      const queryString = queryParams.toString();
      const endpoint = `/athlete/activities${queryString ? `?${queryString}` : ''}`;
      
      const data = await callStravaApi(endpoint, token);
      console.log(`\n\x1b[1mAthlete Activities (${data.length}):\x1b[0m`);
      data.forEach((act, idx) => {
        console.log(`\n[${idx + 1}] Activity ID: \x1b[36m${act.id}\x1b[0m`);
        console.log(`    Name:        ${act.name}`);
        console.log(`    Type:        ${act.type} / Sport: ${act.sport_type}`);
        console.log(`    Start Date:  ${act.start_date}`);
        console.log(`    Distance:    ${(act.distance / 1000).toFixed(2)} km`);
        console.log(`    Moving Time: ${(act.moving_time / 60).toFixed(1)} mins`);
      });
      break;
    }

    case 'activity': {
      if (!extraArg) {
        console.error(`\x1b[31mError:\x1b[0m <activity_id> is required for the 'activity' command.\n`);
        console.log(`Usage: node scripts/test-strava.js activity <refresh_token> <activity_id>`);
        process.exit(1);
      }
      const token = await getAccessToken(refreshToken);
      const data = await callStravaApi(`/activities/${extraArg}`, token);
      console.log('\n\x1b[1mActivity Details:\x1b[0m');
      console.log(JSON.stringify({
        id: data.id,
        name: data.name,
        type: data.type,
        sport_type: data.sport_type,
        start_date: data.start_date,
        distance: data.distance,
        moving_time: data.moving_time,
        elapsed_time: data.elapsed_time,
        total_elevation_gain: data.total_elevation_gain,
        calories: data.calories,
        description: data.description,
        device_name: data.device_name
      }, null, 2));
      break;
    }

    case 'club': {
      if (!extraArg) {
        console.error(`\x1b[31mError:\x1b[0m <club_id> is required for the 'club' command.\n`);
        console.log(`Usage: node scripts/test-strava.js club <refresh_token> <club_id>`);
        process.exit(1);
      }
      const token = await getAccessToken(refreshToken);
      const data = await callStravaApi(`/clubs/${extraArg}/activities?per_page=5`, token);
      console.log(`\n\x1b[1mClub Activities (${data.length}):\x1b[0m`);
      data.forEach((act, idx) => {
        console.log(`\n[${idx + 1}] Activity Name: ${act.name}`);
        console.log(`    Athlete:     ${act.athlete ? `${act.athlete.firstname} ${act.athlete.lastname}` : 'Unknown'}`);
        console.log(`    Type:        ${act.type}`);
        console.log(`    Distance:    ${(act.distance / 1000).toFixed(2)} km`);
        console.log(`    Moving Time: ${(act.moving_time / 60).toFixed(1)} mins`);
      });
      break;
    }

    default:
      console.error(`\x1b[31mUnknown command:\x1b[0m ${command}`);
      printUsage();
      process.exit(1);
  }
}

run();
