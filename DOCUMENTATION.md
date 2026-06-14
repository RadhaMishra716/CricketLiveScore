# Cricket Live Score — Full Documentation & Interview Guide

A complete, self-contained explanation of this project: what it is, how every
piece works, the build/deploy pipeline, and a full interview Q&A with answers.

---

# Part 1 — Project Overview

## 1.1 What this project is

A small **Next.js (App Router)** web app that displays **live cricket match
scores** pulled from **CricAPI** (`api.cricapi.com`). It auto-refreshes every 30
seconds and has a manual **Refresh** button. The same web build is packaged into
an **Android APK** using **Capacitor**.

So it is really **one codebase, two delivery targets**:

| Target | How it's served | Entry point |
|--------|-----------------|-------------|
| Web app | `next dev` / static export hosted on Vercel | `app/page.js` |
| Android app | Static export (`out/`) wrapped by Capacitor into an APK | same `app/page.js` |

## 1.2 Tech stack

| Layer | Technology | Version (from `package.json`) |
|-------|-----------|-------------------------------|
| UI framework | React | ^19.2.7 |
| App framework | Next.js (App Router) | ^16.2.7 |
| Mobile wrapper | Capacitor (Android) | ^8.4.0 |
| Data source | CricAPI REST API | — |
| Styling | Plain CSS (`globals.css`) | — |
| Language | JavaScript (no TypeScript) | — |

## 1.3 File map

```
Sports Score App/
├── app/
│   ├── api/matches/route.js   # Server-side API route (CricAPI proxy) — see note below
│   ├── page.js                # Main client page: fetch + render + auto-refresh
│   ├── layout.js              # Root layout + page metadata
│   └── globals.css            # All styling
├── next.config.mjs            # Next.js config — static export for Capacitor
├── capacitor.config.json      # Capacitor config (appId, appName, webDir: "out")
├── package.json               # Dependencies + scripts
├── .env.local                 # API key (gitignored)
├── out/                       # Generated static export (fed to Capacitor) — DO NOT edit
├── android/                   # Generated native Android project — DO NOT edit by hand
└── node_modules/              # Dependencies — generated
```

> **Only `app/`, the config files, and `.env.local` are real source.** Everything
> in `out/`, `android/.../build/`, `.next/`, and `node_modules/` is generated.

---

# Part 2 — How Everything Works (deep dive)

## 2.1 The data flow

```
                 ┌─────────────────────────────────────────────┐
                 │                CricAPI                       │
                 │  GET /v1/currentMatches?apikey=...           │
                 └───────────────▲─────────────────────┬────────┘
                                 │ HTTPS               │ JSON
            (Path B — actually used in this project)   │
                                 │                     ▼
   Browser / Android WebView ────┘          { status, data: [ matches ] }
        app/page.js  ──────────► transforms ──► React state ──► rendered cards
                                 ▲
            (Path A — server route, present but NOT active here)
        app/api/matches/route.js
```

There are **two fetch paths** in the repo. Understanding why is the single most
important thing about this project.

### Path A — Server route: `app/api/matches/route.js`
```js
export const dynamic = "force-dynamic";
export async function GET() {
  const key = process.env.CRICAPI_KEY;          // <-- reads CRICAPI_KEY
  if (!key) return Response.json({ error: "Missing CRICAPI_KEY..." }, { status: 500 });
  ...
}
```
This is the "correct" secure design: the key lives on the server, the browser
calls `/api/matches`, and CricAPI is never contacted directly by the client.

