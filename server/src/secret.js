import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db/index.js';

// Never ship a shared signing key. Persist a unique key per installation unless
// the operator supplies one, so sessions remain valid across restarts.
export function loadJwtSecret() {
  const configured = process.env.NEXA_JWT_SECRET;
  if (configured !== undefined) {
    if (configured.length < 32) throw new Error('NEXA_JWT_SECRET must be at least 32 characters');
    return configured;
  }
  const secretFile = path.join(DATA_DIR, 'jwt-secret');
  if (!fs.existsSync(secretFile)) {
    try {
      fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  const secret = fs.readFileSync(secretFile, 'utf8').trim();
  if (secret.length < 32) throw new Error('The persisted JWT secret is invalid');
  return secret;
}
