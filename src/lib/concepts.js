import { seededKmeans } from './cluster.js';

function unique(items) { return [...new Set(items.filter(Boolean))]; }

// seededKmeans는 제곱 유클리드 거리를 사용한다. 이는 L2 정규화된 벡터에서만
// 코사인 유사도 기반 군집화와 동치가 된다. Ollama bge-m3 임베딩은 정규화가
// 보장되지 않으므로, 군집화 전에 각 벡터를 단위벡터로 정규화한다.
function l2normalize(v) {
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n ? v.map((x) => x / n) : v.slice();
}

// 기존 wiki-builder의 TF-IDF 빈도 기반 개념 추출을 이관.
export function extractConceptsTfIdf(docs, { maxConcepts }) {
  const freq = new Map();
  for (const doc of docs) unique(doc.keywords).forEach((kw) => freq.set(kw, (freq.get(kw) || 0) + 1));
  const names = [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, maxConcepts)
    .map(([kw]) => kw);
  return names.map((title) => ({
    title,
    relatedSlugs: docs.filter((d) => d.keywords.includes(title)).map((d) => d.slug),
  }));
}

// 문서 임베딩 군집화 → 각 군집을 지배 키워드로 라벨링.
export function extractConceptsEmbedding(docs, vectors, { maxConcepts }) {
  if (!docs.length || !vectors.length) return [];
  const normalized = vectors.map((v) => l2normalize(v));
  const assign = seededKmeans(normalized, maxConcepts, { seed: 1 });
  const clusters = new Map();
  assign.forEach((c, i) => {
    if (!clusters.has(c)) clusters.set(c, []);
    clusters.get(c).push(docs[i]);
  });
  const concepts = [];
  // 결정론: 군집 인덱스 순서로 처리
  for (const c of [...clusters.keys()].sort((a, b) => a - b)) {
    const members = clusters.get(c);
    if (!members.length) continue;
    // 지배 키워드: 군집 내 최빈 키워드(동점은 사전순)
    const kwFreq = new Map();
    for (const m of members) unique(m.keywords).forEach((kw) => kwFreq.set(kw, (kwFreq.get(kw) || 0) + 1));
    const top = [...kwFreq.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0];
    if (!top) continue;
    concepts.push({ title: top[0], relatedSlugs: members.map((m) => m.slug) });
  }
  return concepts;
}
