# Phase 2: 증분 ingest · 성능 · 오프라인(로컬 우선) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재-ingest를 수 초로 줄이고(증분·캐시·병렬), 그래프 HTML을 오프라인에서 완전히 동작하게 만들며(CDN 5종 벤더링), 대규모 코퍼스에서 그래프 HTML 크기 폭발(11MB@700문서)을 없앤다.

**Architecture:** 기존 파이프라인은 유지하되 `.llmwiki/` 아래 두 개의 캐시(추출 캐시, AI 캐시)와 매니페스트를 두어 콘텐츠 해시(node:crypto sha1)로 변경분만 재작업한다. Ollama 보강은 콘텐츠 해시 캐시 + 제한된 동시성(기본 4)으로 바꾼다. 그래프에 박히던 전체 본문은 상한(기본 2000자)으로 자르고, three.js 등 5개 CDN 라이브러리는 저장소에 벤더링해 ingest 시 `graph/vendor/`로 복사, render.js는 상대경로(`./vendor/...`)로 참조한다. Google Fonts는 시스템 폰트 스택으로 대체한다.

**Tech Stack:** Node.js ≥18 (ESM), node:crypto(sha1), node:test. 새 npm 의존성 없음.

## Global Constraints

- Node ≥ 18, ESM only (`"type": "module"`)
- **새 npm 의존성 추가 금지** (런타임/dev 모두). 해시는 `node:crypto`, 동시성은 순수 JS. 벤더링은 CDN 파일을 저장소에 복사(로컬 우선 철학의 실현이지 npm 의존성이 아님)
- 결정론: 동일 입력 → 동일 출력. `updated_at`은 콘텐츠가 바뀐 문서에서만 갱신(변경 없으면 이전 값 보존) — nowIso 무차별 갱신 금지
- Ollama는 **선택적**이어야 한다: `--ollama` 없이도 완전한 위키(문서·개념·링크·그래프)가 나와야 함. 이 불변식을 깨면 안 됨
- 벤더링된 라이브러리는 **정확히 기존 버전** 유지 (three@0.160.0, 3d-force-graph@1.73.4, marked@12.0.2, fuse.js@7.0.0, dompurify@3.1.6) — 업그레이드 아님, 동작 보존
- 그래프 HTML에는 외부 `http(s)://` 리소스 참조가 **하나도** 없어야 한다 (attribution 링크의 href는 예외 — 그건 fetch가 아니라 사용자 클릭용 앵커)
- 작업 브랜치: `feat/phase2-incremental-perf-offline` (main 직접 커밋 금지)
- push는 Gospel-Lab gh 계정 (`gh auth switch -u Gospel-Lab`), 끝나면 klum1223-coder로 복귀
- 커밋 메시지: conventional commits
- 저장소: `/Users/seonwoo/Documents/GitHub/knowledge-os-llm-wiki`
- 임시 워크스페이스 경로: `/private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/`

## 파일 구조 (최종)

```
src/vendor/assets/three.min.js            # 신규(벤더링): 5개 라이브러리 원본 복사본
src/vendor/assets/3d-force-graph.min.js
src/vendor/assets/marked.min.js
src/vendor/assets/fuse.min.js
src/vendor/assets/purify.min.js
src/vendor/assets/README.md               # 신규: 출처·버전·라이선스 명시
src/lib/hash.js                           # 신규: contentHash(text)
src/lib/cache.js                          # 신규: 추출/AI 캐시 read/write (.llmwiki 아래)
src/lib/concurrency.js                    # 신규: mapWithConcurrency(items, limit, fn)
src/lib/assets.js                         # 신규: copyVendorAssets(destDir), VENDOR_FILES
src/lib/extractor.js                      # 수정: 추출 캐시 사용
src/vendor/ollama.js                      # 수정: enrich 병렬 + 캐시 훅
src/lib/wiki-builder.js                   # 수정: 매니페스트/증분/orphan cleanup/본문 상한/asset 복사/AI 캐시
src/vendor/render.js                      # 수정: CDN→상대경로 벤더 참조, Google Fonts 제거
src/lib/server.js                         # 수정: /vendor/* 정적 서빙(워크스페이스 graph/vendor 우선)
test/hash.test.js                         # 신규
test/concurrency.test.js                  # 신규
test/cache.test.js                        # 신규
test/incremental.test.js                  # 신규: 재-ingest 증분/orphan 동작
test/offline.test.js                      # 신규: 그래프 HTML에 외부 URL 없음 + vendor 복사 확인
```

---

