import path from 'node:path';
import fs from 'node:fs';
import { nanoid } from 'nanoid';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { all, get, run } from '../db/index.js';
import { publicUser } from '../hub.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_VERSION;
const UPLOAD_DIR = IS_SERVERLESS ? '/tmp/uploads' : path.resolve(__dirname, '../../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) { try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {} }

export async function fileRoutes(app) {
  const auth = app.authenticate;
  const canWrite = app.requirePerm('files.write');

  // List files (optionally for a project)
  app.get('/api/files', { preHandler: [auth] }, async (req) => {
    const { projectId } = req.query;
    const files = projectId
      ? all(`SELECT f.*, u.name as uploader_name, u.avatar_color as uploader_color
             FROM files f JOIN users u ON u.id = f.uploader_id WHERE project_id = ?
             ORDER BY f.created_at DESC`, [projectId])
      : all(`SELECT f.*, u.name as uploader_name, u.avatar_color as uploader_color
             FROM files f JOIN users u ON u.id = f.uploader_id
             ORDER BY f.created_at DESC LIMIT 200`);
    return { files: files.map(mapFile) };
  });

  // Upload (multipart)
  app.post('/api/files', { preHandler: [auth, canWrite] }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file' });
    const { projectId } = data.fields;
    const project_id = projectId ? String(projectId.value) : null;
    const id = nanoid(12);
    const storedName = id + '_' + sanitize(data.filename);
    const dest = path.join(UPLOAD_DIR, storedName);
    await pipeline(data.file, fs.createWriteStream(dest));
    const stat = fs.statSync(dest);
    run(
      `INSERT INTO files (id, name, original_name, mime_type, size, uploader_id, project_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, storedName, data.filename, data.mimetype, stat.size, req.user.id, project_id, Date.now()]
    );
    const f = get(
      `SELECT f.*, u.name as uploader_name, u.avatar_color as uploader_color
       FROM files f JOIN users u ON u.id = f.uploader_id WHERE f.id = ?`, [id]
    );
    const file = mapFile(f);
    app.hub.emitFileUploaded(file, req.user);
    return { file };
  });

  // Download
  app.get('/api/files/:id/download', { preHandler: [auth] }, async (req, reply) => {
    const f = get('SELECT * FROM files WHERE id = ?', [req.params.id]);
    if (!f) return reply.code(404).send({ error: 'Not found' });
    const p = path.join(UPLOAD_DIR, f.name);
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Missing on disk' });
    return reply.type(f.mime_type)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(f.original_name)}"`)
      .send(createReadStream(p));
  });

  // Delete
  app.delete('/api/files/:id', { preHandler: [auth] }, async (req, reply) => {
    const f = get('SELECT * FROM files WHERE id = ?', [req.params.id]);
    if (!f) return reply.code(404).send({ error: 'Not found' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin' && f.uploader_id !== req.user.id) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const p = path.join(UPLOAD_DIR, f.name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    run('DELETE FROM files WHERE id = ?', [req.params.id]);
    app.hub.broadcast('file:delete', { fileId: req.params.id });
    return { ok: true };
  });
}

function mapFile(f) {
  return {
    id: f.id, name: f.original_name, storedName: f.name,
    mimeType: f.mime_type, size: f.size,
    uploaderId: f.uploader_id,
    uploader: { id: f.uploader_id, name: f.uploader_name, avatarColor: f.uploader_color },
    projectId: f.project_id, createdAt: f.created_at
  };
}

function sanitize(name) {
  return (name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120);
}
