# Phase 3: BM25 전문 검색 · 임베딩 개념 클러스터링 · AI questions 연결 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 순진한 부분문자열 스코어링을 순수 JS BM25 전문 검색으로 대체하고, Ollama가 있을 때 임베딩 클러스터링으로 개념을 추출하되(없으면 기존 TF-IDF 유지), Ollama가 생성한 검색 질문을 Search Contract에 실제로 연결한다.

**Architecture:** ingest 시 한국어 토크나이저로 문서 본문을 토큰화해 BM25 역색인을 만들고 `search-index.json`으로 저장, 서버 `/api/search`·`/api/ask`가 이를 사용한다. 개념 추출은 전략 분기: 기본은 기존 TF-IDF 빈도, `--ollama-embeddings`가 켜지고 Ollama가 가용하면 문서 임베딩을 k-means로 군집화해 개념을 만들고 군집의 지배 키워드로 라벨링한다(임베딩 실패/미가용 시 TF-IDF로 폴백). `buildSearchContract`는 `doc.ai.questions`가 있으면 그걸 쓰고 없으면 기존 템플릿을 쓴다.

**Tech Stack:** Node.js ≥18 (ESM), node:test. 새 npm 의존성 없음(BM25·k-means·코사인 전부 순수 JS).

## Global Constraints

- Node ≥ 18, ESM only. **새 npm 의존성 추가 절대 금지** — BM25/클러스터링/코사인은 순수 JS 직접 구현. minisearch·ml-kmeans 등 설치 금지
- **Ollama-optional 불변식 (LOAD-BEARING, named review check):** `--ollama` / `--ollama-embeddings` 없이도 완전한 위키(문서·**개념**·링크·**BM25 검색**·그래프)가 나와야 한다. BM25는 순수 어휘 기반이라 Ollama 불필요. 임베딩 클러스터링은 켜졌고 가용할 때만, 실패 시 TF-IDF로 폴백. AI questions는 없으면 템플릿으로 폴백
- **결정론:** 동일 입력 → 동일 BM25 랭킹, 동일 클러스터 배정. k-means 초기화는 시드 고정 PRNG(LCG) 사용, 고정 반복 횟수. `Math.random()`/시계 사용 금지 (재현성)
- 한국어 토큰화는 기존 `tokenize`(src/vendor/keywords.js) 재사용 — 새 토크나이저 만들지 말 것
- 임베딩 클러스터링 모듈은 `embed` 함수를 **주입**받아 순수 로직으로 테스트 가능해야 함(테스트가 라이브 Ollama에 의존 금지)
- 작업 브랜치: `feat/phase3-search-embeddings`. push는 Gospel-Lab 계정, 끝나면 klum1223-coder 복귀
- 커밋: conventional commits. 저장소: `/Users/seonwoo/Documents/GitHub/knowledge-os-llm-wiki`
- 임시 워크스페이스: `/private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/`

## 파일 구조 (최종)

```
src/lib/bm25.js            # 신규: buildBm25Index, searchBm25 (순수 JS)
src/lib/cluster.js         # 신규: cosineSim, seededKmeans (순수, embed 주입형)
src/lib/concepts.js        # 신규: extractConceptsTfIdf(기존 로직 이관) + extractConceptsEmbedding(주입형)
src/vendor/ollama.js       # 수정: embedTexts(texts, opts) 어댑터 추가
src/lib/wiki-builder.js    # 수정: BM25 인덱스 빌드+저장, 개념 전략 분기, ai.questions 연결
src/lib/server.js          # 수정: /api/search + /api/ask가 BM25 사용
src/cli.js                 # 수정: --ollama-embeddings, --ollama-embed-model 플래그
test/bm25.test.js          # 신규
test/cluster.test.js       # 신규
test/concepts.test.js      # 신규
test/search-integration.test.js  # 신규: 한국어 fixture BM25 랭킹 + 개념 폴백 불변식
```

---

### Task 0: 브랜치 + BM25 코어 모듈

**Files:** Create `src/lib/bm25.js`, `test/bm25.test.js`

