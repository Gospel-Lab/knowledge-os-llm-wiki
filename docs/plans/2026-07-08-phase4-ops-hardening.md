# Phase 4: 운영 정비 — CI · LICENSE · 데드코드 제거 · /api/open · Phase 3 이월 하드닝

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 프로젝트를 기여·운영 가능한 상태로 정비한다 — CI 추가, LICENSE 파일, 데드코드(linker.js) 제거, 그래프의 죽어있던 "원본 열기" 버튼을 안전한 `/api/open`으로 되살리고, Phase 3에서 이월된 견고성/충실도 minor 4건을 흡수한다.

**Architecture:** 순수 운영 작업이 대부분(🟢). `/api/open`은 서버가 요청 경로를 `state.source` 또는 워크스페이스 루트 하위로만 화이트리스트 검증한 뒤 OS 기본 프로그램으로 여는 로컬 전용 엔드포인트(🟡). render.js의 openLocalPath가 죽은 `/graphs/:id/open-path` 대신 `/api/open`을 호출하도록 바꾼다. Phase 3 이월: `/api/search`에 score 포함 + 손상 인덱스 try/catch, BM25 인덱싱에 title/keywords 토큰 추가, `pickSearchQuestions` 헬퍼 추출 + 단위테스트.

**Tech Stack:** Node.js ≥18 (ESM), node:test, node:child_process(spawn), GitHub Actions. 새 npm 의존성 없음.

## Global Constraints

- Node ≥ 18, ESM only. **새 npm 의존성 추가 금지**
- **Ollama-optional 불변식 유지**: 모든 변경이 --ollama 없는 기본 경로를 깨지 않아야 함
- **`/api/open` 보안 필수**: 요청 경로를 `path.resolve` 후 반드시 `state.source` 또는 워크스페이스 루트 하위인지 검증하고, 그 밖의 경로는 거부(403 유사). 셸 인젝션 방지 — `child_process.spawn`을 배열 인자로 호출(`shell:true` 금지). 127.0.0.1 로컬 전용 도구지만 경로 화이트리스트는 절대 생략 금지
- 결정론·기존 테스트 불변: 모든 기존 테스트(50개)는 계속 통과해야 함
- 작업 브랜치: `feat/phase4-ops-hardening`. push는 Gospel-Lab 계정, 끝나면 klum1223-coder 복귀
- 커밋: conventional commits. 저장소: `/Users/seonwoo/Documents/GitHub/knowledge-os-llm-wiki`
- 임시 워크스페이스: `/private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/`

## 파일 구조 (최종)

```
LICENSE                          # 신규: MIT (package.json과 일치)
.github/workflows/ci.yml         # 신규: node 18/20에서 npm test
src/vendor/linker.js             # 삭제 (데드코드)
src/lib/open-path.js             # 신규: resolveOpenTarget(requested, {source, workspace}) 검증 (순수, 테스트 가능)
src/lib/server.js                # 수정: /api/open, /api/search score+try-catch
src/lib/bm25.js                  # 수정: searchBm25에 postings 가드
src/lib/wiki-builder.js          # 수정: BM25 인덱스에 title+keywords 토큰 추가; pickSearchQuestions 사용
src/vendor/render.js             # 수정: openLocalPath → /api/open, 폴더 버튼 경로 수정
test/open-path.test.js           # 신규: 경로 화이트리스트 검증
test/questions.test.js           # 신규: pickSearchQuestions
test/bm25.test.js                # 수정: postings 가드 회귀
```

---

### Task 0: 브랜치 + LICENSE + linker.js 데드코드 제거

**Files:** Create `LICENSE`; Delete `src/vendor/linker.js`

- [ ] **Step 1: 브랜치**

```bash
cd /Users/seonwoo/Documents/GitHub/knowledge-os-llm-wiki
git checkout -b feat/phase4-ops-hardening
```

- [ ] **Step 2: linker.js가 정말 죽었는지 재확인 후 삭제**

```bash
grep -rn "linker" src --include="*.js" | grep -v "src/vendor/linker.js:"   # 출력 없어야 함
git rm src/vendor/linker.js
```

출력이 있으면(어딘가 import) STOP — NEEDS_CONTEXT 보고.

