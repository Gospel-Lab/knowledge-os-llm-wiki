import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCache } from '../src/lib/cache.js';

test('createCache: set/get/save 후 재로드 시 값 유지', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'));
  try {
    const c1 = createCache(path.join(dir, 'ai-cache.json'));
    assert.equal(c1.get('k'), undefined);
    c1.set('k', { summary: 's' });
    c1.save();
    const c2 = createCache(path.join(dir, 'ai-cache.json'));
    assert.deepEqual(c2.get('k'), { summary: 's' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createCache: 손상된 JSON은 빈 캐시로 시작', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'));
  try {
    const file = path.join(dir, 'x.json');
    fs.writeFileSync(file, '{ not json');
    const c = createCache(file);
    assert.equal(c.get('anything'), undefined);
    c.set('a', 1); c.save();
    assert.equal(createCache(file).get('a'), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