### Path B — Client fetch: `app/page.js`
```js
const API_KEY = process.env.NEXT_PUBLIC_CRICAPI_KEY;  // <-- reads NEXT_PUBLIC_CRICAPI_KEY
const API_URL = `https://api.cricapi.com/v1/currentMatches?offset=0&apikey=${API_KEY}`;
// page.js fetches CricAPI DIRECTLY from the browser/WebView.
```

### ⚠️ Which one actually runs?

Your `.env.local` contains **only**:
```
NEXT_PUBLIC_CRICAPI_KEY=<your key>
```

There is **no `CRICAPI_KEY`** defined. Therefore:

- **Path A (the server route) would fail** with `"Missing CRICAPI_KEY"` — it is
  effectively dead code right now.
- **Path B (the client fetch in `page.js`) is what powers the app.** The page
  never calls `/api/matches`; it calls CricAPI directly.

This is also **why the app works inside the Android APK**: a static export +
Capacitor has **no Node server**, so the server route couldn't run there anyway.
Path B is the only path that works on mobile. (Trade-off: the API key ships to
the client — see Security, §2.7.)

## 2.2 `app/page.js` — line by line

```js
"use client";
```
Marks this as a **Client Component** — it uses browser-only features (`useState`,
`useEffect`, `setInterval`, event handlers). Server Components cannot use these.

```js
const [matches, setMatches] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError]   = useState(null);
```
Three independent pieces of state:
- `matches` — the list to render.
- `loading` — drives the disabled/"Loading…" button state.
- `error` — holds an error message string, or `null` when healthy.

Keeping them separate lets the UI represent **every** combination: loading,
loaded-empty, loaded-with-data, and error.

```js
const load = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    const data = await res.json();
    if (data.status !== "success") throw new Error(data.status || "Request failed");
    const list = (data.data || []).map((m) => ({ id, name, status, score }));
    setMatches(list);
  } catch (e) {
    setError(e.message);
  } finally {
    setLoading(false);
  }
}, []);
```
- `useCallback(..., [])` gives `load` a **stable identity** across renders, so the
  `useEffect` below doesn't re-run and recreate the interval on every render.
- `cache: "no-store"` forces a fresh network hit each time (live scores must not
  be cached).
- The API returns **HTTP 200 even on logical failure**, so we explicitly check
  `data.status !== "success"` rather than trusting `res.ok`.
- `(data.data || [])` guards against `data.data` being `null`/`undefined`.
- We **reshape** each match into a small `{ id, name, status, score }` object —
  only the fields the UI needs.
- `finally { setLoading(false) }` runs on **both** success and error, so the
  button never gets stuck in "Loading…".

```js
useEffect(() => {
  load();
  const timer = setInterval(load, 30000);
  return () => clearInterval(timer);
}, [load]);
```
- Runs once on mount: fetches immediately, then every 30s.
- The **cleanup function** `clearInterval(timer)` runs on unmount, preventing a
  memory leak and stray fetches after the component is gone.
- `[load]` is the dependency; because `load` is memoized, this effect sets up the
  interval exactly once.

The JSX then renders: a header + refresh button, an error banner (if `error`), a
"No current matches" message (loaded + empty), or a `.card` per match with its
innings scores.

## 2.3 `app/api/matches/route.js` — the server route

A **Route Handler** (App Router's equivalent of an API endpoint). Exports an
async `GET()` that returns a `Response`.

- `export const dynamic = "force-dynamic"` — opts the route out of static
  optimization so it's executed **on every request** (never cached/prerendered).
- Reads `process.env.CRICAPI_KEY` (server-only secret — no `NEXT_PUBLIC_` prefix).
- Returns structured JSON with meaningful status codes:
  - `500` — missing API key (our misconfiguration).
  - `502` — CricAPI responded but with a failure status (bad upstream gateway).
  - `500` (catch) — network/unexpected error.
- Performs the **same reshape** as the client. (This duplication is a refactor
  target — see §3.)

## 2.4 `app/layout.js` — root layout

```js
import "./globals.css";
export const metadata = { title: "Cricket Live Score", description: "..." };
export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>);
}
```
- Every App Router app needs a root layout that renders `<html>` and `<body>`.
- It's a **Server Component** (no `"use client"`) — it has no interactivity, so it
  stays on the server, which is the more efficient default.
- `metadata` is Next.js's declarative way to set `<title>` and `<meta>` tags.
- `{children}` is where the page (`page.js`) gets injected.

## 2.5 `app/globals.css`
Plain global CSS: a reset (`* { box-sizing; margin:0; padding:0 }`), body
typography/background, and component classes (`.container`, `.header`, `.card`,
`.refresh-btn`, `.muted`, `.error`). No preprocessor, no CSS modules.

## 2.6 `next.config.mjs` — the key to mobile
```js
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
};
export default nextConfig;
```
- `output: "export"` — builds a **fully static** site (HTML/CSS/JS) into `out/`
  with no Node server required. This is mandatory for Capacitor, which just ships
  static web assets.
- `images: { unoptimized: true }` — Next.js's `<Image>` optimizer needs a running
  server; static export can't provide one, so optimization must be disabled.

## 2.7 Security model (read carefully)

| Variable | Where it's readable | Secret? |
|----------|--------------------|---------|
| `CRICAPI_KEY` | Server only (route handler) | Yes — never sent to browser |
| `NEXT_PUBLIC_CRICAPI_KEY` | **Browser + server** | **No — embedded in client JS** |

Next.js inlines any env var prefixed with `NEXT_PUBLIC_` into the **client
bundle** at build time. Because this app uses `NEXT_PUBLIC_CRICAPI_KEY` in
`page.js`, **the API key is shipped to every user** (visible in DevTools → Sources,
or by decompiling the APK).

- For a throwaway/demo app with a free rate-limited key, this is acceptable.
- For production, you must hide the key behind a server you control (the route
  handler approach + a real host, or a serverless proxy), and add caching +
  rate-limiting. With a static-export + Capacitor app there is no server in the
  bundle, so the proper fix is a **separate backend/proxy** the app calls.

## 2.8 The mobile build pipeline (Capacitor)

```
 next build  ──►  out/  ──►  npx cap sync  ──►  android/  ──►  Gradle  ──►  APK
 (static export)  (web      (copies web         (native       (build)    (CricketLiveScore.apk)
                   assets)    assets in)          project)