### Task 0: 브랜치 + 5개 CDN 라이브러리 벤더링 + 폰트 시스템화

**Files:**
- Create: `src/vendor/assets/{three.min.js,3d-force-graph.min.js,marked.min.js,fuse.min.js,purify.min.js,README.md}`
- Modify: `src/vendor/render.js` (HTML_HEAD_B의 CDN 블록만)

**Interfaces:**
- Produces: 저장소에 벤더링된 5개 자산 파일. render.js가 상대경로 `./vendor/<file>`로 스크립트를 로드하고 Google Fonts 링크가 사라진 상태

- [ ] **Step 1: 브랜치 생성**

```bash
cd /Users/seonwoo/Documents/GitHub/knowledge-os-llm-wiki
git checkout -b feat/phase2-incremental-perf-offline
```

- [ ] **Step 2: 5개 라이브러리 정확한 버전으로 다운로드**

```bash
mkdir -p src/vendor/assets
curl -sL --fail -o src/vendor/assets/three.min.js          "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"
curl -sL --fail -o src/vendor/assets/3d-force-graph.min.js "https://unpkg.com/3d-force-graph@1.73.4/dist/3d-force-graph.min.js"
curl -sL --fail -o src/vendor/assets/marked.min.js         "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"
curl -sL --fail -o src/vendor/assets/fuse.min.js           "https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js"
curl -sL --fail -o src/vendor/assets/purify.min.js         "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"
ls -la src/vendor/assets/
```

Expected: 5개 파일 모두 수십~수백 KB (0바이트면 실패 — 재시도). 각 파일 첫 바이트가 JS인지 `head -c 40` 로 확인(HTML 오류 페이지가 아님).

- [ ] **Step 3: assets/README.md 작성**

```markdown
# Vendored browser libraries

These are verbatim copies of MIT/Apache-2.0 licensed libraries, vendored so the
generated graph works fully offline (local-first). Do not edit; re-fetch from the
pinned versions if updating.

| File | Package | Version | License |
|------|---------|---------|---------|
| three.min.js | three | 0.160.0 | MIT |
| 3d-force-graph.min.js | 3d-force-graph | 1.73.4 | MIT |
| marked.min.js | marked | 12.0.2 | MIT |
| fuse.min.js | fuse.js | 7.0.0 | Apache-2.0 |
| purify.min.js | dompurify | 3.1.6 | (Apache-2.0 OR MPL-2.0) |
```

- [ ] **Step 4: render.js의 CDN 블록 교체** — `src/vendor/render.js` HTML_HEAD_B(29–46행 부근)

29–46행의 Google Fonts 3줄 + 5개 CDN `<script>`(integrity/crossorigin 포함) 전체를 다음으로 교체:

```
<script src="./vendor/three.min.js"></script>
<script src="./vendor/3d-force-graph.min.js"></script>
<script src="./vendor/marked.min.js"></script>
<script src="./vendor/fuse.min.js"></script>
<script src="./vendor/purify.min.js"></script>
```

(SRI integrity/crossorigin 속성은 로컬 상대경로엔 불필요하므로 제거. Google Fonts preconnect/stylesheet 3줄은 완전 삭제.)

- [ ] **Step 5: 폰트 스택을 시스템 폰트로** — `src/vendor/render.js:49`

`font-family: "Inter", "Noto Sans KR", "Segoe UI", sans-serif;` 를 다음으로 교체:

```
font-family: "Noto Sans KR", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
```

(Noto Sans KR가 시스템에 있으면 사용, 없으면 system-ui로 폴백 — 웹폰트 네트워크 요청 제거.)

- [ ] **Step 6: .gitignore가 assets를 무시하지 않는지 확인 후 커밋**

```bash
cat .gitignore
git add src/vendor/assets src/vendor/render.js
git commit -m "feat: vendor browser libraries and drop CDN/Google Fonts for offline-first"
```

주의: `.gitignore`에 `*.min.js`나 `assets` 패턴이 있으면 `git add -f`가 아니라 .gitignore를 수정(해당 패턴 예외 추가). 확인할 것.

---

### Task 1: 콘텐츠 해시 유틸 + 제한 동시성 유틸

**Files:**
- Create: `src/lib/hash.js`, `src/lib/concurrency.js`
- Test: `test/hash.test.js`, `test/concurrency.test.js`

**Interfaces:**
- Produces: `contentHash(text: string): string` (sha1 hex, 안정적), `mapWithConcurrency(items: T[], limit: number, fn: (item, index) => Promise<R>): Promise<R[]>` (입력 순서대로 결과 반환, 최대 limit개 동시 실행)

