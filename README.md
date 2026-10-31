# Teamroom — Realtime Workspace for Companies

A production-grade, fully-realtime team collaboration platform:
fast file transfer, WhatsApp-style team chat, projects & kanban tasks, role-based access, presence & live notifications — all updating instantly over WebSockets.

> Vercel-inspired dark/light theme · Hand-rolled SVG icon system (no icon fonts, no hardcoded CDNs) · Mobile-ready layout · JWT auth · SQLite persistence · Drag-and-drop uploads

## 🌐 Live demo

| Environment | URL |
|---|---|
| **Production (Vercel)** | https://startup-mb.vercel.app |
| Local dev | http://localhost:5173 |

The landing page lives at `/`; open **Create your workspace** to register — the first account on any fresh deployment automatically becomes the **Owner**.

> **Deploy note:** On Vercel (serverless), realtime runs over an automatic HTTP long-polling fallback (`/api/poll`) since WebSockets aren't supported there. Self-hosted (`npm start`) uses native WebSockets for sub-millisecond updates. The SQLite DB and uploads live in `/tmp` on Vercel (ephemeral) and in `data/` + `uploads/` when self-hosted (persistent).

## Features

- 🔐 **Auth & roles** — Register / login with JWT. First user is owner; owners/admins can create custom roles with fine-grained permissions (`projects.write`, `tasks.write`, `chat.write`, `files.write`, `members.manage`).
- 💬 **WhatsApp-style chat** — Global + per-project channels, typing indicators, presence dots, grouped messages, enter-to-send, optimistic send.
- 📁 **Fast file transfer** — Drag-and-drop uploads, streaming downloads, per-project file spaces, progress feedback, up to 500 MB per file.
- 📋 **Projects & tasks** — Create projects with colors & members; kanban board with todo / in-progress / done columns; drag-and-drop between columns; assign tasks; one-click "done"; optimistic updates.
- ⚡ **Realtime everywhere** — WebSocket bus broadcasts messages, task changes, file uploads, member join/leave, notifications with toasts. No polling.
- 🔔 **Notifications** — Inbox with unread counts; auto-cleared when read; "mark all as read".
- 🎨 **Beautiful UI** — Vercel-inspired theme, perfect dark + light modes, custom hand-drawn SVG icons, soft shadows, micro-animations.
- 👥 **Team management** — Invite members, assign roles, online/offline roster, profile avatars.

## Tech

| Layer     | Stack                                                  |
|-----------|--------------------------------------------------------|
| Backend   | Node.js + **Fastify** + `ws` WebSockets + sql.js (SQLite WASM) + JWT (HS256) |
| Frontend  | React 18 + Vite + TailwindCSS, hand-written SVG icons  |
| Realtime  | Custom pub/sub over native WebSocket                   |
| Storage   | Local `uploads/` directory, SQLite DB in `data/`       |
| Passwords | Argon2-style (bcrypt) hashing with per-user salt       |

## Quick start

```bash
# install deps
npm run install:all

# initialize database (first-run seeds default roles)
npm run db:init

# dev mode: runs api on :8787, web on :5173 (vite proxies /api and /ws to api)
npm run dev
```

Then open **http://localhost:5173** and create your first account — it becomes
the workspace **Owner**. Invite teammates from the Team page.

### Production (self-host)

```bash
npm run build   # compiles frontend into web/dist
npm start       # serves API + built frontend + WebSockets from :8787
```

### Deploy to Vercel

The repo ships with `vercel.json` and a serverless entrypoint (`api/index.js`):

```bash
vercel --prod   # or connect the repo in the Vercel dashboard
```

- Static SPA is served from `web/dist`; `/api/*` maps to the Fastify-based lambda.
- Realtime uses the `/api/poll` long-poll fallback automatically (no WS on serverless).
```

## Project layout

```
server/               Fastify backend
  src/index.js        HTTP + WS entrypoint
  src/hub.js          Realtime WebSocket hub (pub/sub, chat, typing, presence)
  src/auth.js         JWT auth, registration, role checks
  src/jwt-shim.js     Minimal dependency-free HS256 JWT
  src/db/             SQLite setup, migrations, helpers
  src/routes/         auth · users · roles · projects · tasks · files · chat · notifications
web/                  React + Vite frontend
  src/pages/          Login, Home, Chat, Projects, ProjectDetail, Files, Team, Settings
  src/components/     Sidebar, Avatar, Modal, Notifications, FileDropZone, Icons
  src/lib/            api client, realtime ws client, utilities
uploads/              Uploaded files (gitignored)
data/                 SQLite DB (gitignored)
```

## Demo credentials

No demo accounts pre-seeded — the first account to register becomes Owner so you
can onboard your team from the Settings / Team page.

## Roadmap / ideas already in the product

- [x] Realtime chat with typing indicators & presence
- [x] Per-project channels
- [x] Kanban tasks with drag-and-drop + optimistic updates
- [x] Drag-and-drop file uploads with progress
- [x] Custom role system
- [x] Dark/light theme toggle (persisted)
- [x] Notification center
- [ ] Threaded replies & reactions
- [ ] Direct messages
- [ ] Postgres adapter (swap sql.js for `pg` easily — queries are standard SQL)
- [ ] End-to-end encrypted file sharing

## License

MIT — hack it, ship it, sell it.
