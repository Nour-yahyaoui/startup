import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

// Exercise both plugin code paths while its glob dependency is overridden.
for (const wildcard of [true, false]) {
  test(`static files work with wildcard ${wildcard}`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nexa-static-'));
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'index.html'), '<h1>Nexa</h1>');
    writeFileSync(path.join(root, 'assets', 'app.css'), 'body { color: red; }');
    const app = Fastify();
    try {
      await app.register(fastifyStatic, { root, wildcard, index: ['index.html'] });
      const index = await app.inject({ method: 'GET', url: '/' });
      assert.equal(index.statusCode, 200);
      assert.equal(index.body, '<h1>Nexa</h1>');
      const asset = await app.inject({ method: 'GET', url: '/assets/app.css' });
      assert.equal(asset.statusCode, 200);
      assert.equal(asset.body, 'body { color: red; }');
      assert.equal((await app.inject({ method: 'GET', url: '/missing.css' })).statusCode, 404);
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
