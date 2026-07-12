# DukuDukuChat — Backend Server

> **Two front-end builds use this same backend:** `DukuDukuChat_Web.html`
> (Pi + Google + Apple login — for testing/standalone use outside Pi
> Browser, not submitted to the Pi App Directory) and
> `DukuDukuChat_PiReady.html` (Pi-only login, plus report/block moderation —
> this is the build to actually submit for Mainnet listing). Both talk to
> the exact same API below.

A real Node.js/Express backend for DukuDukuChat: SQLite persistence, a REST
API, realtime chat over Socket.IO, and **genuine server-side verification**
of Pi Network, Google, and Apple sign-in tokens (not simulated).

This replaces the in-memory, front-end-only logic in `DukuDukuChat_App.html`
with real data that survives page reloads and is shared across devices/users.

> **Important — this was written but not runtime-tested in the sandbox that
> built it.** That sandbox's network policy blocks `npm install` (the npm
> registry isn't on its network allowlist), so I could not run `npm install`
> or boot the server myself to confirm it starts cleanly end-to-end. Every
> file passed `node --check` (syntax validation) and I did a careful manual
> logic review — including catching and fixing one real bug this way (the
> `jose` package's latest major version is ESM-only and would have crashed
> under Node's `require()`; it's pinned to a CommonJS-compatible version
> below). But there is no substitute for actually running it. **Please run
> `npm install && npm run dev` yourself and treat the first run as a real
> smoke test** — see "Known-risk areas" at the bottom of this file for where
> I'd look first if something doesn't boot.

## What's real here vs. the front-end-only demo

| | Front-end-only demo (`DukuDukuChat_App.html`) | This backend |
|---|---|---|
| Login | Simulated OAuth popup, always "succeeds" | Real Pi API call, real Google JWT verification, real Apple JWT verification |
| Data | JavaScript variables, gone on refresh | SQLite database, persists |
| Chat | Fake, client-only auto-replies | Persisted messages + Socket.IO realtime push (auto-reply is still simulated — see below) |
| Multi-user | No — every visitor is an island | Yes — one shared database, real accounts |
| Wallet | A number in memory | A real balance column, transaction history, atomic transfers |

## 1. Install

```bash
cd server
npm install
cp .env.example .env
```

Generate a real session secret and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 2. Run it locally (no real Pi/Google/Apple credentials needed yet)

`.env.example` ships with `ALLOW_DEV_LOGIN=true`, which enables one extra
endpoint — `POST /api/auth/dev-login` — that creates a session for a fake
user without needing any real OAuth credentials. This is how you test
everything else (posting, chat, wallet, mini-apps) before you've registered
with Pi/Google/Apple.

```bash
npm run dev
```

You should see:

```
DukuDukuChat server listening on http://localhost:4000
  Health check:      GET  /health
  Dev login enabled: YES (never do this in production)
```

Sanity check:

```bash
curl http://localhost:4000/health
# {"ok":true,"service":"dukuduku-chat-server"}

curl -i -c cookies.txt -X POST http://localhost:4000/api/auth/dev-login \
  -H "Content-Type: application/json" -d '{"name":"Test User"}'
# should return 200 with a user object

curl -b cookies.txt http://localhost:4000/api/posts
# should return the seeded welcome post
```

**Turn `ALLOW_DEV_LOGIN` off (`false`) before this ever runs in production** —
it's an intentional authentication bypass.

## 3. Wire up real credentials

