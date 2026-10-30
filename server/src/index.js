import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initDb } from './db/index.js';
import { Hub } from './hub.js';
import { authenticate, requirePerm } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { fileRoutes } from './routes/files.js';
import { chatRoutes } from './routes/chat.js';
import { notifRoutes } from './routes/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

async function start() {
  await initDb();

  const app = Fastify({ logger: { level: 'info' }, bodyLimit: 200 * 1024 * 1024 });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });

  // Decorate app with auth helpers & hub
  app.decorate('authenticate', authenticate(app));
  app.decorate('requirePerm', requirePerm);

  // Register routes
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(projectRoutes);
  await app.register(taskRoutes);
  await app.register(fileRoutes);
  await app.register(chatRoutes);
  await app.register(notifRoutes);

  // Health
  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

  // Serve built frontend in production (only if dist/ exists; dev uses Vite proxy)
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.register(async (app2) => {
      await app2.register(fastifyStatic, { root: webDist, prefix: '/', index: ['index.html'] });
      app2.setNotFoundHandler((req, reply) => {
        // For SPA, only serve index.html for non-API GETs
        if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
          return reply.sendFile('index.html');
        }
        reply.code(404).send({ error: 'Not found' });
      });
    }, { prefix: '/' });
  }

  // Attach HTTP server & WebSocket hub
  await app.ready();
  const server = app.server;
  app.hub = new Hub(server);

  server.listen(PORT, '0.0.0.0', () => {
    const actualPort = server.address().port;
    console.log(`\n🚀 Nexa server running on http://0.0.0.0:${actualPort}`);
    console.log(`   WebSocket: ws://0.0.0.0:${actualPort}/ws`);
    console.log(`   Web UI:    ${webDist} (run 'npm run build --prefix web' first)\n`);
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
