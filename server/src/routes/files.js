import fs from 'node:fs';
import { nanoid } from 'nanoid';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { all, get, run } from '../db/index.js';
import { getAccessibleProject, hasPermission, isWorkspaceAdmin } from '../access.js';
import { removeStoredFile, storedFilePath } from '../storage.js';

export async function fileRoutes(app) {
  const auth = app.authenticate;
  const canWrite = app.requirePerm('files.write');
  const notFound = reply => reply.code(404).send({ error: 'File or project not found' });

  app.get('/api/files', { preHandler: [auth] }, async (req, reply) => {
    const { projectId } = req.query;
    if (projectId !== undefined && !getAccessibleProject(req.user, projectId)) return notFound(reply);
    const files = projectId !== undefined
      ? all(`SELECT f.*, u.name as uploader_name, u.avatar_color as uploader_color
             FROM files f JOIN users u ON u.id = f.uploader_id WHERE f.project_id = ?
             ORDER BY f.created_at DESC`, [projectId])
      : all(`SELECT f.*, u.name as uploader_name, u.avatar_color as uploader_color
             FROM files f JOIN users u ON u.id = f.uploader_id
             WHERE f.project_id IS NULL OR ? = 1 OR EXISTS (
               SELECT 1 FROM projects p WHERE p.id = f.project_id AND
               (p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?))
             ) ORDER BY f.created_at DESC LIMIT 200`,
        [isWorkspaceAdmin(req.user) ? 1 : 0, req.user.id, req.user.id]);
    return { files: files.map(mapFile) };
  });

  // Parse all parts, including fields after the file. The previous req.file()
  // approach could silently classify such project uploads as workspace-wide.
  app.post('/api/files', { preHandler: [auth, canWrite] }, async (req, reply) => {
    const queryProjectId = req.query.projectId;
    if (queryProjectId !== undefined && !getAccessibleProject(req.user, queryProjectId)) return notFound(reply);
    let fieldProjectId;
    let storedName;
    let fileInfo;
    let persisted = false;
    const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (fileInfo || part.fieldname !== 'file') throw fail('Provide exactly one file');
          const id = nanoid(12);
          storedName = id + '_' + sanitize(part.filename);
          fileInfo = { id, originalName: part.filename || 'file', mimeType: part.mimetype || 'application/octet-stream' };
          await pipeline(part.file, fs.createWriteStream(storedFilePath(storedName), { flags: 'wx', mode: 0o600 }));
          if (part.file.truncated) throw fail('File is too large', 413);
        } else if (part.fieldname === 'projectId') {
          if (fieldProjectId !== undefined || typeof part.value !== 'string' || !part.value.trim()) {
            throw fail('Invalid projectId');
          }
          fieldProjectId = part.value;
        } else {
          throw fail('Unexpected upload field');
        }
      }
      if (!fileInfo) throw fail('No file');
      if (queryProjectId !== undefined && fieldProjectId !== undefined && queryProjectId !== fieldProjectId) {
        throw fail('Conflicting projectId values');
      }
      const projectId = queryProjectId ?? fieldProjectId ?? null;
      // An upload may take minutes: recheck the current role and membership after streaming.
      const actor = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
      if (!actor || actor.session_version !== req.user.session_version || !hasPermission(actor, 'files.write')) throw fail('Forbidden', 403);
      if (projectId && !getAccessibleProject(actor, projectId)) throw fail('File or project not found', 404);
      const stat = fs.statSync(storedFilePath(storedName));
      run(`INSERT INTO files (id, name, original_name, mime_type, size, uploader_id, project_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [fileInfo.id, storedName, fileInfo.originalName, fileInfo.mimeType, stat.size, actor.id, projectId, Date.now()]);
      persisted = true;
      const row = get(`SELECT f.*, u.name as uploader_name, u.avatar_color as uploader_color
                       FROM files f JOIN users u ON u.id = f.uploader_id WHERE f.id = ?`, [fileInfo.id]);
      const file = mapFile(row);
      app.hub.emitFileUploaded(file, actor);
      return { file };
    } catch (error) {
      if (storedName && !persisted) {
        try { removeStoredFile(storedName); } catch (cleanupError) { req.log.error(cleanupError, 'Could not remove failed upload'); }
      }
      const status = error.code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : (error.statusCode || 500);
      if (status >= 500) req.log.error(error, 'Upload failed');
      return reply.code(status).send({ error: status >= 500 ? 'Upload failed' : error.message });
    }
  });

  app.get('/api/files/:id/download', { preHandler: [auth] }, async (req, reply) => {
    const file = get('SELECT * FROM files WHERE id = ?', [req.params.id]);
    if (!file || (file.project_id && !getAccessibleProject(req.user, file.project_id))) return notFound(reply);
    const filePath = storedFilePath(file.name);
    if (!fs.existsSync(filePath)) return notFound(reply);
    return reply.type(file.mime_type)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(filePath));
  });

  app.delete('/api/files/:id', { preHandler: [auth, canWrite] }, async (req, reply) => {
    const file = get('SELECT * FROM files WHERE id = ?', [req.params.id]);
    if (!file || (file.project_id && !getAccessibleProject(req.user, file.project_id))) return notFound(reply);
    if (!isWorkspaceAdmin(req.user) && file.uploader_id !== req.user.id) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    run('DELETE FROM files WHERE id = ?', [file.id]);
    try { removeStoredFile(file.name); } catch (error) { req.log.error(error, 'Could not remove deleted file'); }
    app.hub.emitFileDeleted(file);
    return { ok: true };
  });
}

function mapFile(f) {
  return {
    id: f.id, name: f.original_name, mimeType: f.mime_type, size: f.size,
    uploaderId: f.uploader_id,
    uploader: { id: f.uploader_id, name: f.uploader_name, avatarColor: f.uploader_color },
    projectId: f.project_id, createdAt: f.created_at
  };
}

function sanitize(name) {
  return (name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file';
}