- [ ] **Step 1: 실패 테스트** — `test/hash.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHash } from '../src/lib/hash.js';

test('contentHash: 동일 입력 동일 해시, 다른 입력 다른 해시', () => {
  assert.equal(contentHash('hello'), contentHash('hello'));
  assert.notEqual(contentHash('hello'), contentHash('world'));
  assert.match(contentHash('x'), /^[0-9a-f]{40}$/);
});

test('contentHash: NFC/NFD 정규화 후 해시 (한국어 안정)', () => {
  assert.equal(contentHash('은혜'.normalize('NFC')), contentHash('은혜'.normalize('NFD')));
});
```

`test/concurrency.test.js`:

```js
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
```

- [ ] **Step 2: 실패 확인** — `npm test` → 두 모듈 not found

- [ ] **Step 3: 구현** — `src/lib/hash.js`

```js
import { createHash } from 'node:crypto';

// 콘텐츠를 NFC로 정규화한 뒤 sha1 — 증분 판단·캐시 키·안정 식별자에 쓴다.
export function contentHash(text) {
  return createHash('sha1').update(String(text || '').normalize('NFC'), 'utf8').digest('hex');
}
```

`src/lib/concurrency.js`:

```js
// 최대 limit개를 동시에 실행하되 결과는 입력 순서대로 돌려준다.
// 외부 의존성 없이 인덱스 워커 풀로 구현.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  const cap = Math.max(1, Math.min(limit || 1, items.length || 1));
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/hash.js src/lib/concurrency.js test/hash.test.js test/concurrency.test.js
git commit -m "feat: add content hashing and bounded-concurrency utilities"
```

---

### Task 2: 추출/AI 캐시 저장소

**Files:**
- Create: `src/lib/cache.js`
- Test: `test/cache.test.js`

**Interfaces:**
- Consumes: `contentHash` (Task 1)
- Produces: `createCache(dir): { get(key), set(key, value), save() }` — JSON 파일 기반 KV 캐시. `dir`은 워크스페이스의 `.llmwiki` 등 절대경로. `get`은 없으면 undefined. `save()`가 디스크에 flush. 로드 실패(손상 JSON)는 빈 캐시로 조용히 시작

- [ ] **Step 1: 실패 테스트** — `test/cache.test.js`

```js
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
```

- [ ] **Step 2: 실패 확인** — `npm test` → cache not found

- [ ] **Step 3: 구현** — `src/lib/cache.js`

```js
import fs from 'node:fs';
import path from 'node:path';

// 단순 JSON KV 캐시. 손상 파일은 빈 캐시로 시작한다(치명적 실패 아님).
export function createCache(filePath) {
  let store = {};
  try {
    store = JSON.parse(fs.readFileSync(filePath, 'utf-8')) || {};
    if (typeof store !== 'object' || Array.isArray(store)) store = {};
  } catch {
    store = {};
  }
  return {
    get(key) { return store[key]; },
    set(key, value) { store[key] = value; },
    save() {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
    },
  };
}
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.js test/cache.test.js
git commit -m "feat: add JSON KV cache for extraction and AI results"
```

---

### Task 3: 추출 캐시 연동 (extractor)

**Files:**
- Modify: `src/lib/extractor.js`
- Test: `test/cache.test.js`에 추가 (extractFolder 캐시 히트)

**Interfaces:**
- Consumes: `createCache` (Task 2), `contentHash` (Task 1)
- Produces: `extractFolder(root, { cache } = {})` — cache 주어지면 파일 (경로+mtime+size) 키로 이전 추출결과 재사용, 변경 시 재추출. 반환 형태 불변 (`[{ filePath, result }]`)

- [ ] **Step 1: 실패 테스트** — `test/cache.test.js`에 추가

```js
import { extractFolder } from '../src/lib/extractor.js';

test('extractFolder: 캐시 히트 시 재파싱하지 않는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.md'), '# 제목\n본문 내용');
    const cache = createCache(path.join(dir, '.cache.json'));
    const first = await extractFolder(dir, { cache });
    assert.equal(first.length, 1);
    assert.equal(first[0].result.body.includes('본문 내용'), true);
    // 캐시에 기록되어야 함
    cache.save();
    const cache2 = createCache(path.join(dir, '.cache.json'));
    const second = await extractFolder(dir, { cache: cache2 });
    assert.deepEqual(second[0].result, first[0].result);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → extractFolder가 옵션/캐시 미지원

- [ ] **Step 3: 구현** — `src/lib/extractor.js`

`extractFolder`를 캐시 인지형으로 교체 (extractOne은 그대로):

```js
import fs from 'node:fs';
import path from 'node:path';
import { scanFolder } from '../vendor/scan.js';
import { extractMarkdown } from '../extract/markdown.js';
import { extractPdf } from '../extract/pdf.js';
import { extractDocx } from '../extract/docx.js';
import { extractPptx } from '../extract/pptx.js';

