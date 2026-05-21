"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stravaConnectedPage = void 0;
exports.stravaConnectedPage = `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Strava Connected</title>
      <style>
        :root {
          color-scheme: light;
          font-family: Arial, Helvetica, sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        body {
          min-height: 100vh;
          margin: 0;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at top, rgba(252, 76, 2, 0.18), transparent 34rem),
            linear-gradient(135deg, #fff7f2 0%, #f7f7f4 48%, #ffffff 100%);
          color: #242428;
          padding: 24px;
        }

        .card {
          width: min(100%, 420px);
          text-align: center;
          background: #ffffff;
          border: 1px solid #f0e6df;
          border-radius: 8px;
          box-shadow: 0 24px 70px rgba(36, 36, 40, 0.14);
          padding: 36px 30px 30px;
        }

        .mark {
          width: 64px;
          height: 64px;
          margin: 0 auto 22px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: #fc4c02;
          color: #ffffff;
          font-size: 34px;
          line-height: 1;
        }

        h1 {
          margin: 0 0 10px;
          font-size: 28px;
          line-height: 1.2;
          letter-spacing: 0;
        }

        p {
          margin: 0 0 26px;
          color: #5f6267;
          font-size: 16px;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <main class="card">
        <div class="mark" aria-hidden="true">✓</div>
        <h1>Strava Connected</h1>
        <p>Your Strava account is connected to Discord. You may now exit this tab.</p>
      </main>
    </body>
  </html>
`;
