# Nexa — a realtime team workspace

Nexa is a single-workspace collaboration app with project boards, chat, file sharing, and role-based permissions. It runs on Fastify, WebSockets, sql.js (SQLite), React, and Vite.

> **Status:** an early self-hosted product, not yet enterprise-ready or safe to operate as a multi-tenant SaaS. See [security and operational limitations](#security-and-operational-limitations) and the [research-backed product strategy](docs/product-strategy.md) before using it with sensitive data or selling it.

## What it does

- **Private projects:** a project, its tasks, project files, and project chat are accessible to its creator, explicit project members, and workspace owners/admins. The project owner or a workspace admin can add or remove members. Revocation takes effect on active WebSocket connections; removed members are unassigned from project tasks.
- **Workspace-wide collaboration:** the General chat, team directory, and files uploaded outside a project are visible to every workspace member. Project access does not make those workspace-wide spaces private.
- **Controlled onboarding and offboarding:** the first account becomes the owner. After setup, public registration closes; an authorized member manager creates accounts from Team. Deactivating a member invalidates their sessions for subsequent requests, removes non-owned project memberships and preserves their authored history; a download already in progress may finish. There is currently no email invitation or password-change/reset flow.
- **Roles and permissions:** built-in roles and custom roles govern write operations; project membership independently limits the projects a user can access. Only workspace owners/admins can manage or assign roles; member managers can create employee accounts.
- **Realtime collaboration:** project boards, messages, file events, presence, and notifications update via WebSockets. Project-specific events are scoped to authorized users.

## Quick start

Requires **Node.js 22.12 or newer** and npm.

```bash
npm ci                 # root development dependencies
npm run install:all    # install the server and web lockfiles
npm run dev            # API on :8787, web on :5173
```

Open `http://localhost:5173`. Create the first owner account, then use **Team → Create member** to create teammate accounts and share their initial passwords through a secure channel. There is one workspace per deployment; the first-owner setup is open until the first account is created, so complete it before exposing the server to others.

Roles are initialized automatically on startup; `npm run db:init` is also available to initialize the database separately.

### Build and test

```bash
npm test               # API/realtime security tests and web-client tests
npm run build          # build the frontend
npm start              # serve the built frontend and API on :8787
```

The automated tests create isolated temporary databases and upload directories; they do not use your workspace data. The Vite server proxies `/api` and `/ws` to the API so browser traffic stays on the same origin.

The server temporarily overrides `@fastify/static`’s `glob` dependency to version 14 to address the [glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) advisories. Tests exercise static serving with and without wildcard routes; remove the override when the upstream plugin supports a fixed version.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API and built-web listening port. |
| `NEXA_DATA_DIR` | `data/` | Directory containing the SQLite database and generated signing secret. |
| `NEXA_UPLOAD_DIR` | `uploads/` | Directory containing uploaded files. |
| `NEXA_JWT_SECRET` | Generated per installation | Optional stable, high-entropy signing secret; must be at least 32 characters. Changing it invalidates existing sessions. |

If no signing secret is configured, Nexa creates a random instance-specific secret in `data/jwt-secret` with restricted file permissions. Keep it private and preserve it along with the database; do not commit it. A production operator should supply a securely generated secret through their secret manager. Back up both the database and uploads using a deployment-appropriate, tested backup procedure.

## Upgrade notes for existing installations

- Back up the database and files before upgrading. Existing projects now enforce membership on API requests and realtime events. Review each project's members; workspace owners/admins continue to have access to all projects.
- Historical notification records without an explicit project or workspace scope are hidden because their privacy cannot be determined safely.
- Earlier versions could mistakenly store a project upload as a **workspace-wide** file when the multipart project field followed the file. Those old records cannot be reliably attributed to a project automatically. Review workspace-wide files and manually remove or re-upload any sensitive files to the correct project.
- Open self-registration is now restricted to first-owner setup. Create subsequent accounts through Team. Managers can no longer assign elevated roles or edit role permissions.
- Installations that relied on the old shared development signing secret will require users to sign in again. If a custom `NEXA_JWT_SECRET` was configured, it must now contain at least 32 characters.
- Deleting a project deletes its project-scoped files and messages rather than making the files workspace-wide. Deactivating a member preserves their authored history and project ownership; reactivated members must be added back to non-owned projects. Previously issued sessions remain invalid.

## Security and operational limitations

Project access controls are a useful foundation, **not a security certification**. Nexa does not currently provide MFA, SSO/SCIM, security audit logs, user-controlled password changes or resets, login rate limiting, per-session logout revocation, encryption at rest, malware scanning, automated backups, or an independent security review. Members cannot yet change the initial passwords created by a member manager, so that manager can impersonate those accounts. Tokens are stored in browser local storage. Workspace-wide chat/files are shared with all members. Administrators can access every project.

The sql.js database is exported to a local file and is designed for one server process. It is not a high-availability, concurrent multi-instance, or multi-tenant database. Local file storage has no replication, retention policy, or recovery guarantees. Do not deploy this as an enterprise or internet-facing SaaS until the security, reliability, and operational gaps are addressed.

## Project layout

```text
server/src/              Fastify API, authorization, realtime hub, SQLite setup
server/test/             Isolated API and WebSocket security tests
web/src/                 React pages, components, API and realtime clients
web/test/                Browser-client behavior tests
docs/product-strategy.md Market research, positioning, and proposed next features
data/                    Local database and signing secret (ignored by Git)
uploads/                 Uploaded files (ignored by Git)
```

## License

MIT.
