import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBm25Index, searchBm25 } from '../src/lib/bm25.js';

const docs = [
  { slug: 'a', tokens: ['하나님', '은혜', '사랑', '예배'] },
  { slug: 'b', tokens: ['하나님', '심방', '성도', '기도'] },
  { slug: 'c', tokens: ['재정', '보고', '예산', '결산'] },
];

test('searchBm25: 질의 토큰을 많이 가진 문서가 상위', () => {
  const idx = buildBm25Index(docs);
  const ranked = searchBm25(idx, ['하나님', '은혜'], 10);
  assert.equal(ranked[0].slug, 'a'); // 하나님+은혜 둘 다
  assert.ok(ranked.some((r) => r.slug === 'b')); // 하나님만
  assert.ok(!ranked.some((r) => r.slug === 'c')); // 매칭 없음 → 제외
});

test('searchBm25: 희귀어가 흔한 어보다 높은 IDF 가중', () => {
  const idx = buildBm25Index(docs);
  // '하나님'은 2개 문서에 등장(흔함), '재정'은 1개(희귀)
  assert.ok(idx.idf['재정'] > idx.idf['하나님']);
});

test('searchBm25: 빈 질의/무매칭은 빈 배열', () => {
  const idx = buildBm25Index(docs);
  assert.deepEqual(searchBm25(idx, []), []);
  assert.deepEqual(searchBm25(idx, ['존재하지않는토큰']), []);
});

test('searchBm25: 결정론 — 동일 입력 동일 순서', () => {
  const idx = buildBm25Index(docs);
  const r1 = searchBm25(idx, ['하나님']);
  const r2 = searchBm25(idx, ['하나님']);
  assert.deepEqual(r1.map((x) => x.slug), r2.map((x) => x.slug));
});

test('searchBm25: 동점은 slug 오름차순 (삽입 역순이어도)', () => {
  // 동일 토큰/길이라 스코어가 정확히 동점 — 삽입은 z가 먼저지만 결과는 a가 앞이어야 함
  const idx = buildBm25Index([
    { slug: 'z', tokens: ['solo'] },
    { slug: 'a', tokens: ['solo'] },
  ]);
  assert.deepEqual(searchBm25(idx, ['solo']).map((x) => x.slug), ['a', 'z']);
});

test('searchBm25: postings 없는 손상 인덱스는 빈 배열(크래시 없음)', () => {
  assert.deepEqual(searchBm25({ N: 3 }, ['x']), []);
  assert.deepEqual(searchBm25({ N: 3, postings: null, idf: {}, docLen: {} }, ['x']), []);
});