### Pi Network
No server-side secret is needed. The client calls the Pi SDK
(`Pi.authenticate(...)`) inside the Pi Browser, gets an `accessToken`, and
sends it to `POST /api/auth/pi-verify`. This server calls
`https://api.minepi.com/v2/me` with that token and only trusts what Pi's API
returns. Nothing to configure here beyond registering your app in the
[Pi Developer Portal](https://pi-apps.github.io/community-developer-guide/docs/gettingStarted/devPortal/)
(see the Spec doc from earlier for the full checklist).

### Google
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs &
   Services → Credentials → Create OAuth 2.0 Client ID (type: Web
   application). Add your front-end's URL to "Authorized JavaScript origins".
2. Put the client ID in `.env` as `GOOGLE_CLIENT_ID`.
3. The front-end needs the same client ID (see the web app's config).

### Apple
1. In the [Apple Developer portal](https://developer.apple.com/account/),
   create a Services ID for "Sign in with Apple" and configure your domain +
   return URL.
2. Put that Services ID in `.env` as `APPLE_CLIENT_ID`.

Once real credentials are set, set `ALLOW_DEV_LOGIN=false`.

## 4. Deploying it somewhere with a real HTTPS URL

Any Node host that gives you a persistent process and disk works. Two easy
free-tier options:

**Render** — create a new "Web Service" from your repo, build command
`npm install`, start command `npm start`, add the `.env` values under
Environment. Render gives you an HTTPS URL automatically.

**Railway** — `railway init`, `railway up`, then set environment variables
in the dashboard. Also gives you an HTTPS URL automatically.

Either way, after deploying:
1. Set `FRONTEND_ORIGIN` in your environment to your front-end's real URL(s).
2. Update the front-end's `API_BASE` (see the web app) to point at your new
   backend URL.
3. For the **Pi Browser build specifically**, Pi requires you to host at your
   own verified domain and place a verification file Pi gives you at the
   domain root — see the Developer Portal checklist in the Spec doc.

## Known-risk areas (read this if `npm install` or boot fails)

Since I couldn't run this myself, here's exactly where I'd look first:

1. **`better-sqlite3` native build** — it ships prebuilt binaries for common
   platforms, but if your host's OS/Node version has no prebuild, `npm
   install` will try to compile it with `node-gyp`, which needs a C++
   toolchain (Python, make, a compiler). If that fails, the fastest fix is
   swapping to a hosted Postgres (e.g. via Render/Railway's free Postgres)
   and the `pg` package — the query shapes in `src/routes/*.js` are simple
   enough to port by hand (mostly `db.prepare(...).get/all/run(...)` →
   `pool.query(...)`).
2. **`jose` version** — pinned to `^4.15.9` in `package.json` specifically
   because v5+ dropped CommonJS support and this project uses `require()`
   throughout. Don't bump it to v5 without also converting the whole project
   to ESM.
3. **`nanoid` version** — pinned to `^3.3.7` for the same CJS-vs-ESM reason.
4. **Socket.IO auth** — `src/socket.js` reads the session cookie off the
   raw handshake headers. If you put this server behind a reverse proxy,
   make sure cookies aren't stripped and `credentials: true` survives on the
   client's `io(url, { withCredentials: true })` call.
5. **CORS + cookies** — if the front-end and backend are on different
   origins in production, `FRONTEND_ORIGIN` must exactly match the front-end
   URL (scheme + host + port), and the front-end's `fetch()` calls need
   `credentials: 'include'` or the session cookie won't be sent.

## API overview

All endpoints are under `/api`. Authenticated routes read a session from an
httpOnly cookie (or `Authorization: Bearer <token>` for non-browser testing).

- `POST /api/auth/pi-verify` `{accessToken}` → real Pi verification
- `POST /api/auth/google-verify` `{idToken}` → real Google verification
- `POST /api/auth/apple-verify` `{idToken}` → real Apple verification
- `POST /api/auth/dev-login` `{name}` → dev-only bypass (see above)
- `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST /api/posts`, `POST /api/posts/:id/like|comments|tip`
- `GET/POST /api/stories`, `POST /api/stories/:id/view`
- `GET/POST /api/videos`, `POST /api/videos/:id/like`
- `GET/POST /api/chats`, `GET/POST /api/chats/:id/messages`,
  `POST /api/chats/:id/secret`, `POST /api/chats/qr-connect`
- `GET /api/wallet`, `POST /api/wallet/tip`
- `GET /api/notifications`, `POST /api/notifications/read-all`
- `GET/PUT /api/center-button` (PUT is owner-only)
- `GET/POST /api/polls`, `POST /api/polls/:id/vote`
- `PUT /api/profile`, `POST /api/profile/require-passcode`
- `POST /api/moderation/report` `{targetType, targetId, reason, details?}` — file a report (Community Guidelines compliance)
- `POST /api/moderation/block` `{userId}`, `POST /api/moderation/unblock` `{userId}`, `GET /api/moderation/blocked`
  — blocked users' posts/videos are automatically filtered out of `GET /api/posts` and `GET /api/videos`

Realtime: connect Socket.IO with the session cookie attached, then emit
`chat:join`/`chat:leave` with a chat id to receive that chat's `message`
events. `notification` events arrive on your personal `user:<id>` room
automatically.