- [ ] **Step 3: LICENSE 작성** — MIT, 저작권자 확인

`package.json`이 MIT라 표준 MIT 텍스트를 쓴다. 저작권 줄: `Copyright (c) 2026 Gospel-Lab`. (NOTICE.md에 기존 저작권 표기가 있으면 그와 정합되게 — 먼저 `cat NOTICE.md` 확인 후 저작권자명을 맞출 것. wikigraph3d 파생이므로 NOTICE의 원저작자 표기는 건드리지 말 것.)

표준 MIT License 전문(연도/저작권자만 위 값):

```
MIT License

Copyright (c) 2026 Gospel-Lab

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: 확인 + 커밋**

```bash
npm test   # 50 pass (linker 삭제가 아무것도 안 깨는지)
git add LICENSE
git commit -m "chore: add MIT LICENSE file and remove dead linker.js"
```

(`git rm`이 이미 삭제를 스테이징했으므로 `git add LICENSE`와 함께 커밋됨.)

---

### Task 1: GitHub Actions CI

**Files:** Create `.github/workflows/ci.yml`

- [ ] **Step 1: 워크플로 작성**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
```

주의: `npm ci`는 package-lock.json이 있어야 한다(있음). 없으면 `npm install`로 바꿀 것 — 먼저 `ls package-lock.json` 확인.

- [ ] **Step 2: YAML 문법 로컬 확인**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');console.log(s.includes('npm test')?'ok':'missing test')"
```

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run npm test on Node 18 and 20"
```

---

### Task 2: /api/open — 경로 검증 모듈 + 서버 엔드포인트 + render.js 연결

**Files:** Create `src/lib/open-path.js`, `test/open-path.test.js`; Modify `src/lib/server.js`, `src/vendor/render.js`

**Interfaces:**
- Produces: `resolveOpenTarget(requested, { source, workspace }): { ok: boolean, path?: string, reason?: string }` — requested를 resolve해서 source나 workspace 루트 하위면 `{ok:true, path:resolved}`, 아니면 `{ok:false, reason}`. 심볼릭/`..` 이스케이프도 resolve 후 prefix 검사로 차단. `POST /api/open {path, kind}` → 검증 통과 시 OS opener로 열고 `{ok:true}`, 실패 시 `{ok:false, message}` (파일 미존재/범위 밖)

- [ ] **Step 1: 실패 테스트** — `test/open-path.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenTarget } from '../src/lib/open-path.js';

const roots = { source: '/data/src', workspace: '/data/ws' };

test('resolveOpenTarget: source 하위 경로 허용', () => {
  const r = resolveOpenTarget('/data/src/a/b.md', roots);
  assert.equal(r.ok, true);
  assert.equal(r.path, '/data/src/a/b.md');
});

test('resolveOpenTarget: workspace 하위 허용', () => {
  assert.equal(resolveOpenTarget('/data/ws/graph/x.html', roots).ok, true);
});

test('resolveOpenTarget: 범위 밖 거부', () => {
  assert.equal(resolveOpenTarget('/etc/passwd', roots).ok, false);
});

test('resolveOpenTarget: .. 이스케이프 거부', () => {
  assert.equal(resolveOpenTarget('/data/src/../../etc/passwd', roots).ok, false);
});

test('resolveOpenTarget: prefix 유사경로 오탐 방지 (/data/src-evil)', () => {
  // /data/src-evil 은 /data/src 의 하위가 아니다
  assert.equal(resolveOpenTarget('/data/src-evil/x', roots).ok, false);
});

test('resolveOpenTarget: 빈 입력 거부', () => {
  assert.equal(resolveOpenTarget('', roots).ok, false);
});
```

- [ ] **Step 2: 실패 확인** — `npm test`

- [ ] **Step 3: 구현** — `src/lib/open-path.js`

