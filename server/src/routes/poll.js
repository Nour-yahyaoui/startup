// Long-polling fallback for serverless environments (Vercel) where WebSockets aren't available.
import { ringSince } from '../hub.js';
import { createVerifier } from '../auth.js';
import { get } from '../db/index.js';

export async function pollRoutes(app) {
  app.get('/api/poll', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const token = (req.query.token || (req.headers.authorization||'').replace(/^Bearer\s+/,''));
    let userId = null;
    if (token) {
      try {
        const payload = createVerifier()(token);
        const u = get('SELECT id, role FROM users WHERE id = ?', [payload.sub]);
        if (u) userId = u.id;
      } catch {}
    }
    const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
    const { events, cursor: next } = ringSince(cursor);
    // Filter: user-scoped events must match userId; global/project events visible to all authed
    const visible = userId ? events : events.filter(ev => ev.type && ev.type.startsWith('public:'));
    return { events: visible, cursor: next };
  });
}
