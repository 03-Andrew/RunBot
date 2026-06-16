#!/usr/bin/env node
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PK = "USER#745214705177722901";
const TABLE = "ActivityBot";

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  let r;

  if (cmd === "get") {
    r = await db.send(new GetCommand({ TableName: TABLE, Key: { PK, SK: a } }));
    console.log(JSON.stringify(r.Item ?? null, null, 2));
  } else if (cmd === "query") {
    r = await db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": PK, ":sk": a },
      }),
    );
    console.log(r.Items?.length + " items");
    console.log(JSON.stringify(r.Items ?? [], null, 2));
  } else if (cmd === "scan") {
    r = await db.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "SK = :sk",
        ExpressionAttributeValues: { ":sk": a },
        Limit: 10,
      }),
    );
    console.log("Scanned: " + r.ScannedCount + "  Returned: " + r.Count);
    console.log(JSON.stringify(r.Items ?? [], null, 2));
  } else if (cmd === "put") {
    r = await db.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK, SK: a, ...JSON.parse(b || "{}") },
      }),
    );
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === "update") {
    r = await db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK, SK: a },
        UpdateExpression: b || "SET #n = :v",
        ExpressionAttributeNames: {
          "#n": a.includes("RATE") ? "tokens" : "test",
        },
        ExpressionAttributeValues: { ":v": 5 },
      }),
    );
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log("Usage: node scripts/ddb.js <cmd> [args]");
    console.log("  get    <SK>              Get item by PK+SK");
    console.log("  query  <SK-prefix>       Query items by PK + SK prefix");
    console.log(
      "  scan   <SK>              Scan table filtered by SK (limit 10)",
    );
    console.log("  put    <SK> <json>       Put item with PK + SK, merge JSON");
    console.log("  update <SK> [expr]       Update item (demo: SET tokens=5)");
    console.log("  delete <SK>              Delete item by PK+SK");
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
