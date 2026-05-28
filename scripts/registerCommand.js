const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const entries = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const entry of entries) {
    const line = entry.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, ".env"));

const { APP_ID, BOT_TOKEN } = process.env;

if (!APP_ID || !BOT_TOKEN) {
  throw new Error("Missing APP_ID or BOT_TOKEN. Add them to scripts/.env.");
}

async function register(){

 const commands=[
   {
     name:"health",
     description:"Check bot health"
   },
   {
     name:"strava",
     description:"Connect Strava account"
   },
   {
     name:"stats",
     description:"Show your weekly Strava stats"
   },
   {
     name:"club-activities",
     description:"List recent activities from the default Strava club"
   }, 
   {
     name:"help",
     description:"Show available commands"
   }
 ];

 await fetch(
   `https://discord.com/api/v10/applications/${APP_ID}/commands`,
   {
      method:"PUT",

      headers:{
        "Authorization":`Bot ${BOT_TOKEN}`,
        "Content-Type":"application/json"
      },

      body:JSON.stringify(commands)
   }
 )

 console.log("done")
}

register()