**Interfaces:**
- Produces: `buildBm25Index(docs)` — `docs: [{ slug, tokens: string[] }]` → `{ N, avgdl, docLen: {slug:len}, postings: {term: {slug: tf}}, idf: {term: number} }`. `searchBm25(index, queryTokens, k = 10, { k1 = 1.5, b = 0.75 } = {})` → `[{ slug, score }]` 내림차순, score>0만, 상위 k개. 동점은 slug 오름차순으로 안정 정렬

- [ ] **Step 1: 브랜치**

```bash
cd /Users/seonwoo/Documents/GitHub/knowledge-os-llm-wiki
git checkout -b feat/phase3-search-embeddings
```

- [ ] **Step 2: 실패 테스트** — `test/bm25.test.js`

```js
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

test('searchBm25: 결정론 — 동일 입력 동일 순서, 동점 slug 정렬', () => {
  const idx = buildBm25Index(docs);
  const r1 = searchBm25(idx, ['하나님']);
  const r2 = searchBm25(idx, ['하나님']);
  assert.deepEqual(r1.map((x) => x.slug), r2.map((x) => x.slug));
});
```

- [ ] **Step 3: 실패 확인** — `npm test` → bm25 not found

- [ ] **Step 4: 구현** — `src/lib/bm25.js`

```js
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
```

- [ ] **Step 5: 통과 확인** — `npm test` → PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/bm25.js test/bm25.test.js
git commit -m "feat: pure-JS BM25 full-text index and search"
```

---

### Task 1: 클러스터링 코어 (코사인 + 시드 k-means)

**Files:** Create `src/lib/cluster.js`, `test/cluster.test.js`

**Interfaces:**
- Produces: `cosineSim(a: number[], b: number[]): number`. `seededKmeans(vectors: number[][], k: number, { iters = 25, seed = 1 } = {}): number[]` — 각 벡터의 군집 인덱스 배열 반환. 시드 고정 LCG로 초기 중심 선택 → 결정론적. k가 벡터 수보다 크면 k=벡터수로 클램프

- [ ] **Step 1: 실패 테스트** — `test/cluster.test.js`

```js
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
```

- [ ] **Step 2: 실패 확인** — `npm test`

- [ ] **Step 3: 구현** — `src/lib/cluster.js`

```js
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