```js
import path from 'node:path';

function isWithin(root, target) {
  if (!root) return false;
  const rel = path.relative(root, target);
  // 같은 경로이거나 하위 경로면 rel이 '..'로 시작하지 않고 절대경로도 아님
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveOpenTarget(requested, { source, workspace } = {}) {
  const raw = String(requested || '').trim();
  if (!raw) return { ok: false, reason: 'empty path' };
  const resolved = path.resolve(raw);
  const src = source ? path.resolve(source) : null;
  const ws = workspace ? path.resolve(workspace) : null;
  if (isWithin(src, resolved) || isWithin(ws, resolved)) return { ok: true, path: resolved };
  return { ok: false, reason: 'path outside allowed roots' };
}
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS

- [ ] **Step 5: 서버 엔드포인트** — `src/lib/server.js`

import 추가: `import { spawn } from 'node:child_process';` `import { resolveOpenTarget } from './open-path.js';` `import fs from 'node:fs';`(이미 있음)

state 로드부에서 `const openRoots = { source: state.source, workspace: workspaceRoot };`

opener 헬퍼(startServer 밖 모듈 스코프):

```js
function osOpen(target) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer' : 'xdg-open';
  const child = spawn(cmd, [target], { detached: true, stdio: 'ignore' });
  child.unref();
}
```

`POST /api/open` 라우트(/api/ask 근처):

```js
    if (req.method === 'POST' && url.pathname === '/api/open') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { path: reqPath } = JSON.parse(body || '{}');
          const check = resolveOpenTarget(reqPath, openRoots);
          if (!check.ok) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, message: `열 수 없는 경로: ${check.reason}` }));
            return;
          }
          if (!fs.existsSync(check.path)) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, message: '파일이 존재하지 않습니다' }));
            return;
          }
          osOpen(check.path);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, message: error.message }));
        }
      });
      return;
    }