export async function extractOne(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') return extractMarkdown(filePath);
  if (ext === '.pdf') return extractPdf(filePath);
  if (ext === '.docx') return extractDocx(filePath);
  if (ext === '.pptx') return extractPptx(filePath);
  return null;
}

function fileSignature(filePath) {
  const st = fs.statSync(filePath);
  return `${st.size}:${Math.floor(st.mtimeMs)}`;
}

export async function extractFolder(root, { cache = null } = {}) {
  const files = scanFolder(root);
  const extracted = [];
  for (const filePath of files) {
    let result = null;
    const key = `extract:${filePath}`;
    if (cache) {
      const hit = cache.get(key);
      if (hit && hit.sig === fileSignature(filePath)) result = hit.result;
    }
    if (!result) {
      result = await extractOne(filePath);
      if (cache && result) cache.set(key, { sig: fileSignature(filePath), result });
    }
    if (result && result.body) extracted.push({ filePath, result });
  }
  return extracted;
}
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS

- [ ] **Step 5: 회귀 확인**

Run: `node src/cli.js ingest --source ./samples/acme-docs --workspace /private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/p2-check --title Demo`
Expected: `ok: true, documents: 7` (아직 wiki-builder가 cache를 안 넘기므로 동작만 회귀 없이 유지)

- [ ] **Step 6: Commit**

```bash
git add src/lib/extractor.js test/cache.test.js
git commit -m "feat: cache extraction results by file signature in extractFolder"
```

---

### Task 4: Ollama 보강 병렬화 + 캐시

**Files:**
- Modify: `src/vendor/ollama.js` (enrichNodesWithOllama에 concurrency), `src/lib/wiki-builder.js` (maybeEnrichWithOllama에 캐시+병렬)
- Test: `test/concurrency.test.js`에 통합 성격 테스트는 생략(외부 Ollama 의존) — 대신 순수 병렬 유틸은 Task 1에서 검증됨. wiki-builder의 캐시 경로는 Task 8 통합 테스트에서 커버

**Interfaces:**
- Consumes: `mapWithConcurrency` (Task 1), `createCache` (Task 2), `contentHash` (Task 1)
- Produces: `maybeEnrichWithOllama(nodes, options)` 가 (a) 콘텐츠 해시로 AI 캐시 조회 → 히트는 Ollama 호출 스킵, (b) 미스만 `mapWithConcurrency(limit=options.ollamaConcurrency||4)`로 병렬 호출, (c) 캐시에 결과 저장. Ollama 미가용 시 기존과 동일하게 조용히 스킵

- [ ] **Step 1: 구현** — `src/lib/wiki-builder.js`의 `maybeEnrichWithOllama` 교체

import에 추가: `import { mapWithConcurrency } from './concurrency.js';` `import { contentHash } from './hash.js';`

```js
async function maybeEnrichWithOllama(nodes, options) {
  if (!options.ollama) return { ok: false, enabled: false };
  const status = await checkOllama({ baseUrl: options.ollamaUrl, model: options.ollamaModel });
  if (!status.ok || !status.modelAvailable) return { ok: false, enabled: true, status };
  const cache = options.aiCache;
  const model = options.ollamaModel;
  const toRun = [];
  for (const node of nodes) {
    const key = `ai:${model}:${contentHash(node.body)}`;
    const hit = cache?.get(key);
    if (hit) { node.ai = hit; } else { toRun.push({ node, key }); }
  }
  await mapWithConcurrency(toRun, options.ollamaConcurrency || 4, async ({ node, key }) => {
    try {
      node.ai = await summarizeNodeWithOllama(node, { baseUrl: options.ollamaUrl, model });
      cache?.set(key, node.ai);
    } catch (error) {
      node.ai = { error: error.message, model };
    }
  });
  return { ok: true, enabled: true, status };
}
```

- [ ] **Step 2: 회귀 확인 (Ollama 없이)**

Run: `node src/cli.js ingest --source ./samples/acme-docs --workspace /private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/p2-check --title Demo`
Expected: `ok: true` (ollama=false 경로라 enrich 스킵, 동작 불변)

