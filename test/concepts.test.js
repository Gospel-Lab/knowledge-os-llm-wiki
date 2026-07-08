import test from 'node:test';
import assert from 'node:assert/strict';
import { extractConceptsTfIdf, extractConceptsEmbedding } from '../src/lib/concepts.js';

const docs = [
  { slug: 'a', keywords: ['하나님', '은혜', '예배'] },
  { slug: 'b', keywords: ['하나님', '은혜', '기도'] },
  { slug: 'c', keywords: ['재정', '예산', '결산'] },
  { slug: 'd', keywords: ['재정', '예산', '보고'] },
];

test('extractConceptsTfIdf: 2개 이상 문서 공유 키워드가 개념', () => {
  const concepts = extractConceptsTfIdf(docs, { maxConcepts: 10 });
  const titles = concepts.map((c) => c.title);
  assert.ok(titles.includes('하나님'));  // a,b 공유
  assert.ok(titles.includes('재정'));    // c,d 공유
  const god = concepts.find((c) => c.title === '하나님');
  assert.deepEqual(god.relatedSlugs.sort(), ['a', 'b']);
});

test('extractConceptsTfIdf: maxConcepts 상한 적용', () => {
  const concepts = extractConceptsTfIdf(docs, { maxConcepts: 1 });
  assert.equal(concepts.length, 1);
});

test('extractConceptsEmbedding: 군집이 개념이 되고 지배 키워드로 라벨링', () => {
  // a,b 가깝고 c,d 가까운 2군집 벡터
  const vectors = [[1, 0], [0.9, 0.1], [0, 1], [0.1, 0.9]];
  const concepts = extractConceptsEmbedding(docs, vectors, { maxConcepts: 2 });
  assert.equal(concepts.length, 2);
  // 각 개념의 relatedSlugs가 실제 군집(같은 쪽 문서)들이어야 함
  const bySize = concepts.map((c) => c.relatedSlugs.sort().join(','));
  assert.ok(bySize.includes('a,b'));
  assert.ok(bySize.includes('c,d'));
  // 라벨은 군집 지배 키워드
  const abConcept = concepts.find((c) => c.relatedSlugs.includes('a'));
  assert.ok(['하나님', '은혜'].includes(abConcept.title));
});

test('extractConceptsEmbedding: L2 정규화로 크기가 달라도 방향이 같으면 같은 군집', () => {
  // 0,1은 같은 방향(x축), 2,3은 같은 방향(y축)이지만 크기가 크게 다름.
  // seededKmeans는 제곱유클리드 거리를 쓰므로, 정규화 없이는 크기 차이 때문에
  // 0(=[1,0])과 1(=[100,0])이 서로 다른 군집으로 갈릴 수 있다.
  // extractConceptsEmbedding 내부에서 L2 정규화를 거쳐야 방향 기준으로 군집화된다.
  const scaleDocs = [
    { slug: 'p0', keywords: ['x축'] },
    { slug: 'p1', keywords: ['x축'] },
    { slug: 'p2', keywords: ['y축'] },
    { slug: 'p3', keywords: ['y축'] },
  ];
  const vectors = [[1, 0], [100, 0], [0, 1], [0, 100]];
  const concepts = extractConceptsEmbedding(scaleDocs, vectors, { maxConcepts: 2 });
  assert.equal(concepts.length, 2);
  const bySize = concepts.map((c) => c.relatedSlugs.sort().join(','));
  assert.ok(bySize.includes('p0,p1'));
  assert.ok(bySize.includes('p2,p3'));
});
