// Fastify app factory (used by standalone server and Vercel serverless handler).
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initDb } from './db/index.js';
import { createHub } from './hub.js';
import { authenticate, requirePerm } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { fileRoutes } from './routes/files.js';
import { chatRoutes } from './routes/chat.js';
import { notifRoutes } from './routes/notifications.js';
import { pollRoutes } from './routes/poll.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _app;
export async function buildApp(opts = {}) {
  if (_app && !opts.forceNew) return _app;
  await initDb();
  const app = Fastify({
    logger: opts.serverless ? false : { level: 'info' },
    bodyLimit: (opts.serverless ? 50 : 200) * 1024 * 1024,
    trustProxy: true
  });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: (opts.serverless ? 50 : 500) * 1024 * 1024 } });

  app.decorate('authenticate', authenticate(app));
  app.decorate('requirePerm', requirePerm);
  // Attach a hub (no-op if no server provided yet; replaced when server is bound)
  app.decorate('hub', createHub(null));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(projectRoutes);
  await app.register(taskRoutes);
  await app.register(fileRoutes);
  await app.register(chatRoutes);
  await app.register(notifRoutes);
  await app.register(pollRoutes);

  app.get('/api/health', async () => ({ ok: true, ts: Date.now(), serverless: !!opts.serverless }));

  if (!opts.serverless) {
    const webDist = path.resolve(__dirname, '../../web/dist');
    if (fs.existsSync(webDist)) {
      await app.register(fastifyStatic, { root: webDist, prefix: '/', index: ['index.html'] });
      app.setNotFoundHandler((req, reply) => {
        if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) return reply.sendFile('index.html');
        reply.code(404).send({ error: 'Not found' });
      });
    }
  }
  await app.ready();
  if (!opts.forceNew) _app = app;
  return app;
}

export function attachHubToServer(server) {
  _app.hub = createHub(server);
  return _app.hub;
}