- [ ] **Step 3: Commit**

```bash
git add src/lib/wiki-builder.js
git commit -m "feat: parallelize and cache Ollama enrichment by content hash"
```

주의: `options.aiCache`/`options.ollamaConcurrency`는 Task 5(ingestWorkspace)에서 주입한다. 이 태스크만으로는 aiCache가 undefined여도 안전(옵셔널 체이닝).

---

### Task 5: 증분 ingest — 매니페스트 · 안정 타임스탬프 · orphan cleanup · 본문 상한

**Files:**
- Modify: `src/lib/wiki-builder.js` (ingestWorkspace 본체)
- Test: `test/incremental.test.js` (Task 8에서 작성 — 여기선 구현만, 회귀는 데모로)

**Interfaces:**
- Consumes: `createCache`, `contentHash`, extractFolder(cache), maybeEnrichWithOllama(aiCache)
- Produces: `ingestWorkspace({ ..., graphBodyLimit = 2000 })`. 동작: (1) `.llmwiki/extract-cache.json`·`.llmwiki/ai-cache.json`·`.llmwiki/manifest.json` 사용, (2) 문서별 `contentHash(body)`를 매니페스트에 저장하고 **해시가 이전과 같으면 그 문서의 `updated_at`을 이전 값으로 보존**(변경분만 새 타임스탬프), (3) ingest 끝에 이번에 쓰지 않은 산출물(orphan: 이전 매니페스트엔 있으나 이번 소스에 없는 slug의 document/raw/contract/concept 페이지)을 삭제, (4) 그래프 노드 body를 `graphBodyLimit`로 자름(전체 본문 임베드 금지)

- [ ] **Step 1: 구현 — 캐시/매니페스트 로드** (ingestWorkspace 상단, extractFolder 호출 전)

import 추가: `import { createCache } from './cache.js';` `import { contentHash } from './hash.js';`

`ensureDir(workspace); await initWorkspace(...)` 다음에:

```js
  const llmDir = path.join(workspace, '.llmwiki');
  const extractCache = createCache(path.join(llmDir, 'extract-cache.json'));
  const aiCache = createCache(path.join(llmDir, 'ai-cache.json'));
  const prevManifest = createCache(path.join(llmDir, 'manifest.json'));
  const nextManifest = {};
```

`extractFolder(source)` 를 `extractFolder(source, { cache: extractCache })`로 교체.
`maybeEnrichWithOllama(docs, { ollama, ollamaModel, ollamaUrl })` 를 `maybeEnrichWithOllama(docs, { ollama, ollamaModel, ollamaUrl, aiCache, ollamaConcurrency })`로 교체. 시그니처에 `ollamaConcurrency = 4, graphBodyLimit = 2000` 추가.

- [ ] **Step 2: 안정 타임스탬프** — 문서 페이지 쓰기 루프 직전

각 doc에 대해 해시 계산 + updated_at 결정:

```js
  for (const doc of docs) {
    const h = contentHash(doc.body);
    const prev = prevManifest.get(doc.slug);
    doc.updatedAt = (prev && prev.hash === h) ? prev.updatedAt : nowIso();
    nextManifest[doc.slug] = { hash: h, updatedAt: doc.updatedAt, source_path: doc.file };
  }
```

그리고 `pages.js`의 `renderDocPage`/`renderConceptPage`가 `updated_at`에 `nowIso()`를 쓰던 것을, **wiki-builder가 계산한 값을 넘기도록** 변경한다. → `src/lib/pages.js`의 `renderDocPage(doc, contract)`에서 `updated_at: nowIso()` → `updated_at: doc.updatedAt || nowIso()`. `renderConceptPage(concept)`도 `updated_at: concept.updatedAt || nowIso()` (concept.updatedAt는 없으면 nowIso 폴백 — 개념은 생성물이라 증분 대상 아님, 폴백 유지).

**주의:** 이 변경은 Phase 1 pages.test.js의 기존 테스트를 깨지 않아야 한다(그 테스트는 updated_at 값을 검증하지 않음). 실행해서 확인.

- [ ] **Step 3: 본문 상한** — docNodes 생성부

`const docNodes = docs.map((doc) => ({ ..., body: doc.body, ... }))` 에서 `body: doc.body` → `body: doc.body.slice(0, graphBodyLimit)`. (개념 노드 body는 이미 짧으므로 그대로.)

- [ ] **Step 4: orphan cleanup + 매니페스트/캐시 저장** — writeJson(state) 직전

