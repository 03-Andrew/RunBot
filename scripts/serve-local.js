const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. Load root .env file to populate environment variables
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const firstEquals = trimmed.indexOf('=');
    if (firstEquals === -1) return;
    const key = trimmed.substring(0, firstEquals).trim();
    let val = trimmed.substring(firstEquals + 1).trim();
    // remove surrounding quotes if any
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    process.env[key] = val;
  });
  console.log('Loaded environment variables from .env');
} else {
  console.warn('Warning: .env file not found at root directory.');
}

// Ensure AWS region defaults if not set
if (!process.env.AWS_REGION && process.env.AWS_DEFAULT_REGION) {
  process.env.AWS_REGION = process.env.AWS_DEFAULT_REGION;
}

// 2. Load the Lambda handler
const lambdaDistPath = path.join(__dirname, '../lambdas/api/dist/index.js');
if (!fs.existsSync(lambdaDistPath)) {
  console.error(`Error: Compiled lambda not found at ${lambdaDistPath}`);
  console.error('Please run "npm run build" first to compile TypeScript.');
  process.exit(1);
}

const { handler } = require(lambdaDistPath);

// 3. Create the HTTP server
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    
    // Parse query string parameters
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const queryStringParameters = {};
    parsedUrl.searchParams.forEach((value, key) => {
      queryStringParameters[key] = value;
    });

    // Mock API Gateway Payload Format 2.0 Event
    const event = {
      version: "2.0",
      routeKey: `${req.method} ${parsedUrl.pathname}`,
      rawPath: parsedUrl.pathname,
      rawQueryString: parsedUrl.search.substring(1),
      headers: req.headers,
      queryStringParameters: Object.keys(queryStringParameters).length > 0 ? queryStringParameters : null,
      requestContext: {
        http: {
          method: req.method,
          path: parsedUrl.pathname,
          protocol: `HTTP/${req.httpVersion}`,
          sourceIp: req.socket.remoteAddress,
          userAgent: req.headers['user-agent'] || 'unknown'
        }
      },
      body: rawBody || null,
      isBase64Encoded: false
    };

    console.log(`[Request] ${req.method} ${parsedUrl.pathname}`);
    
    try {
      // Invoke the Lambda handler
      const result = await handler(event);
      
      // Set status code
      res.statusCode = result.statusCode || 200;
      
      // Set headers
      if (result.headers) {
        Object.entries(result.headers).forEach(([key, val]) => {
          res.setHeader(key, val);
        });
      }
      
      // Send response body
      res.end(result.body || '');
      console.log(`[Response] ${res.statusCode}`);
    } catch (err) {
      console.error('[Error] Lambda handler failed:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Local Lambda Dev Server running at http://localhost:${PORT}`);
  console.log(`- Health Check: GET http://localhost:${PORT}/health`);
  console.log(`- Discord Webhook: POST http://localhost:${PORT}/discord-interactions`);
  console.log(`- Strava Webhook: GET/POST http://localhost:${PORT}/strava/webhook`);
});
