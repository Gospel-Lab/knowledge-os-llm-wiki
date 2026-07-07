import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSim, seededKmeans } from '../src/lib/cluster.js';

test('cosineSim: 동일 방향 1, 직교 0', () => {
  assert.ok(Math.abs(cosineSim([1, 0], [2, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosineSim([1, 0], [0, 1])) < 1e-9);
});

test('seededKmeans: 명확히 분리된 두 군집을 나눈다', () => {
  const vecs = [[0, 0], [0.1, 0], [10, 10], [10.1, 10]];
  const asn = seededKmeans(vecs, 2, { seed: 1 });
  assert.equal(asn[0], asn[1]);      // 앞 둘 같은 군집
  assert.equal(asn[2], asn[3]);      // 뒤 둘 같은 군집
  assert.notEqual(asn[0], asn[2]);   // 서로 다른 군집
});

test('seededKmeans: 결정론 — 동일 시드 동일 결과', () => {
  const vecs = [[0, 0], [1, 1], [5, 5], [6, 6], [0, 1]];
  assert.deepEqual(seededKmeans(vecs, 2, { seed: 7 }), seededKmeans(vecs, 2, { seed: 7 }));
});

test('seededKmeans: k > 벡터수는 클램프', () => {
  const asn = seededKmeans([[1, 1], [2, 2]], 5, { seed: 1 });
  assert.equal(asn.length, 2);
});
