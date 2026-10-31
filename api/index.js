// Vercel serverless handler.
// - /api/* routes are handled by the Fastify app.
// - Everything else (non-API GETs) serves static assets from web/dist so the SPA works.
import { buildApp } from '../server/src/app.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../web/dist');

let appPromise;
async function getApp() {
  if (!appPromise) appPromise = buildApp({ serverless: true });
  return appPromise;
}

const MIME_TYPES = {
  '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.ico':'image/x-icon',
  '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.map':'application/json'
};

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || !urlPath.startsWith('/')) urlPath = '/index.html';
  // Block path traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(WEB_DIST, safePath);
  // If file doesn't exist (SPA route), fall back to index.html
  if (!fs.existsSync(filePath)) filePath = path.join(WEB_DIST, 'index.html');
  const ext = path.extname(filePath).toLowerCase();
  const ct = MIME_TYPES[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
  fs.createReadStream(filePath).pipe(res);
}

export default async function handler(req, res) {
  // Vercel passes url without /api prefix on rewrites? Actually it keeps the full path.
  if (req.url.startsWith('/api/')) {
    const app = await getApp();
    // Strip /api prefix for Fastify (it registers routes on /api/..., so we keep prefix)
    app.server.emit('request', req, res);
    return;
  }
  serveStatic(req, res);
}