export function seededKmeans(vectors, k, { iters = 25, seed = 1 } = {}) {
  const n = vectors.length;
  if (n === 0) return [];
  const kk = Math.max(1, Math.min(k, n));
  const dim = vectors[0].length;
  const rand = lcg(seed);
  // k-means++ 유사 초기화 (시드 고정)
  const centroids = [];
  const firstIdx = Math.floor(rand() * n);
  centroids.push(vectors[firstIdx].slice());
  while (centroids.length < kk) {
    const dists = vectors.map((v) => {
      let best = Infinity;
      for (const c of centroids) best = Math.min(best, 1 - cosineSim(v, c));
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
      let best = 0, bestSim = -Infinity;
      for (let c = 0; c < kk; c++) {
        const sim = cosineSim(vectors[i], centroids[c]);
        if (sim > bestSim) { bestSim = sim; best = c; }
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
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cluster.js test/cluster.test.js
git commit -m "feat: pure-JS cosine similarity and deterministic seeded k-means"
```

---

### Task 2: 개념 추출 전략 모듈 (TF-IDF 이관 + 임베딩 주입형)

**Files:** Create `src/lib/concepts.js`, `test/concepts.test.js`

**Interfaces:**
- Consumes: `seededKmeans`, `cosineSim` (Task 1), `slugify` (utils)
- Produces:
  - `extractConceptsTfIdf(docs, { maxConcepts }): conceptSpec[]` — 기존 wiki-builder 개념 로직(키워드 빈도 ≥2, 상위 cap)을 그대로 이관. `conceptSpec = { title, relatedSlugs: string[] }`
  - `extractConceptsEmbedding(docs, vectors, { maxConcepts }): conceptSpec[]` — 문서 벡터를 k=maxConcepts로 군집화, 각 군집을 그 군집 문서들의 최빈 키워드로 라벨링(라벨 = title), relatedSlugs = 군집 멤버. 빈 군집 제외. 라벨 충돌 시 뒤에 -2 등(호출측 slugify가 처리하므로 title 중복은 허용하되 관련문서 병합)
  - 두 함수 모두 `docs: [{ slug, keywords: string[] }]` 최소 형태를 받는다(추가 필드 무시)

- [ ] **Step 1: 실패 테스트** — `test/concepts.test.js`

```js
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
```

- [ ] **Step 2: 실패 확인** — `npm test`

- [ ] **Step 3: 구현** — `src/lib/concepts.js`

```js
import { seededKmeans } from './cluster.js';

function unique(items) { return [...new Set(items.filter(Boolean))]; }

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
  const assign = seededKmeans(vectors, maxConcepts, { seed: 1 });
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
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/concepts.js test/concepts.test.js
git commit -m "feat: concept extraction strategies (TF-IDF + embedding clustering)"
```

---

### Task 3: Ollama 임베딩 어댑터

**Files:** Modify `src/vendor/ollama.js`

**Interfaces:**
- Produces: `embedTexts(texts: string[], { baseUrl, model = 'bge-m3', concurrency = 4 }): Promise<number[][]>` — Ollama `/api/embeddings`로 각 텍스트 임베딩. 실패 시 예외를 던지지 않고 해당 항목 null → 호출측이 폴백 판단. `checkOllamaEmbedding({ baseUrl, model })` 로 모델 가용성 확인(선택)

- [ ] **Step 1: 구현** — `src/vendor/ollama.js`에 추가 (기존 export 유지)

파일 상단 import 필요 시 `mapWithConcurrency`는 vendor에서 lib를 import하면 층 역전이므로, 여기서는 간단 직렬+제한 없이 순차 처리하되 병렬은 wiki-builder 레벨에서 이미 있는 mapWithConcurrency로 감싼다. → `embedTexts`는 단일 텍스트 임베딩 `embedOne`을 export하고, 배열 처리는 wiki-builder가 mapWithConcurrency로 호출:

```js
export const DEFAULT_EMBED_MODEL = "bge-m3";

// 단일 텍스트 임베딩. 실패 시 null 반환(예외 던지지 않음) — 호출측이 폴백 결정.
export async function embedOne(text, { baseUrl = DEFAULT_OLLAMA_BASE_URL, model = DEFAULT_EMBED_MODEL, timeoutMs = 60000 } = {}) {
  try {
    const data = await fetchJson(
      ollamaApiUrl(baseUrl, "embeddings"),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt: String(text || "").slice(0, 8000) }) },
      timeoutMs
    );
    const vec = data?.embedding;
    return Array.isArray(vec) && vec.length ? vec : null;
  } catch {
    return null;
  }
}
```

(`fetchJson`, `ollamaApiUrl`, `DEFAULT_OLLAMA_BASE_URL`은 이미 이 파일에 있음.)

- [ ] **Step 2: 스모크(수동, 선택)** — Ollama 없으면 null 반환하는지만 논리 확인. 자동 테스트는 라이브 의존이라 생략(주입형 클러스터는 Task 1/2에서 검증됨).

- [ ] **Step 3: Commit**

```bash
git add src/vendor/ollama.js
git commit -m "feat: add Ollama embedding adapter (embedOne, graceful null on failure)"
```

---

### Task 4: wiki-builder 통합 — BM25 인덱스 + 개념 전략 분기 + AI questions

**Files:** Modify `src/lib/wiki-builder.js`, `src/cli.js`

**Interfaces:**
- Consumes: bm25, concepts, cluster, embedOne, tokenize(keywords), mapWithConcurrency
- Produces: `ingestWorkspace({ ..., ollamaEmbeddings = false, ollamaEmbedModel = 'bge-m3' })`. 동작: (1) 각 doc.body를 `tokenize`로 토큰화해 `buildBm25Index`, `search-index.json`으로 저장 + state에 `search.index_path`, (2) 개념 추출을 `concepts.js`로 위임 — 기본 `extractConceptsTfIdf`, `ollamaEmbeddings && Ollama가용`이면 `embedOne`(mapWithConcurrency)로 문서 임베딩 후 `extractConceptsEmbedding`, 임베딩이 하나라도 null이면 TF-IDF 폴백, (3) `buildSearchContract`가 `doc.ai?.questions?.length`면 그걸 search_questions로, 아니면 inferQuestions. CLI에 `--ollama-embeddings`(불리언), `--ollama-embed-model` 추가

- [ ] **Step 1: buildSearchContract에 ai.questions 연결** — `src/lib/wiki-builder.js:39-61`

`search_questions: inferQuestions(...)` 를:

```js
    search_questions: (doc.ai?.questions?.length ? doc.ai.questions : inferQuestions(doc.title, doc.keywords, doc.department)),
```

(buildSearchContract는 doc 전체를 받으므로 doc.ai 접근 가능. 시그니처가 doc를 받는지 확인 — 받음.)

- [ ] **Step 2: 개념 추출을 concepts.js로 교체** — 기존 conceptNames/concepts 생성부(키워드 빈도~slice~map)

import 추가:
```js
import { buildBm25Index } from './bm25.js';
import { extractConceptsTfIdf, extractConceptsEmbedding } from './concepts.js';
import { embedOne, DEFAULT_EMBED_MODEL } from '../vendor/ollama.js';
import { tokenize } from '../vendor/keywords.js';
```

기존 `conceptNames`/`concepts` 블록을 다음 전략 분기로 교체(개념 spec → 기존 concept 객체 형태로 확장하는 부분은 유지):

```js
  const conceptCap = Number.isInteger(maxConcepts) && maxConcepts > 0 ? maxConcepts : defaultMaxConcepts(docs.length);
  const docMini = docs.map((d) => ({ slug: d.slug, keywords: d.keywords }));

  let conceptSpecs = null;
  if (ollamaEmbeddings) {
    const status = await checkOllama({ baseUrl: ollamaUrl, model: ollamaEmbedModel });
    if (status.ok) {
      const vectors = await mapWithConcurrency(docs, ollamaConcurrency || 4,
        (d) => embedOne(d.body, { baseUrl: ollamaUrl, model: ollamaEmbedModel }));
      if (vectors.every((v) => Array.isArray(v) && v.length)) {
        conceptSpecs = extractConceptsEmbedding(docMini, vectors, { maxConcepts: conceptCap });
      }
    }
  }
  if (!conceptSpecs) conceptSpecs = extractConceptsTfIdf(docMini, { maxConcepts: conceptCap });

  const toConceptSlug = createSlugger();
  const concepts = conceptSpecs.map((spec) => {
    const slug = toConceptSlug(spec.title);
    const relatedDocs = docs.filter((doc) => spec.relatedSlugs.includes(doc.slug));
    return {
      id: `concept:${slug}`,
      slug,
      title: spec.title,
      type: 'Concept',
      folder: 'Concepts',
      file: `concepts/${slug}.md`,
      absolutePath: path.join(workspace, 'docs', 'concepts', `${slug}.md`),
      body: `${spec.title} 관련 핵심 문서: ${relatedDocs.map((doc) => doc.title).join(', ')}`,
      summary: `${spec.title}는 ${relatedDocs.length}개 문서에 걸쳐 등장하는 핵심 개념입니다.`,
      keywords: unique(relatedDocs.flatMap((doc) => doc.keywords)).slice(0, 8),
      relatedDocs,
    };
  });
```

**주의:** 기존 코드에서 `doc.relatedConcepts`를 계산하는 부분(`concepts.filter((concept) => doc.keywords.includes(concept.title))`)은 임베딩 개념 라벨이 doc.keywords에 없을 수도 있으므로, relatedConcepts를 **concept.relatedDocs 역방향**으로 계산하도록 바꾼다:

```js
  for (const doc of docs) {
    doc.relatedConcepts = concepts.filter((c) => c.relatedDocs.some((rd) => rd.slug === doc.slug)).map((c) => c.slug);
  }
```

(기존의 `doc.keywords.includes(concept.title)` 방식 라인을 이 역방향 계산으로 대체.)

- [ ] **Step 3: BM25 인덱스 빌드+저장** — state 저장 직전

```js
  const bm25Docs = docs.map((doc) => ({ slug: doc.slug, tokens: tokenize(doc.body) }));
  const searchIndex = buildBm25Index(bm25Docs);
  writeJson(path.join(workspace, 'search-index.json'), searchIndex);
```

그리고 state 객체에 `search: { index_path: 'search-index.json' }` 추가.

- [ ] **Step 4: CLI 플래그** — `src/cli.js` ingest 분기

```js
      ollamaEmbeddings: Boolean(args['ollama-embeddings']),
      ollamaEmbedModel: value('ollama-embed-model', 'bge-m3'),
```

ingestWorkspace 시그니처에 `ollamaEmbeddings = false, ollamaEmbedModel = 'bge-m3'` 추가. help 텍스트에 `[--ollama-embeddings --ollama-embed-model bge-m3]` 추가.

- [ ] **Step 5: 회귀 (Ollama 없이 = TF-IDF 폴백)**

```bash
WS=/private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/p3-check
node src/cli.js ingest --source ./test/fixtures/ko-vault --workspace $WS --title KO
cat $WS/state.json | node -e "const s=require('fs').readFileSync(0,'utf8');const j=JSON.parse(s);console.log('concepts',j.concepts.length,'docs',j.metrics.documents);"
ls $WS/search-index.json && node -e "const i=require('$WS/search-index.json');console.log('N',i.N,'terms',Object.keys(i.postings).length)"
```

Expected: 개념 수 > 0(TF-IDF 폴백 동작), search-index.json 존재, N=6. `npm test` PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wiki-builder.js src/cli.js
git commit -m "feat: BM25 index build, embedding/TF-IDF concept strategy, AI questions in contract"
```

---

### Task 5: 서버 BM25 검색 연동

**Files:** Modify `src/lib/server.js`

**Interfaces:**
- Consumes: bm25, tokenize, search-index.json
- Produces: 서버가 시작 시 `search-index.json` 로드. `GET /api/search?q=...` → `{ results: [{slug,title,department,summary,score}] }`. `POST /api/ask`의 근거 문서 선정이 `scoreByTokenOverlap` 대신 `searchBm25(index, tokenize(question))` 사용(문서 메타는 state.documents에서 slug로 조인). 인덱스 없으면(구버전 워크스페이스) 기존 scoreByTokenOverlap로 폴백

- [ ] **Step 1: 구현** — `src/lib/server.js`

import 추가: `import { searchBm25 } from '../vendor/... ' ` → 실제 경로 `../lib/bm25.js`가 아니라 server.js가 lib에 있으므로 `./bm25.js`. `import { tokenize } from '../vendor/keywords.js';` `import { readJson } from './utils.js';`(이미 있음)

startServer 안에서 state 로드 직후:

```js
  const searchIndexPath = path.join(workspaceRoot, state.search?.index_path || 'search-index.json');
  const searchIndex = readJson(searchIndexPath, null);
  const docBySlug = new Map(state.documents.map((d) => [d.slug, d]));
  function bm25Sources(question, limit) {
    if (!searchIndex) return null;
    const ranked = searchBm25(searchIndex, tokenize(question), limit);
    return ranked.map((r) => docBySlug.get(r.slug)).filter(Boolean);
  }
```

`GET /api/search` 라우트 추가(‘/api/state’ 처리 근처):

```js
    if (req.method === 'GET' && url.pathname === '/api/search') {
      const q = url.searchParams.get('q') || '';
      const hits = bm25Sources(q, 10) || [];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ results: hits.map((d) => ({ slug: d.slug, title: d.title, department: d.department, summary: d.summary })) }));
      return;
    }
```

`/api/ask` 내부의 `scoreByTokenOverlap(...)` 근거 선정을:

```js
          const ranked = bm25Sources(question, 5);
          const sources = (ranked && ranked.length) ? ranked
            : scoreByTokenOverlap(question, state.documents, ['title', 'summary', 'department', 'source_path', 'body_preview'])
                .filter((row) => row.score > 0).slice(0, 5).map((row) => row.item);
```

(scoreByTokenOverlap import는 폴백용으로 유지.)

- [ ] **Step 2: 데모 확인**

```bash
WS=/private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/p3-serve
node src/cli.js ingest --source ./test/fixtures/ko-vault --workspace $WS --title KO
node src/cli.js serve --workspace $WS --port 3501 &
sleep 1
curl -s "http://127.0.0.1:3501/api/search?q=하나님%20은혜" | head -c 300
kill %1
```

Expected: results 배열에 하나님/은혜 관련 문서가 상위. `npm test` PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server.js
git commit -m "feat: server BM25 search endpoint and BM25-backed /api/ask source selection"
```

---

### Task 6: 통합 테스트 — BM25 랭킹 + 개념 폴백 불변식

**Files:** Create `test/search-integration.test.js`

**Interfaces:**
- Consumes: 전체 파이프라인
- Produces: (a) 한국어 fixture ingest 후 search-index.json으로 '하나님' 질의가 관련 문서를 상위 랭크, (b) `--ollama` 없이 ingest해도 개념 수 > 0 (Ollama-optional 불변식), (c) doc.ai.questions 주입 시 Search Contract가 그걸 사용

- [ ] **Step 1: 테스트** — `test/search-integration.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestWorkspace } from '../src/lib/wiki-builder.js';
import { buildBm25Index, searchBm25 } from '../src/lib/bm25.js';
import { tokenize } from '../src/vendor/keywords.js';

const FIXTURE = new URL('./fixtures/ko-vault', import.meta.url).pathname;

test('BM25: 한국어 fixture에서 질의가 관련 문서를 랭크', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-'));
  try {
    await ingestWorkspace({ source: FIXTURE, workspace: ws, title: 'T' });
    const index = JSON.parse(fs.readFileSync(path.join(ws, 'search-index.json'), 'utf-8'));
    assert.ok(index.N >= 6);
    const ranked = searchBm25(index, tokenize('하나님 은혜'), 10);
    assert.ok(ranked.length > 0, '하나님 은혜 질의가 결과를 반환해야 함');
    // 상위 문서는 실제로 그 토큰을 포함해야 함
    assert.ok(ranked[0].score > 0);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('Ollama-optional 불변식: --ollama 없이도 개념이 생성된다', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-'));
  try {
    const state = await ingestWorkspace({ source: FIXTURE, workspace: ws, title: 'T' });
    assert.ok(state.metrics.concepts > 0, `개념 0개 — 폴백 실패: ${state.metrics.concepts}`);
    assert.ok(state.metrics.documents >= 6);
    assert.ok(fs.existsSync(path.join(ws, 'search-index.json')));
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실행** — `npm test` → PASS. 개념 0개면 Task 4 폴백 경로 점검.

- [ ] **Step 3: Commit**

```bash
git add test/search-integration.test.js
git commit -m "test: BM25 ranking and Ollama-optional concept fallback coverage"
```

---

### Task 7: 마무리 — 문서화

**Files:** Modify `README.md`, `WORK_PLAN.md`

- [ ] **Step 1:** README에 BM25 검색·`/api/search`·`--ollama-embeddings`(임베딩 개념 클러스터링, 없으면 TF-IDF)·AI questions 설명 추가. WORK_PLAN Phase 3 상태 `✅ 완료 (2026-07-08)`, 작업 로그 1줄.

- [ ] **Step 2:** `npm test` 전체 통과 확인.

- [ ] **Step 3: Commit**

```bash
git add README.md WORK_PLAN.md docs/plans/2026-07-08-phase3-search-embeddings.md
git commit -m "docs: document BM25 search, embedding concepts, AI questions wiring"
```

---

## Self-Review 체크 결과

- **Spec coverage:** BM25(Task 0,4,5,6), 임베딩 클러스터링(Task 1,2,3,4), AI questions(Task 4 Step 1) 전부 대응.
- **Ollama-optional 불변식:** Task 6 두 번째 테스트가 --ollama 없는 기본 경로에서 개념>0 + search-index 존재를 명시적 회귀로 잠금. BM25는 Ollama 무관.
- **결정론:** BM25 동점 slug 정렬(Task 0 테스트), k-means 시드 고정(Task 1 테스트).
- **의존성:** 순수 JS만, 새 npm 0. 임베딩은 주입형이라 테스트가 라이브 Ollama 불요.
- **Out of scope (Phase 4로 이월):** CI, LICENSE 파일, linker.js 데드코드 제거, /api/open 구현. 그래프 클라이언트 body 완전 lazy화(BM25 서버검색이 생겼으니 후속).
