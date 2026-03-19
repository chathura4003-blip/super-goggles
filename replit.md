# Supreme MD Bot

A WhatsApp Multi-Device bot built with Node.js + Baileys, featuring a full professional Web Admin Panel, universal media downloader (yt-dlp), and 80+ commands.

## Architecture

- **`index.js`** — Main entry point; starts dashboard, then bot
- **`bot.js`** — WhatsApp connection via Baileys; stores active socket in `state.js`
- **`state.js`** — Shared runtime state (socket, status, number, logs)
- **`dashboard.js`** — Express + Socket.io server (port 5000); full JWT REST API + serves admin panel
- **`config.js`** — Central config (bot name, owner, JWT secret, admin credentials, port, prefix, etc.)
- **`downloader.js`** — Video/audio download (yt-dlp + system ffmpeg); 2hr file cache; auto-retry
- **`search.js`** — Multi-site media search
- **`logger.js`** — Logging utility; streams to state + Socket.io
- **`lib/`** — Command handler, DB utilities, 84 command modules
- **`public/admin.html`** — React CDN SPA — the complete admin panel

## Admin Panel (port 5000)

**Login:** `admin` / `chathura123` (set in `config.js` as `ADMIN_USER` / `ADMIN_PASS`)

**Pages:**
- **Dashboard** — Live stats (RAM, CPU, uptime, users, files), system info chart
- **Sessions** — View connected WhatsApp session, logout button
- **Broadcast** — Send text to all known users or specific numbers
- **Settings** — Bot name, prefix, feature toggles (NSFW, auto-read, auto-typing), restart button
- **Economy** — View/edit all user balances, reset economy
- **Files** — Browse and delete downloaded media files
- **Logs** — Real-time live log stream via WebSocket

**API Endpoints (all require `Authorization: Bearer <token>`):**
```
POST /api/auth/login          → { token }
GET  /api/stats               → system + bot stats
GET  /api/sessions            → session list
POST /api/sessions/logout     → log out bot
POST /api/broadcast           → send message
POST /api/admin/restart       → restart bot
GET  /api/settings            → get settings
POST /api/settings            → update settings
GET  /api/economy             → user balances
POST /api/economy/edit        → edit balance
POST /api/economy/reset       → reset all balances
GET  /api/files               → list downloaded files
DELETE /api/files/:name       → delete file
GET  /api/logs                → recent logs (up to 500)
```

## Tech Stack

- **Node.js** v20, 256MB RAM limit (`--max-old-space-size=256`)
- **@whiskeysockets/baileys** — WhatsApp Web API
- **Express** + **Socket.io** — Web server + real-time events
- **jsonwebtoken** — JWT auth for admin panel
- **React 18** (CDN) + **Tailwind CSS** (CDN) — Admin UI (no build step)
- **yt-dlp-linux** binary + **system ffmpeg** (NixOS path) — media downloads
- **fluent-ffmpeg** — video compression
- **JSON flat file DB** (`db.json`) — users, groups, settings

## Key Config Values

| Key | Value |
|-----|-------|
| Port | 5000 |
| Admin user | admin |
| Admin pass | chathura123 |
| JWT secret | `supreme_md_jwt_secret_2026_!@#$` |
| Owner number | 94742514900 |
| Bot prefix | `.` |
| Premium code | SUPREME2026 |

## Download System

- Binary: `yt-dlp-linux` (chmod +rx); auto-downloads if missing
- ffmpeg: system binary at `/nix/store/.../bin/ffmpeg` (auto-detected)
- SD format: `best[ext=mp4]` (no merge needed — no postproc errors)
- HD format: `bestvideo+bestaudio` merge with system ffmpeg
- Cache: MD5 hash of `url:isAudio:quality` → 2hr TTL, auto-file-delete
- Compression: libx264 via fluent-ffmpeg for files > 50MB
- Files > 100MB sent as WhatsApp document (bypasses upload limit)
- Auto-retry with `best[ext=mp4]` if postprocessing fails

## Run

```bash
npm start
# → node --max-old-space-size=256 index.js
# → Dashboard: http://localhost:5000
```
