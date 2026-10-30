// Defaults are inserted on every startup without overwriting customized roles.
export const DEFAULT_ROLES = [
  { name: 'owner', permissions: ['*'] },
  { name: 'admin', permissions: ['*'] },
  { name: 'manager', permissions: ['projects.write', 'tasks.write', 'chat.write', 'files.write', 'members.manage'] },
  { name: 'employee', permissions: ['projects.read', 'tasks.write', 'chat.write', 'files.write'] },
  { name: 'viewer', permissions: ['projects.read', 'chat.read'] },
];
