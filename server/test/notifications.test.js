import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleNotifications } from '../src/routes/notifications.js';

const row = (id, payload) => ({ id, type: 'task:update', payload: typeof payload === 'string' ? payload : JSON.stringify(payload), read_at: null, created_at: 1 });

test('persisted notifications are filtered by current project access and ambiguous records fail closed', () => {
  const rows = [
    row('allowed', { projectId: 'member-project', title: 'Visible' }),
    row('revoked', { projectId: 'revoked-project', title: 'Secret' }),
    row('workspace', { scope: 'workspace', title: 'General' }),
    row('legacy', { title: 'Unscoped historical record' }),
    row('bad-project', { scope: 'workspace', projectId: 42 }),
    row('invalid', '{malformed'),
  ];
  const accessible = (_, id) => id === 'member-project';
  assert.deepEqual(visibleNotifications(rows, { id: 'member' }, accessible).map(n => n.id), ['allowed', 'workspace']);
  assert.deepEqual(visibleNotifications(rows, { id: 'member' }, () => false).map(n => n.id), ['workspace']);
  assert.equal(visibleNotifications(Array.from({ length: 101 }, (_, i) => row(String(i), { scope: 'workspace' })), {}, accessible).length, 100);
});
