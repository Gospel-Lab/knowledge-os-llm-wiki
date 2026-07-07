import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCache } from '../src/lib/cache.js';
import { extractFolder } from '../src/lib/extractor.js';

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

test('extractFolder: 캐시 히트 시 재파싱하지 않는다 (센티넬로 증명)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.md'), '# 제목\n본문 내용');
    const cache = createCache(path.join(dir, '.cache.json'));
    const first = await extractFolder(dir, { cache });
    assert.equal(first.length, 1);
    assert.ok(first[0].result.body.includes('본문 내용'));
    cache.save();

    const key = `extract:${path.join(dir, 'a.md')}`;
    const cached = cache.get(key);
    assert.ok(cached, 'expected extraction to be cached');
    // 캐시된 값을 센티넬로 조작 — 히트 시 이 값이 그대로 반환되어야 함(재파싱이면 원문이 나옴)
    cache.set(key, { sig: cached.sig, result: { ...cached.result, body: '__SENTINEL__' } });
    cache.save();

    const cache2 = createCache(path.join(dir, '.cache.json'));
    const second = await extractFolder(dir, { cache: cache2 });
    assert.equal(second[0].result.body, '__SENTINEL__');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
