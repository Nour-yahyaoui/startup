// Standalone entrypoint (npm start)
import { buildApp, attachHubToServer } from './app.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

async function start() {
  const app = await buildApp();
  const server = app.server;
  attachHubToServer(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Teamroom server running on http://0.0.0.0:${PORT}`);
    console.log(`   WebSocket: ws://0.0.0.0:${PORT}/ws`);
    console.log(`   Web UI:    http://localhost:5173 (dev) or http://localhost:${PORT} (production)\n`);
  });
}

start().catch((e) => { console.error(e); process.exit(1); });