```js
  // 이전 매니페스트에 있으나 이번엔 없는 slug의 산출물 제거
  const currentSlugs = new Set(docs.map((d) => d.slug));
  for (const slug of Object.keys(prevManifest.get.__proto__ ? {} : {})) { /* no-op guard */ }
  const prevSlugs = prevManifestSlugs(prevManifest);
  for (const slug of prevSlugs) {
    if (currentSlugs.has(slug)) continue;
    for (const p of [
      path.join(workspace, 'docs', 'documents', `${slug}.md`),
      path.join(workspace, 'raw', 'imports', `${slug}.md`),
      path.join(workspace, 'contracts', `${slug}.json`),
    ]) { try { fs.rmSync(p, { force: true }); } catch {} }
  }
  // 매니페스트/캐시 flush
  writeJson(path.join(llmDir, 'manifest.json'), nextManifest);
  extractCache.save();
  aiCache.save();
```

`prevManifestSlugs` 헬퍼를 파일 상단에 추가:

```js
function prevManifestSlugs(manifestCache) {
  const out = [];
  // createCache는 get만 노출하므로, manifest는 평범한 객체로 직접 읽는다
  return out;
}
```

**설계 수정:** manifest는 slug 집합 순회가 필요하므로 `createCache` 대신 `readJson`으로 직접 읽는다. Step 1의 `prevManifest`를 다음으로 교체:

```js
  const prevManifest = readJson(path.join(llmDir, 'manifest.json'), {}) || {};
```

그리고 Step 2에서 `prevManifest.get(doc.slug)` → `prevManifest[doc.slug]`. orphan 순회는 `Object.keys(prevManifest)`. `prevManifestSlugs` 헬퍼는 불필요하니 추가하지 말 것. `readJson`은 이미 utils에서 import되어 있는지 확인하고 없으면 import에 추가.

(개념 orphan도 같은 방식으로 이전 개념 slug를 저장·비교하면 좋지만, 개념은 매 ingest 전량 재생성되므로 이번 스코프에서는 문서 orphan만 처리하고, 개념 페이지 디렉토리는 Step 4 직전에 `docs/concepts`를 통째로 비우고 다시 쓰는 방식으로 stale 개념을 제거한다:)

```js
  // stale 개념 페이지 제거 (개념은 전량 재생성되므로 디렉토리를 비우고 다시 쓴다)
  const conceptsDir = path.join(workspace, 'docs', 'concepts');
  try { for (const f of fs.readdirSync(conceptsDir)) if (f.endsWith('.md')) fs.rmSync(path.join(conceptsDir, f), { force: true }); } catch {}
```

이 개념 정리는 **개념 페이지 쓰기 루프 직전**에 넣는다(쓰기 전에 비워야 하므로).

- [ ] **Step 5: 회귀 확인 (2회 ingest)**

```bash
WS=/private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/p2-inc
node src/cli.js ingest --source ./samples/acme-docs --workspace $WS --title Demo
cp -r $WS/docs/documents /tmp/p2-snap1
node src/cli.js ingest --source ./samples/acme-docs --workspace $WS --title Demo
diff -r /tmp/p2-snap1 $WS/docs/documents && echo "IDENTICAL (증분 안정성 OK)"
```

