export function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

// 결정론적 LCG (재현성 위해 Math.random 대신 사용)
function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function meanVector(members, dim) {
  const out = new Array(dim).fill(0);
  for (const v of members) for (let i = 0; i < dim; i++) out[i] += v[i];
  if (members.length) for (let i = 0; i < dim; i++) out[i] /= members.length;
  return out;
}

// 제곱 유클리드 거리 (k-means 내부용 — cosineSim은 각도 기반이라
// [0,0] 근처 저노름 벡터에서 분모가 0이 되어 공간적 분리를 표현 못함)
function sqDist(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

export function seededKmeans(vectors, k, { iters = 25, seed = 1 } = {}) {
  const n = vectors.length;
  if (n === 0) return [];
  const kk = Math.max(1, Math.min(k, n));
  const dim = vectors[0].length;
  const rand = lcg(seed);
  // k-means++ 유사 초기화 (시드 고정, 제곱 유클리드 거리 기반)
  const centroids = [];
  const firstIdx = Math.floor(rand() * n);
  centroids.push(vectors[firstIdx].slice());
  while (centroids.length < kk) {
    const dists = vectors.map((v) => {
      let best = Infinity;
      for (const c of centroids) best = Math.min(best, sqDist(v, c));
      return best;
    });
    const total = dists.reduce((a, b) => a + b, 0) || 1;
    let r = rand() * total, idx = 0;
    for (let i = 0; i < n; i++) { r -= dists[i]; if (r <= 0) { idx = i; break; } idx = i; }
    centroids.push(vectors[idx].slice());
  }
  let assign = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestDist = Infinity;
      for (let c = 0; c < kk; c++) {
        const d = sqDist(vectors[i], centroids[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    for (let c = 0; c < kk; c++) {
      const members = vectors.filter((_, i) => assign[i] === c);
      if (members.length) centroids[c] = meanVector(members, dim);
    }
    if (!changed) break;
  }
  return assign;
}