```

1. `next build` with `output: "export"` produces static assets in `out/`.
2. `capacitor.config.json` has `"webDir": "out"`, so Capacitor knows where the web
   app lives.
3. `npx cap sync android` copies `out/` into the native Android project under
   `android/app/src/main/assets/public/`.
4. Gradle builds the `android/` project into an installable **APK**.
5. At runtime the APK loads your web app inside an Android **WebView**. Since
   there's no server, the app uses the **client fetch (Path B)** to reach CricAPI
   directly.

---

# Part 3 — Known Issues & Improvements (great to mention in interviews)

1. **Duplicated logic** — the fetch + reshape exists in both `page.js` and
   `route.js`. Extract into a shared `lib/cricapi.js`.
2. **Dead server route** — `route.js` reads `CRICAPI_KEY` which isn't set; either
   set it and route through it, or delete the route.
3. **Exposed API key** — `NEXT_PUBLIC_` ships the key to clients. Use a real proxy.
4. **No request cancellation** — overlapping refreshes can race. Add an
   `AbortController` and abort the previous request.
5. **No retry/backoff** — a transient failure just shows an error until the next
   tick. Add exponential backoff.
6. **Polling waste** — every client polls every 30s, burning the free quota. A
   shared server cache (one upstream fetch fanned out to all clients) fixes this.
7. **Background polling** — the interval keeps firing when the tab/app is hidden.
   Pause on `visibilitychange`.
8. **No tests / no TypeScript** — add unit tests for the transform and types for
   the match/score shapes.

---

# Part 4 — Interview Questions WITH Answers

## A. Architecture & Next.js

**Q1. Walk me through this project.**
A Next.js App Router web app showing live cricket scores from CricAPI. The client
page fetches matches, reshapes them, renders cards, and auto-refreshes every 30s.
The same static build is wrapped by Capacitor into an Android APK. There's also a
server route handler as an alternative (more secure) fetch path, though in the
current config the client path is the one in use.

**Q2. Why Next.js instead of plain React (Vite/CRA)?**
Next.js gives routing, a build system, server route handlers, metadata/SEO
handling, and first-class **static export** — which is exactly what Capacitor
needs. Even though this app is small, static export + the App Router make the
web→mobile pipeline trivial.

**Q3. You have two fetch paths — which is used and why do both exist?**
The **client fetch in `page.js` (Path B)** is active, because `.env.local` only
defines `NEXT_PUBLIC_CRICAPI_KEY`; the server route needs `CRICAPI_KEY`, which
isn't set, so it would error. The route exists as the "proper" secure design, but
the client path is what works — and it's also the only path that works inside the
serverless Android APK.

**Q4. What does `export const dynamic = "force-dynamic"` do?**
It forces the route handler to run **on every request** instead of being
statically cached/prerendered at build time — appropriate for live, always-fresh
data.

**Q5. What does `output: "export"` do, and what does it disable?**
It produces a fully **static** site (HTML/CSS/JS) with no Node server. It disables
server-dependent features: running API/route handlers, SSR on request,
Incremental Static Regeneration, middleware, and the Image Optimization server —
which is why `images.unoptimized: true` is set.

**Q6. Can a static export and an API route coexist?**
Not at runtime. With `output: "export"` there's no server to execute route
handlers, so `/api/matches` won't function in the exported/APK build. That's the
real reason the app relies on the client-side fetch.

**Q7. Server vs Client Components here?**
`layout.js` is a Server Component (no interactivity → stays on server, cheaper).
`page.js` is a Client Component (`"use client"`) because it uses `useState`,
`useEffect`, `setInterval`, and click handlers — all browser-only.

**Q8. What is `metadata` in `layout.js`?**
Next.js's declarative API for document head tags. Exporting a `metadata` object
sets the page `<title>` and `<meta name="description">` without manually touching
the head.

## B. React

**Q9. Explain the three state variables.**
`matches` (data to render), `loading` (controls the refresh button's
disabled/label), `error` (message string or null). Separating them lets the UI
express loading, empty, populated, and error states distinctly.

**Q10. Why `useCallback` on `load`?**
To give `load` a **stable reference** across renders. The `useEffect` depends on
`load`; without memoization, `load` would be a new function each render, the
effect would re-run, and it would tear down and recreate the 30s interval
repeatedly.

**Q11. Explain the `useEffect` and its cleanup.**
On mount it fetches once and starts a 30s interval. The returned
`() => clearInterval(timer)` is the **cleanup**, run on unmount, which stops the
timer so no fetches fire after the component is gone (prevents leaks/errors).

**Q12. Why `key={i}` on score rows — is index-as-key okay?**
Index keys are discouraged because if a list reorders/inserts, React can mis-match
elements to state and cause subtle bugs. Here the inner score list is small,
static per render, and never reordered, so it's acceptable — though `key={m.id}`
on the outer list is the correct, stable choice (and it's used there).

**Q13. Why `setLoading(false)` in `finally`?**
`finally` runs on both success and failure, guaranteeing the loading state is
always cleared — otherwise an error path could leave the button stuck on
"Loading…".

## C. Networking & Error Handling

**Q14. Why `cache: "no-store"`?**
Scores are live; we must bypass any HTTP/Next caching and always hit the network
for fresh data.

**Q15. The API returns 200 but `status !== "success"` — how handle it?**
Checking `res.ok` isn't enough because the API signals logical failure in the JSON
body while still returning HTTP 200. So we explicitly check
`data.status !== "success"` and throw/return an error in that case.

**Q16. Why the different status codes in the route (500 vs 502)?**
`500` = our server problem (missing key / unexpected exception). `502` = we're a
gateway and the **upstream** (CricAPI) failed — semantically a bad-gateway
condition. Precise codes make debugging and client handling clearer.

**Q17. Why reshape the API response?**
To send only the fields the UI needs (`id, name, status, score`), decouple the UI
from the upstream schema, and reduce payload/coupling. If CricAPI changes an
unused field, the UI is unaffected.

**Q18. What does `(data.data || [])` protect against?**
If `data.data` is `null`/`undefined`, `.map` would throw. The `|| []` falls back
to an empty array so the code safely renders "No current matches."

## D. Security

**Q19. Where does `NEXT_PUBLIC_CRICAPI_KEY` end up — is it safe?**
Anything prefixed `NEXT_PUBLIC_` is **inlined into the client bundle**, so the key
ships to every browser/APK and is publicly visible. Not safe for a sensitive key;
fine only for a throwaway, rate-limited demo key.

**Q20. Difference between `CRICAPI_KEY` and `NEXT_PUBLIC_CRICAPI_KEY`?**
`CRICAPI_KEY` is server-only (never sent to the browser). `NEXT_PUBLIC_CRICAPI_KEY`
is exposed to the client by design. The route uses the former; the page uses the
latter.

**Q21. How would you properly hide the key?**
Route all CricAPI calls through a server you control (route handler on a real host,
or a serverless function/proxy) using the non-public `CRICAPI_KEY`, and have the
client call your endpoint. Add server-side caching and rate-limiting. For the
Capacitor app (no bundled server), point it at that separate backend/proxy.

**Q22. Why is `.env.local` gitignored?**
It holds secrets (the API key). Committing it would leak the key in version
history. `.gitignore` lists `node_modules`, `.next`, and `.env.local`.

## E. Capacitor / Mobile

**Q23. What is Capacitor and how does it make an APK?**
Capacitor wraps a web app in a native shell that renders it inside a system
**WebView**, exposing native APIs via plugins. It copies the static web build
(`webDir: "out"`) into a native Android project, which Gradle compiles into an APK.

**Q24. Describe the build pipeline.**
`next build` (static export) → `out/` → `npx cap sync android` copies assets into
`android/` → Gradle builds → `CricketLiveScore.apk`. The APK loads the web app in
a WebView at runtime.

**Q25. Inside the APK, which fetch path works — and why does that force the client approach?**
Only the **client fetch (Path B)**. The APK has no Node server, so route handlers
can't execute; the WebView must call CricAPI directly, which requires the
client-readable `NEXT_PUBLIC_` key.

**Q26. CORS in the WebView vs browser?**
A normal browser enforces CORS, so a third-party API that doesn't send permissive
CORS headers could block a direct client call. CricAPI does allow it here. In the
native WebView you also have more control (and Capacitor can be configured) to
avoid CORS friction — but the cleanest production answer is to proxy through your
own backend.

## F. Scaling & Improvements

**Q27. What would you refactor first?**
Extract the duplicated fetch+reshape into a shared module; either wire up or
delete the dead server route; and move the key behind a proxy.

**Q28. How to add request cancellation?**
Use `AbortController`: create one per `load`, pass `signal` to `fetch`, and call
`controller.abort()` for the previous request (and in the effect cleanup) so
overlapping 30s refreshes don't race.

**Q29. The free tier is rate-limited and every client polls every 30s — fix it?**
Introduce a backend that fetches CricAPI **once** on an interval, caches the
result, and serves all clients from cache (fan-out). Optionally push updates via
SSE/WebSockets instead of per-client polling.

**Q30. How to get real-time updates instead of 30s polling?**
Server-Sent Events or WebSockets from your backend, so the server pushes score
changes to clients as they happen — lower latency and far fewer upstream calls.

**Q31. How would you deploy web vs mobile?**
Web: push to GitHub, import to Vercel, set the API key env var there. Mobile:
`next build` → `cap sync` → build the APK in Android Studio/Gradle and distribute
(or publish to the Play Store). The mobile build should target a hosted proxy for
the key rather than embedding it.

---

# Part 5 — 60-Second Elevator Summary

> "It's a Next.js App Router app that shows live cricket scores from CricAPI,
> auto-refreshing every 30 seconds, packaged into an Android APK with Capacitor.
> The UI is a single client component managing `matches`/`loading`/`error` state,
> fetching with `no-store`, validating the API's logical status, reshaping the
> response, and rendering cards. It's configured for static export
> (`output: "export"`) so Capacitor can bundle it — which is also why it fetches
> CricAPI from the client rather than the included server route. The main
> production gaps are the client-exposed API key and per-client polling, both
> solved by putting a caching proxy backend in front of CricAPI."
