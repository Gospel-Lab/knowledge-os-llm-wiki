// 순수 JS BM25 — 새 의존성 없이 TF·IDF·길이정규화로 문서를 스코어링한다.
export function buildBm25Index(docs) {
  const postings = {};
  const docLen = {};
  const df = {};
  let totalLen = 0;
  for (const { slug, tokens } of docs) {
    docLen[slug] = tokens.length;
    totalLen += tokens.length;
    const seen = new Set();
    for (const t of tokens) {
      if (!postings[t]) postings[t] = {};
      postings[t][slug] = (postings[t][slug] || 0) + 1;
      if (!seen.has(t)) { df[t] = (df[t] || 0) + 1; seen.add(t); }
    }
  }
  const N = docs.length;
  const avgdl = N ? totalLen / N : 0;
  const idf = {};
  for (const term of Object.keys(df)) {
    // BM25 IDF (양수 보장 변형)
    idf[term] = Math.log(1 + (N - df[term] + 0.5) / (df[term] + 0.5));
  }
  return { N, avgdl, docLen, postings, idf };
}

export function searchBm25(index, queryTokens, k = 10, { k1 = 1.5, b = 0.75 } = {}) {
  if (!queryTokens || !queryTokens.length || !index.N) return [];
  const scores = {};
  for (const term of queryTokens) {
    const posting = index.postings[term];
    if (!posting) continue;
    const idf = index.idf[term] || 0;
    for (const slug of Object.keys(posting)) {
      const tf = posting[slug];
      const dl = index.docLen[slug] || 0;
      const denom = tf + k1 * (1 - b + (b * dl) / (index.avgdl || 1));
      scores[slug] = (scores[slug] || 0) + idf * ((tf * (k1 + 1)) / (denom || 1));
    }
  }
  return Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b2) => (b2[1] - a[1]) || (a[0] < b2[0] ? -1 : a[0] > b2[0] ? 1 : 0))
    .slice(0, k)
    .map(([slug, score]) => ({ slug, score }));
}
