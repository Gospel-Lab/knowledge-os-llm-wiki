import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../src/lib/concurrency.js';

test('mapWithConcurrency: 순서 보존', async () => {
  const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
  assert.deepEqual(out, [10, 20, 30, 40]);
});

test('mapWithConcurrency: 동시 실행이 limit을 넘지 않는다', async () => {
  let active = 0, peak = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  });
  assert.ok(peak <= 2, `peak=${peak}`);
});

test('mapWithConcurrency: limit>=items 여도 동작', async () => {
  assert.deepEqual(await mapWithConcurrency([1, 2], 10, async (n) => n), [1, 2]);
});