Expected: 두 번째 ingest 후 문서 페이지가 1회차와 **바이트 동일**(updated_at 보존됨) → `IDENTICAL` 출력. `npm test`도 여전히 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wiki-builder.js src/lib/pages.js
git commit -m "feat: incremental ingest with manifest, stable timestamps, orphan cleanup, bounded graph body"
```

---

### Task 6: 벤더 자산 복사 + 서버 서빙

**Files:**
- Create: `src/lib/assets.js`
- Modify: `src/lib/wiki-builder.js` (ingest 시 graph/vendor로 복사), `src/lib/server.js` (/vendor 서빙 — 워크스페이스 우선)
- Test: `test/offline.test.js` (Task 8) — 여기선 구현 + 데모 확인

**Interfaces:**
- Produces: `copyVendorAssets(destDir)` — 패키지의 `src/vendor/assets/*`를 destDir로 복사. `VENDOR_FILES: string[]`. ingest가 `workspace/graph/vendor/`로 복사하므로 그래프 HTML의 `./vendor/x.js` 상대경로가 파일시스템·HTTP 양쪽에서 해석됨

- [ ] **Step 1: 구현** — `src/lib/assets.js`

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'assets');
export const VENDOR_FILES = ['three.min.js', '3d-force-graph.min.js', 'marked.min.js', 'fuse.min.js', 'purify.min.js'];

export function vendorAssetsDir() { return ASSETS_DIR; }

export function copyVendorAssets(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of VENDOR_FILES) {
    fs.copyFileSync(path.join(ASSETS_DIR, name), path.join(destDir, name));
  }
}
```

- [ ] **Step 2: ingest에서 복사** — `src/lib/wiki-builder.js`, 그래프 HTML 쓰기 직후

import: `import { copyVendorAssets } from './assets.js';`

```js
  fs.writeFileSync(path.join(workspace, 'graph', 'company-knowledge-graph.html'), html, 'utf-8');
  copyVendorAssets(path.join(workspace, 'graph', 'vendor'));
```

- [ ] **Step 3: 서버 /vendor 서빙** — `src/lib/server.js`

기존 정적 파일 서빙 블록(100행 부근, `filePath.startsWith(workspaceRoot)`)은 이미 `workspace/graph/vendor/*.js`를 서빙할 수 있다(워크스페이스 하위이므로). **단 contentType이 .js를 text/plain으로 주면 브라우저가 실행 거부**할 수 있으므로 contentType에 .js 추가:

```js
function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.md')) return 'text/markdown; charset=utf-8';
  return 'text/plain; charset=utf-8';
}
```

(그래프는 대시보드 iframe에서 `/graph/company-knowledge-graph.html`로 서빙되고, 그 안의 `./vendor/three.min.js`는 `/graph/vendor/three.min.js`로 해석 → 워크스페이스 하위라 기존 서빙 로직이 처리. 추가 라우트 불필요.)

- [ ] **Step 4: 데모 확인**

```bash
WS=/private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/p2-vendor
node src/cli.js ingest --source ./samples/acme-docs --workspace $WS --title Demo
ls $WS/graph/vendor/    # 5개 js 있어야 함
grep -c "cdn.jsdelivr\|unpkg\|fonts.googleapis" $WS/graph/company-knowledge-graph.html   # 0 이어야 함
```

Expected: vendor에 5개 파일, grep 카운트 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assets.js src/lib/wiki-builder.js src/lib/server.js
git commit -m "feat: copy vendored assets into workspace graph dir and serve with correct MIME"
```

---

### Task 7: 그래프 HTML 회귀 — file:// 오프라인 로드 스모크

**Files:**
- Test: `test/offline.test.js`

**Interfaces:**
- Consumes: 전체 ingest 파이프라인
- Produces: 회귀 안전망 — 생성 그래프 HTML에 외부 URL 없음 + vendor 자산 복사 검증

- [ ] **Step 1: 테스트** — `test/offline.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestWorkspace } from '../src/lib/wiki-builder.js';

const FIXTURE = new URL('./fixtures/ko-vault', import.meta.url).pathname;

test('오프라인: 그래프 HTML에 외부 fetch URL이 없고 vendor 자산이 복사된다', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-'));
  try {
    await ingestWorkspace({ source: FIXTURE, workspace: ws, title: '오프라인 테스트' });
    const html = fs.readFileSync(path.join(ws, 'graph', 'company-knowledge-graph.html'), 'utf-8');
    // <script src>/<link href>에 http(s) 외부 리소스가 없어야 한다
    const externalSrc = html.match(/(src|href)\s*=\s*["']https?:\/\/[^"']+["']/gi) || [];
    // attribution 앵커(<a href="https://github.com/...">)는 리소스 로드가 아니므로 script/link만 검사
    const externalResource = externalSrc.filter((s) => /^(src)/i.test(s) || /rel=|stylesheet|fonts\.googleapis/i.test(html.slice(html.indexOf(s) - 40, html.indexOf(s))));
    assert.deepEqual(html.match(/<script[^>]+src=["']https?:/gi), null, '외부 script 없어야 함');
    assert.equal(/<link[^>]+href=["']https?:\/\/fonts\.googleapis/i.test(html), false, 'Google Fonts 없어야 함');
    for (const f of ['three.min.js', '3d-force-graph.min.js', 'marked.min.js', 'fuse.min.js', 'purify.min.js']) {
      assert.ok(fs.existsSync(path.join(ws, 'graph', 'vendor', f)), `${f} 복사됨`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
```

(위 `externalSrc`/`externalResource` 지역변수가 사용되지 않으면 제거해도 됨 — 핵심 단정은 `<script src=https:>` null, Google Fonts false, vendor 5개 존재.)

- [ ] **Step 2: 실행** — `npm test` → PASS

- [ ] **Step 3: Commit**

```bash
git add test/offline.test.js
git commit -m "test: assert generated graph is offline-clean with vendored assets"
```

---

### Task 8: 증분 통합 테스트

**Files:**
- Test: `test/incremental.test.js`

**Interfaces:**
- Consumes: 전체 파이프라인
- Produces: 증분 동작(안정 타임스탬프·orphan cleanup) 회귀 안전망

- [ ] **Step 1: 테스트** — `test/incremental.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestWorkspace } from '../src/lib/wiki-builder.js';

function mkSource() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
  fs.mkdirSync(path.join(dir, 'a'));
  fs.writeFileSync(path.join(dir, 'a', 'one.md'), '# 하나\n하나님의 은혜와 사랑. 예배를 드립니다.');
  fs.writeFileSync(path.join(dir, 'a', 'two.md'), '# 둘\n하나님은 사랑이시다. 은혜가 넘칩니다. 예배와 기도.');
  return dir;
}

test('증분: 변경 없는 재-ingest는 문서 페이지를 바이트 동일하게 유지', async () => {
  const src = mkSource();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  try {
    await ingestWorkspace({ source: src, workspace: ws, title: 'T' });
    const p = path.join(ws, 'docs', 'documents');
    const before = Object.fromEntries(fs.readdirSync(p).map((f) => [f, fs.readFileSync(path.join(p, f), 'utf-8')]));
    await ingestWorkspace({ source: src, workspace: ws, title: 'T' });
    const after = Object.fromEntries(fs.readdirSync(p).map((f) => [f, fs.readFileSync(path.join(p, f), 'utf-8')]));
    assert.deepEqual(after, before, '재-ingest가 파일을 바꾸지 않아야 함(updated_at 보존)');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('증분: 소스 삭제 시 orphan 산출물이 제거된다', async () => {
  const src = mkSource();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  try {
    const s1 = await ingestWorkspace({ source: src, workspace: ws, title: 'T' });
    assert.equal(s1.metrics.documents, 2);
    // two.md 삭제 후 재-ingest
    fs.rmSync(path.join(src, 'a', 'two.md'));
    const s2 = await ingestWorkspace({ source: src, workspace: ws, title: 'T' });
    assert.equal(s2.metrics.documents, 1);
    const remaining = fs.readdirSync(path.join(ws, 'docs', 'documents'));
    assert.equal(remaining.length, 1, `orphan 남음: ${remaining.join(',')}`);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실행 + 진단**

Run: `npm test`
Expected: PASS. "바이트 동일" 실패 시 → pages.js updated_at 보존 경로(Task 5 Step 2) 재점검. orphan 실패 시 → Task 5 Step 4 삭제 루프 확인.

- [ ] **Step 3: Commit**

```bash
git add test/incremental.test.js
git commit -m "test: incremental re-ingest stability and orphan cleanup coverage"
```

---

### Task 9: 마무리 — 문서화

**Files:**
- Modify: `README.md`, `WORK_PLAN.md`

- [ ] **Step 1:** README에 오프라인(벤더링)·증분 ingest·`--ollama-concurrency`(있다면) 설명 추가. WORK_PLAN Phase 2 상태 `✅ 완료`로, 작업 로그 1줄 추가.

- [ ] **Step 2:** `npm test` 전체 통과 확인.

- [ ] **Step 3: Commit**

```bash
git add README.md WORK_PLAN.md
git commit -m "docs: document offline vendoring, incremental ingest, Ollama caching"
```

---

## Self-Review 체크 결과

- **Spec coverage:** Phase 2 4개 항목 — 증분(Task 3,5,8), Ollama 병렬+캐시(Task 1,2,4), 그래프 본문 크기(Task 5 Step 3), CDN 벤더링(Task 0,6,7) 전부 대응.
- **Ollama-optional 불변식:** Task 4/8이 `--ollama` 없는 기본 경로를 회귀로 검증(데모 + incremental 테스트는 Ollama 미사용).
- **결정론:** Task 5가 updated_at 보존으로 재-ingest 바이트 동일을 보장, Task 8이 이를 테스트로 잠금.
- **의존성:** node:crypto/node:test만 사용, 벤더링은 파일 복사 — 새 npm 의존성 0.
- **Out of scope (Phase 3로 이월):** 서버 사이드 BM25 검색으로 그래프의 클라이언트 body 검색을 대체(그때 body 완전 lazy-load 완성), 임베딩 개념 클러스터링.