```

- [ ] **Step 6: render.js 연결** — `src/vendor/render.js` openLocalPath(648행 부근)

`/graphs/:id/open-path` 호출 블록을 `/api/open` 호출로 교체. graphId/graphIdFromLocation 의존 제거하고, http(s)일 때 `/api/open`에 `{path: localPath}` POST:

```js
async function openLocalPath(button) {
  const localPath = button.getAttribute("data-open-path");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "여는 중...";
  try {
    if (/^https?:$/.test(location.protocol)) {
      const res = await fetch("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: localPath, kind: button.getAttribute("data-open-kind") || "file" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || "로컬 파일 열기 실패");
      button.textContent = "열었음";
      setTimeout(() => { button.textContent = original; }, 1200);
      return;
    }
    const opened = window.open(fileUriFor(localPath), "_blank");
    if (!opened) throw new Error("브라우저가 file:// 링크를 차단했습니다.");
    button.textContent = "열었음";
    setTimeout(() => { button.textContent = original; }, 1200);
  } catch (err) {
    button.textContent = await copyPathFallback(localPath);
    setTimeout(() => { button.textContent = original; }, 1800);
  } finally {
    button.disabled = false;
  }
}
```

폴더 버튼(576행)의 `data-open-path="\${escapeHtml(n.folder)}"`는 폴더 **이름**(예: "설교")이라 열 수 없다 → 문서의 실제 디렉토리로 바꾼다. render.js에서 폴더 경로가 없으면(개념 노드 등) 폴더 버튼을 아예 안 그리도록, `n.absolutePath`가 있을 때만 그 디렉토리를 쓴다. 576행 부근을 다음으로:

```js
  if (n.absolutePath) {
    actions += \`<button type="button" data-open-path="\${escapeHtml(n.absolutePath.replace(/[\\\\/][^\\\\/]*$/, ''))}" data-open-kind="folder">폴더 열기</button>\`;
  }
```

(정규식으로 마지막 경로 세그먼트를 제거해 디렉토리를 얻는다. render.js는 템플릿 문자열 안이라 백슬래시 이스케이프에 유의 — 실제 파일에서 기존 folder 버튼 라인의 이스케이프 스타일에 맞출 것.)

`graphIdFromLocation` 함수가 이제 안 쓰이면 제거(다른 곳에서 안 쓰는지 grep 후).

- [ ] **Step 7: 데모 확인 (열기는 실제로 실행하지 말고 검증 경로만)**

```bash
WS=/private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/p4-open
node src/cli.js ingest --source ./test/fixtures/ko-vault --workspace $WS --title KO
node src/cli.js serve --workspace $WS --port 3520 &
sleep 1
# 범위 밖 경로는 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3520/api/open -H 'Content-Type: application/json' -d '{"path":"/etc/passwd"}'
# 존재하지 않는 범위 내 경로는 404 (source 하위지만 없는 파일)
kill %1 2>/dev/null
```

Expected: 첫 curl `403`. `npm test` PASS. (실제 파일 열기는 OS 창을 띄우므로 자동 검증에서 실행하지 않는다 — 검증 로직은 open-path.test.js가 커버.)

- [ ] **Step 8: 커밋**

```bash
git add src/lib/open-path.js test/open-path.test.js src/lib/server.js src/vendor/render.js
git commit -m "feat: implement /api/open with path whitelist, revive graph open buttons"
```

---

### Task 3: Phase 3 이월 하드닝 — /api/search score + try/catch + BM25 title/keywords

**Files:** Modify `src/lib/server.js`, `src/lib/bm25.js`, `src/lib/wiki-builder.js`, `test/bm25.test.js`

**Interfaces:**
- Produces: `/api/search` 결과에 `score` 포함; 손상 인덱스에도 `/api/search`가 크래시하지 않음(searchBm25가 `postings` 없으면 `[]`); BM25 인덱스가 `title`+`keywords`+`body` 토큰을 색인(제목/키워드만 있는 매칭도 검색됨)

- [ ] **Step 1: searchBm25 postings 가드 + 테스트** — `test/bm25.test.js` 추가

```js
test('searchBm25: postings 없는 손상 인덱스는 빈 배열(크래시 없음)', () => {
  assert.deepEqual(searchBm25({ N: 3 }, ['x']), []);
  assert.deepEqual(searchBm25({ N: 3, postings: null, idf: {}, docLen: {} }, ['x']), []);
});
```

`src/lib/bm25.js` searchBm25 상단 가드: `if (!queryTokens || !queryTokens.length || !index || !index.N || !index.postings) return [];`

- [ ] **Step 2: BM25 인덱스에 title+keywords 토큰 추가** — `src/lib/wiki-builder.js`

`const bm25Docs = docs.map((doc) => ({ slug: doc.slug, tokens: tokenize(doc.body) }));` 를:

```js
  const bm25Docs = docs.map((doc) => ({
    slug: doc.slug,
    tokens: [...tokenize(doc.title), ...(doc.keywords || []), ...tokenize(doc.body)],
  }));
```

(keywords는 이미 토큰화된 명사이므로 그대로 추가. title은 tokenize.)

- [ ] **Step 3: /api/search score 포함 + try/catch** — `src/lib/server.js`

`bm25Sources`가 score를 보존하도록: ranked를 `{ doc, score }`로 반환하거나, /api/search에서 별도로 score를 붙인다. 최소 변경으로, `/api/search` 라우트를 다음처럼(직접 searchBm25 호출해 score 확보):

```js
    if (req.method === 'GET' && url.pathname === '/api/search') {
      try {
        const q = url.searchParams.get('q') || '';
        const ranked = searchIndex ? searchBm25(searchIndex, tokenize(q), 10) : [];
        const results = ranked.map((r) => {
          const d = docBySlug.get(r.slug);
          return d ? { slug: d.slug, title: d.title, department: d.department, summary: d.summary, score: r.score } : null;
        }).filter(Boolean);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ results }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message, results: [] }));
      }
      return;
    }
```

(searchBm25 import 되어 있음. bm25Sources는 /api/ask에서 계속 사용 — 그대로 둠.)

- [ ] **Step 4: 확인**

```bash
npm test   # 기존 50 + bm25 가드 테스트
WS=/private/tmp/claude-501/-Users-seonwoo/1c5fcd79-318e-414a-a277-34f3ef4d24d5/scratchpad/p4-search
node src/cli.js ingest --source ./test/fixtures/ko-vault --workspace $WS --title KO
node src/cli.js serve --workspace $WS --port 3521 &
sleep 1
curl -s "http://127.0.0.1:3521/api/search?q=%ED%95%98%EB%82%98%EB%8B%98" | node -e "const s=require('fs').readFileSync(0,'utf8');const j=JSON.parse(s);console.log('has score:', j.results[0] && typeof j.results[0].score==='number')"
kill %1 2>/dev/null
```

Expected: `has score: true`. npm test PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/bm25.js src/lib/wiki-builder.js src/lib/server.js test/bm25.test.js
git commit -m "fix: BM25 index title+keywords, /api/search returns score with crash guard"
```

---

### Task 4: pickSearchQuestions 헬퍼 추출 + 단위 테스트

**Files:** Modify `src/lib/wiki-builder.js` (export helper), Create `test/questions.test.js`

**Interfaces:**
- Produces: `pickSearchQuestions(doc): string[]` (wiki-builder에서 export) — `doc.ai?.questions?.length`면 그걸, 아니면 `inferQuestions(doc.title, doc.keywords, doc.department)`. buildSearchContract가 이 헬퍼를 사용

- [ ] **Step 1: 실패 테스트** — `test/questions.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSearchQuestions } from '../src/lib/wiki-builder.js';

test('pickSearchQuestions: ai.questions 있으면 그걸 사용', () => {
  const doc = { title: 'T', keywords: ['k'], department: 'D', ai: { questions: ['Q1', 'Q2'] } };
  assert.deepEqual(pickSearchQuestions(doc), ['Q1', 'Q2']);
});

test('pickSearchQuestions: ai.questions 없으면 템플릿 3개', () => {
  const doc = { title: '설교노트', keywords: ['은혜', '사랑'], department: '설교' };
  const qs = pickSearchQuestions(doc);
  assert.equal(qs.length, 3);
  assert.ok(qs[0].includes('설교노트'));
});

test('pickSearchQuestions: ai.questions 빈 배열이면 템플릿 폴백', () => {
  const doc = { title: 'T', keywords: [], department: 'D', ai: { questions: [] } };
  assert.equal(pickSearchQuestions(doc).length, 3);
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → pickSearchQuestions not exported

- [ ] **Step 3: 구현** — `src/lib/wiki-builder.js`

`inferQuestions` 아래에 export 헬퍼 추가:

```js
export function pickSearchQuestions(doc) {
  return (doc.ai?.questions?.length ? doc.ai.questions : inferQuestions(doc.title, doc.keywords, doc.department));
}
```

buildSearchContract의 `search_questions:` 를 `pickSearchQuestions(doc)`로 교체(Task 3 Phase에서 넣은 인라인 삼항을 헬퍼 호출로 정리).

- [ ] **Step 4: 통과 + 회귀** — `npm test` → PASS (기존 계약 생성 동일)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/wiki-builder.js test/questions.test.js
git commit -m "refactor: extract pickSearchQuestions helper with unit tests"
```

---

### Task 5: 마무리 — 문서화 + 로드맵 완료

**Files:** Modify `README.md`, `WORK_PLAN.md`

- [ ] **Step 1:** README에 CI 배지(선택)·LICENSE 언급·그래프 "원본 열기"(로컬 서버 필요) 설명 추가. WORK_PLAN Phase 4 상태 `✅ 완료 (2026-07-08)`, 작업 로그 1줄. 로드맵 4개 페이즈 모두 ✅ 확인.

- [ ] **Step 2:** `npm test` 전체 통과.

- [ ] **Step 3: 커밋**

```bash
git add README.md WORK_PLAN.md docs/plans/2026-07-08-phase4-ops-hardening.md
git commit -m "docs: document CI, LICENSE, and local file-open; mark Phase 4 complete"
```

---

## Self-Review 체크 결과

- **Spec coverage:** CI(Task 1), LICENSE+데드코드(Task 0), /api/open(Task 2), Phase 3 이월 4건 — score+가드+토큰화(Task 3), questions 테스트(Task 4). 전부 대응.
- **보안:** /api/open은 resolveOpenTarget 화이트리스트 + spawn 배열인자(셸 없음), open-path.test.js가 `..`·prefix오탐·범위밖을 회귀로 잠금.
- **Ollama-optional:** 이 페이즈는 Ollama 경로를 건드리지 않음. 기존 50 테스트 유지가 불변식 보장.
- **의존성:** 새 npm 0(child_process는 내장).
