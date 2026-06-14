# Cricket Live Score (Next.js)

The simplest web app that shows **live cricket match scores**.
Auto-refreshes every 30s, or hit the Refresh button.

## How to run

1. Make sure [Node.js](https://nodejs.org) (v18+) is installed.
2. In this folder, install dependencies:
   ```bash
   npm install
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Open http://localhost:3000

The CricAPI key is already set in [.env.local](.env.local).
Get your own free key at https://cricapi.com if needed.

## How it works

- [app/api/matches/route.js](app/api/matches/route.js) — server route that calls
  CricAPI. The key stays on the server (never sent to the browser) and this also
  avoids CORS issues.
- [app/page.js](app/page.js) — client page that fetches `/api/matches`, renders the
  list, and auto-refreshes every 30 seconds.

## Project structure

```
app/
├── api/matches/route.js   # server-side CricAPI proxy
├── page.js                # main page (live score list)
├── layout.js              # root layout
└── globals.css            # styles
.env.local                 # CRICAPI_KEY
package.json
```

## Notes

- The free CricAPI tier is rate-limited per day — fine for testing.
- To deploy, push to GitHub and import into Vercel; add `CRICAPI_KEY` as an
  environment variable there.
```
