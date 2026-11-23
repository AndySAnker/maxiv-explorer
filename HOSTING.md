# Hosting MAX IV Explorer

**Single-player, no server:** the game is one static page, `index.html` + `game.bundle.js`. It is published with
GitHub Pages at **https://andysanker.github.io/maxiv-explorer/** (Settings → Pages → *Deploy from a branch*: `main`, `/`).
Any static web host works the same way, and so does opening `index.html` from disk.

**Multiplayer** needs the small server below.

`server/server.mjs` is a small Node.js server with **no dependencies**. It serves the game and a WebSocket relay, so
players who open the same address meet each other, see names and avatars, and chat (press **T**).

* Rooms: everyone with the same `?room=` in the address meets, e.g. `https://your-server/?room=kemi2026`.
  Without it, everyone is in `lobby`.
* Limits: 40 players per room, 400 in total, 8 connections per IP address (change with `MAX_PER_ROOM`, `MAX_TOTAL`,
  `MAX_PER_IP`). Behind a reverse proxy (Render, Fly, nginx) set `TRUST_PROXY=1` so the per-IP limit sees the real
  client address.
* Safety: names ≤ 20 characters and chat ≤ 200 characters with hidden characters removed and a short list of
  obscenities masked; chat is limited to about one line per second; positions are clamped; only `index.html` and
  `game.bundle.js` are served.
* Privacy: nothing is stored. The server only knows who is online right now; nothing is logged.
* Health check: `GET /healthz`.

## 1 · On your own computer or a DTU machine (quickest)

```bash
node server/server.mjs
```

Open `http://localhost:8080`. Others on the same network open `http://<your-computer's-IP>:8080`
(macOS: System Settings → Network shows the IP). Use `PORT=9000 node server/server.mjs` for another port.

## 2 · Render (free tier, public HTTPS address)

1. On render.com: **New → Web Service → connect the GitHub repo** `maxiv-explorer`.
2. Runtime **Node**, build command *(empty)*, start command `node server/server.mjs`, environment variable
   `TRUST_PROXY=1`.
3. Deploy. The game is at `https://<name>.onrender.com`; share `https://<name>.onrender.com/?room=yourclass`.

The free tier sleeps after ~15 minutes without visitors; the first visit then takes ~30–60 s to wake it.
A paid instance (a few dollars a month) stays awake.

## 3 · Any Docker host (Fly.io, Railway, a DTU VM, …)

```bash
docker build -t maxiv-explorer .
docker run -p 8080:8080 maxiv-explorer
```

Put it behind HTTPS (most platforms do that for you); the game then uses `wss://` automatically.

## 4 · Game on GitHub Pages, relay elsewhere

If the game files are hosted on a static host, run the server anywhere (options 2–3) and point the game to it in
`index.html`:

```html
<meta name="maxiv-relay" content="wss://your-relay.example/ws">
```

To accept connections only from your page, start the relay with
`ALLOWED_ORIGINS=https://andysanker.github.io`.

## After changing the game

Run `./build.sh` (rebuilds `game.bundle.js`), commit and push; Render redeploys automatically from GitHub.
Inside claude.ai the same game uses the artifact's own live room instead of this relay.
