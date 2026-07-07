# Phase 1: 한국어 처리 + 데이터 정합성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국어 문서에서 유의미한 개념 추출이 가능하도록 토크나이저를 개선하고, slug 충돌·YAML 깨짐·wikilink 유실 등 데이터 정합성 버그를 제거한다.

**Architecture:** 기존 파이프라인(extract → keywords → wiki-builder → render)의 구조는 유지하되, (1) `keywords.js`에 조사 스트리핑 + 서술어 필터를 추가하고, (2) 페이지 생성을 `pages.js`로 분리해 gray-matter 기반 안전한 YAML을 쓰며, (3) wikilink 해석을 전용 `link-resolver.js`로 옮겨 Obsidian 방식(파일명 우선)으로 바꾼다. 테스트는 Node 내장 `node:test`로 작성한다.

**Tech Stack:** Node.js ≥18 (ESM), node:test(내장 테스트 러너), gray-matter(기존 의존성)

## Global Constraints

- Node ≥ 18, ESM only (`"type": "module"`)
- **새 의존성 추가 금지** — 런타임/devDependency 모두. 테스트는 `node:test` + `node:assert/strict` 내장 모듈만 사용 (프로젝트의 "로컬 우선" 철학 유지)
- gray-matter는 이미 dependencies에 있음(`^4.0.3`) — YAML 생성에 활용
- 모든 산출물은 결정론적이어야 함: `scanFolder`가 파일을 정렬해서 반환하므로, 동일 입력 → 동일 출력 보장. 순서 의존 로직에 랜덤/시간 요소 넣지 말 것
- slug는 최종적으로 **NFC 정규화**된 문자열이어야 함 (현재 NFKD 분해 상태로 남는 버그 수정 포함)
- 작업 브랜치: `feat/phase1-korean-integrity` (main 직접 커밋 금지)
- push는 **Gospel-Lab gh 계정**으로만 가능 (`gh auth switch -u Gospel-Lab` 필요 시)
- 커밋 메시지: conventional commits (`feat:`, `fix:`, `test:`, `refactor:`)
- 저장소 위치: `/Users/seonwoo/Documents/GitHub/knowledge-os-llm-wiki`

## 파일 구조 (최종)

```
src/lib/utils.js          # 수정: slugify NFC 수정 + createSlugger 추가
src/lib/pages.js          # 신규: renderDocPage / renderConceptPage / renderRawPage (gray-matter 기반)
src/lib/link-resolver.js  # 신규: Obsidian식 wikilink 해석 (파일명 > 경로 > 제목)
src/lib/wiki-builder.js   # 수정: slugger 사용, pages.js/link-resolver.js 사용, 개념 수 동적화
src/vendor/keywords.js    # 수정: 조사 스트리핑 + 서술어 필터 + 불용어 확장, tokenize export
src/cli.js                # 수정: --max-concepts 옵션
package.json              # 수정: "test" 스크립트
test/utils.test.js        # 신규
test/keywords.test.js     # 신규
test/link-resolver.test.js# 신규
test/pages.test.js        # 신규
test/integration.test.js  # 신규: 한국어 fixture vault 전체 ingest 검증
test/fixtures/ko-vault/   # 신규: 한국어 테스트 문서 6개
```

---

### Task 0: 브랜치 + 테스트 러너 세팅

**Files:**
- Modify: `package.json`
- Create: `test/utils.test.js` (스모크 1개)

**Interfaces:**
- Produces: `npm test` 명령이 `test/` 아래 `*.test.js`를 전부 실행

- [ ] **Step 1: 브랜치 생성**

```bash
cd /Users/seonwoo/Documents/GitHub/knowledge-os-llm-wiki
git checkout -b feat/phase1-korean-integrity
```

- [ ] **Step 2: package.json에 test 스크립트 추가**

`scripts`에 한 줄 추가:

```json
"test": "node --test test/"
```

- [ ] **Step 3: 스모크 테스트 작성** — `test/utils.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/lib/utils.js';

test('slugify: 기본 동작', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify(''), 'untitled');
});
```

- [ ] **Step 4: 실행 확인**

Run: `npm test`
Expected: `pass 1` (전부 통과)

- [ ] **Step 5: Commit**

```bash
git add package.json test/utils.test.js
git commit -m "test: add node:test runner and smoke test"
```

---

### Task 1: slugify NFC 수정 + slug 충돌 해소

**Files:**
- Modify: `src/lib/utils.js:32-39`
- Modify: `src/lib/wiki-builder.js:109-124, 142-158`
- Test: `test/utils.test.js`

**Interfaces:**
- Produces: `slugify(value): string` (기존 시그니처 유지, 출력이 NFC로 바뀜), `createSlugger(): (value) => string` (호출 순서대로 중복 시 `-2`, `-3` suffix)
- 이후 태스크는 doc 객체의 `slug`가 유일하다고 가정해도 됨

**배경:** ① 현재 `slugify`는 NFKD로 분해한 뒤 재결합하지 않아 한글이 자모 분해 상태(NFD)로 남는다. ② `설교/노트.md`와 `설교-노트.md`가 동일 slug `설교-노트-md`가 되어 뒤 파일이 앞 파일을 무음으로 덮어쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/utils.test.js`에 추가

```js
import { createSlugger } from '../src/lib/utils.js';

test('slugify: 한글 출력은 NFC 정규화', () => {
  const slug = slugify('설교 노트');
  assert.equal(slug, slug.normalize('NFC'));
  assert.equal(slug, '설교-노트');
});

test('createSlugger: 충돌 시 suffix로 유일성 보장', () => {
  const toSlug = createSlugger();
  assert.equal(toSlug('설교/노트.md'), '설교-노트-md');
  assert.equal(toSlug('설교-노트.md'), '설교-노트-md-2');
  assert.equal(toSlug('설교_노트.md'), '설교-노트-md-3');
  assert.equal(toSlug('회의록.md'), '회의록-md');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — NFC 테스트 실패(자모 분해 상태), `createSlugger` is not exported

- [ ] **Step 3: 구현** — `src/lib/utils.js`

`slugify`를 다음으로 교체하고 `createSlugger`를 추가:

```js
export function slugify(value) {
  return (String(value || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toLowerCase()
    .normalize('NFC')) || 'untitled';
}

// 같은 ingest 안에서 slug 유일성을 보장한다.
// scanFolder가 파일을 정렬해 주므로 suffix 부여 순서도 결정론적이다.
export function createSlugger() {
  const used = new Map();
  return (value) => {
    const base = slugify(value);
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전부

- [ ] **Step 5: wiki-builder에 slugger 적용** — `src/lib/wiki-builder.js`

import 수정:

```js
import { ensureDir, slugify, createSlugger, excerpt, nowIso, writeJson } from './utils.js';
```

`ingestWorkspace` 안의 docs 매핑(현재 109행 부근)을 교체 — `slugify(rel)`을 두 번 호출하던 것을 slugger 1회 호출로:

```js
  const toDocSlug = createSlugger();
  const docs = extracted.map(({ filePath, result }) => {
    const rel = path.relative(source, filePath).split(path.sep).join('/');
    const name = path.basename(filePath, path.extname(filePath));
    const slug = toDocSlug(rel);
    return {
      id: `doc:${slug}`,
      slug,
      title: result.title || name,
      file: rel,
      absolutePath: path.resolve(filePath),
      ext: path.extname(filePath).toLowerCase().replace(/^\./, ''),
      department: topFolderFromRel(rel),
      folder: topFolderFromRel(rel),
      body: result.body.trim(),
      wikilinks: result.wikilinks || [],
    };
  });
```

concepts 매핑(현재 142행 부근)도 동일하게 — `const slug = slugify(name);`을 slugger로:

```js
  const toConceptSlug = createSlugger();
  const concepts = conceptNames.map((name) => {
    const slug = toConceptSlug(name);
    // ... 나머지 필드는 기존 그대로
```

- [ ] **Step 6: 데모로 회귀 확인**

Run: `npm test && node src/cli.js ingest --source ./samples/acme-docs --workspace /tmp/p1-check --title Demo`
Expected: 테스트 전부 PASS, ingest `"ok": true`, `documents: 7`

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils.js src/lib/wiki-builder.js test/utils.test.js
git commit -m "fix: NFC-normalize slugs and prevent silent overwrite on slug collision"
```

---

### Task 2: 페이지 생성 분리 + YAML 안전화 (gray-matter)

**Files:**
- Create: `src/lib/pages.js`
- Modify: `src/lib/wiki-builder.js` (frontmatter 함수 제거, 페이지 조립부 교체)
- Test: `test/pages.test.js`

**Interfaces:**
- Consumes: doc 객체 `{ title, file, department, keywords, relatedConcepts, summary, body, slug }`, concept 객체 `{ title, relatedDocs, keywords, summary }`, contract 객체(Task 불변)
- Produces: `renderDocPage(doc, contract): string`, `renderConceptPage(concept): string`, `renderRawPage(doc): string` — 모두 유효한 YAML frontmatter를 가진 마크다운 문자열

**배경:** 수제 `frontmatter()` 함수가 값을 이스케이프하지 않아 제목에 `:`나 `"`가 있으면("설교: 요한복음 강해") 깨진 YAML이 생성된다. gray-matter의 `stringify`(js-yaml 기반)로 교체한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/pages.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import matter from 'gray-matter';
import { renderDocPage, renderConceptPage, renderRawPage } from '../src/lib/pages.js';

const doc = {
  slug: '설교-요한복음',
  title: '설교: 요한복음 "강해" #1',
  file: '설교/요한복음.md',
  department: '설교',
  keywords: ['요한복음', '은혜: 개념'],
  relatedConcepts: ['은혜'],
  summary: '요약: 이것은 요약이다',
  body: '# 본문\n내용',
};

test('renderDocPage: 특수문자 제목이 YAML 왕복 후 보존된다', () => {
  const page = renderDocPage(doc, { id: doc.slug, title: doc.title });
  const parsed = matter(page);
  assert.equal(parsed.data.title, doc.title);
  assert.deepEqual(parsed.data.keywords, doc.keywords);
  assert.ok(parsed.content.includes('# 설교: 요한복음 "강해" #1'));
});

test('renderRawPage: 본문 원문 보존', () => {
  const page = renderRawPage(doc);
  const parsed = matter(page);
  assert.equal(parsed.data.title, doc.title);
  assert.ok(parsed.content.includes('# 본문'));
});

test('renderConceptPage: 관련 문서 목록 포함', () => {
  const concept = {
    title: '은혜',
    summary: '은혜는 2개 문서에 등장',
    keywords: ['은혜'],
    relatedDocs: [{ slug: '설교-요한복음', summary: '요약' }],
  };
  const page = renderConceptPage(concept);
  const parsed = matter(page);
  assert.equal(parsed.data.title, '은혜');
  assert.ok(parsed.content.includes('[[설교-요한복음]]'));
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/pages.js'`

- [ ] **Step 3: 구현** — `src/lib/pages.js` 신규 생성

```js
import matter from 'gray-matter';
import { nowIso } from './utils.js';

// gray-matter(js-yaml)가 이스케이프를 처리하므로 특수문자 제목도 안전하다.
function withFrontmatter(content, data) {
  return matter.stringify(content, data);
}

export function renderDocPage(doc, contract) {
  const content = [
    `# ${doc.title}`,
    '',
    '## Summary',
    doc.summary,
    '',
    '## Search Contract',
    '```json',
    JSON.stringify(contract, null, 2),
    '```',
    '',
    '## Related Concepts',
    ...(doc.relatedConcepts?.length ? doc.relatedConcepts.map((slug) => `- [[${slug}]]`) : ['- 없음']),
    '',
    '## Source Excerpt',
    doc.body.slice(0, 4000),
    '',
  ].join('\n');
  return withFrontmatter(content, {
    title: doc.title,
    source_path: doc.file,
    department: doc.department,
    keywords: doc.keywords,
    related_concepts: doc.relatedConcepts || [],
    updated_at: nowIso(),
  });
}

export function renderRawPage(doc) {
  return withFrontmatter(`${doc.body}\n`, {
    title: doc.title,
    source_path: doc.file,
    imported_at: nowIso(),
  });
}

export function renderConceptPage(concept) {
  const content = [
    `# ${concept.title}`,
    '',
    concept.summary,
    '',
    '## Related Documents',
    ...concept.relatedDocs.map((doc) => `- [[${doc.slug}]] — ${doc.summary}`),
    '',
  ].join('\n');
  return withFrontmatter(content, {
    title: concept.title,
    kind: 'concept',
    related_documents: concept.relatedDocs.map((doc) => doc.slug),
    keywords: concept.keywords,
    updated_at: nowIso(),
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전부

- [ ] **Step 5: wiki-builder 연결** — `src/lib/wiki-builder.js`

1. import 추가: `import { renderDocPage, renderRawPage, renderConceptPage } from './pages.js';`
2. 기존 `frontmatter()` 함수(54–66행) **삭제**
3. 문서 페이지 쓰기 루프(192–222행 부근)에서 `docPage`/`rawPage` 조립을 교체:

```js
    const contract = buildSearchContract(doc, relatedDocs, doc.relatedConcepts);
    fs.writeFileSync(path.join(workspace, 'docs', 'documents', `${doc.slug}.md`), renderDocPage(doc, contract), 'utf-8');
    fs.writeFileSync(path.join(workspace, 'raw', 'imports', `${doc.slug}.md`), renderRawPage(doc), 'utf-8');
    writeJson(path.join(workspace, 'contracts', `${doc.slug}.json`), contract);
```

4. 개념 페이지 루프(224–236행)도 교체:

```js
  for (const concept of concepts) {
    fs.writeFileSync(path.join(workspace, 'docs', 'concepts', `${concept.slug}.md`), renderConceptPage(concept), 'utf-8');
  }
```

- [ ] **Step 6: 회귀 확인**

Run: `npm test && node src/cli.js ingest --source ./samples/acme-docs --workspace /tmp/p1-check --title Demo && head -12 /tmp/p1-check/docs/documents/*.md | head -30`
Expected: 테스트 PASS, frontmatter가 정상 YAML(따옴표 필요한 값은 js-yaml이 자동 인용)

- [ ] **Step 7: Commit**

```bash
git add src/lib/pages.js src/lib/wiki-builder.js test/pages.test.js
git commit -m "fix: YAML-safe frontmatter via gray-matter, extract page rendering to pages.js"
```

---

### Task 3: 한국어 토크나이저 — 조사 스트리핑 + 서술어 필터

**Files:**
- Modify: `src/vendor/keywords.js`
- Modify: `src/lib/utils.js:67-71` (`tokenizeQuery`가 같은 토크나이저 사용)
- Test: `test/keywords.test.js`

**Interfaces:**
- Consumes: 없음 (독립)
- Produces: `tokenize(text): string[]` (신규 export), `extractKeywords(docs, topN): string[][]` (시그니처 불변, 결과 품질 개선)

**배경:** 700개 한국어 문서 실측에서 `하나님은`/`하나님의`가 별개 토큰으로 갈라지고 `있습니다`·`것입니다` 같은 서술어가 개념으로 뽑혔다. 형태소 분석기 의존성 없이: ① 서술어 어미로 끝나는 토큰 제거 ② 한글 토큰 끝의 조사 제거(잔여 2자 이상일 때만) ③ 불용어 확장으로 해결한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/keywords.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, extractKeywords } from '../src/vendor/keywords.js';

test('tokenize: 조사가 제거되어 같은 명사로 합쳐진다', () => {
  const tokens = tokenize('하나님은 사랑이시다. 하나님의 사랑, 하나님이 하신 일, 하나님을 찬양');
  const counts = tokens.filter((t) => t === '하나님').length;
  assert.equal(counts, 4);
  assert.ok(!tokens.includes('하나님은'));
  assert.ok(!tokens.includes('하나님의'));
});

test('tokenize: 서술어 토큰은 버려진다', () => {
  const tokens = tokenize('이것은 중요합니다. 그것이 핵심입니다. 반드시 확인했습니다. 될 것입니다');
  assert.ok(!tokens.includes('중요합니다'));
  assert.ok(!tokens.includes('핵심입니다'));
  assert.ok(!tokens.includes('확인했습니다'));
  assert.ok(!tokens.includes('것입니다'));
});

test('tokenize: 짧은 명사는 과잉 스트리핑하지 않는다', () => {
  // '교회'에서 '회'를 조사로 오인해 '교'만 남기면 안 된다 (잔여 2자 미만 보호)
  const tokens = tokenize('교회 종이 울린다');
  assert.ok(tokens.includes('교회'));
  assert.ok(tokens.includes('종이') || tokens.includes('종')); // '종이'는 잔여 1자라 스트리핑 안 함
});

test('extractKeywords: 한국어 문서에서 명사형 키워드가 뽑힌다', () => {
  const docs = [
    '하나님은 사랑입니다. 하나님의 은혜가 임합니다. 예배를 드립니다.',
    '하나님이 창조하셨습니다. 은혜로 구원을 받습니다. 예배가 중요합니다.',
  ];
  const [kw1, kw2] = extractKeywords(docs, 5);
  assert.ok(kw1.includes('하나님'));
  assert.ok(kw2.includes('하나님'));
  assert.ok(!kw1.some((k) => /습니다$|입니다$/.test(k)));
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `tokenize` is not exported / 조사 분리 실패

- [ ] **Step 3: 구현** — `src/vendor/keywords.js`의 STOPWORDS와 tokenize를 교체

기존 `STOPWORDS`/`tokenize`를 삭제하고 다음으로 교체 (`extractKeywords`, `keywordSimilarityLinks`는 그대로 둔다):

```js
const STOPWORDS = new Set([
  // 영어
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is",
  "are", "was", "were", "be", "been", "with", "as", "by", "at", "this",
  "that", "it", "its", "from", "which", "will", "can", "not", "into", "your",
  "you", "we", "our", "their", "there", "these", "those", "also", "such",
  // 한국어 기능어 (조사 스트리핑 이후에도 남는 것들)
  "이", "그", "저", "것", "수", "등", "및", "때", "곳", "분", "안", "밖", "뒤", "앞",
  "그리고", "하지만", "그러나", "그래서", "그런데", "따라서", "때문", "위해", "대한",
  "대해", "통해", "있다", "없다", "한다", "하는", "된다", "되는", "되어", "있는",
  "없는", "같은", "같이", "위한", "라는", "이며", "이고", "부터", "까지", "경우",
  "정도", "이상", "이하", "관련", "각각", "모든", "여러", "다른", "다음", "지난",
  "우리", "여기", "거기", "누구", "무엇", "어떤", "어느", "매우", "가장", "더욱",
]);

// 어절 끝에서 떼어낼 조사 — 긴 것부터 매칭 (2자 조사가 1자 조사보다 먼저)
const JOSA = [
  "으로부터", "에서부터", "이라는", "에게서", "한테서", "으로서", "으로써",
  "에서는", "에서도", "에게는", "라는", "까지", "부터", "에서", "에게", "한테",
  "보다", "처럼", "마다", "으로", "와의", "과의", "이나", "이란", "이든",
  "은", "는", "이", "가", "을", "를", "의", "에", "도", "만", "와", "과", "로", "께", "야",
].sort((a, b) => b.length - a.length);

// 이 어미로 끝나는 한글 토큰은 서술어로 보고 통째로 버린다
const PREDICATE_ENDING_RE =
  /(습니다|입니다|합니다|됩니다|십시오|하세요|세요|어요|아요|에요|예요|았다|었다|였다|한다|된다|하다|되다|이다|하며|되며|하고|되고|하여|되어|해서|돼서|하면|되면|하지|되지|겠다|는다)$/;

const HANGUL_RE = /^[가-힣]+$/;

function stripJosa(token) {
  for (const josa of JOSA) {
    // 잔여가 2자 이상일 때만 스트리핑 → '종이', '교회' 같은 짧은 명사 보호
    if (token.length - josa.length >= 2 && token.endsWith(josa)) {
      return token.slice(0, -josa.length);
    }
  }
  return token;
}

export function tokenize(text) {
  const raw = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  const out = [];
  for (let token of raw) {
    if (HANGUL_RE.test(token)) {
      if (PREDICATE_ENDING_RE.test(token)) continue; // 서술어 폐기
      token = stripJosa(token);
    }
    if (token.length < 2) continue;
    if (STOPWORDS.has(token)) continue;
    out.push(token);
  }
  return out;
}
```

`extractKeywords` 내부에서 `tokenize(body)` 호출부는 그대로 동작한다(함수명 동일).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전부

- [ ] **Step 5: 검색 쿼리도 같은 토크나이저 사용** — `src/lib/utils.js`

`tokenizeQuery`를 교체 (조사 붙은 검색어 "하나님은"으로도 "하나님" 문서를 찾도록):

```js
import { tokenize } from '../vendor/keywords.js';

export function tokenizeQuery(value) {
  return tokenize(cleanText(value));
}
```

주의: `utils.js` 상단에 import 추가. 순환 참조 아님(keywords.js는 utils를 import하지 않음).

- [ ] **Step 6: 회귀 확인**

Run: `npm test && node src/cli.js ingest --source ./samples/acme-docs --workspace /tmp/p1-check --title Demo`
Expected: 테스트 PASS, ingest 정상, `concepts` 수가 기존(2)과 같거나 증가

- [ ] **Step 7: Commit**

```bash
git add src/vendor/keywords.js src/lib/utils.js test/keywords.test.js
git commit -m "feat: Korean-aware tokenizer with josa stripping and predicate filtering"
```

---

### Task 4: 개념 수 동적화 + --max-concepts CLI 옵션

**Files:**
- Modify: `src/lib/wiki-builder.js:105, 140`
- Modify: `src/cli.js:16, 28-41`
- Test: `test/keywords.test.js`에 추가 (defaultMaxConcepts는 wiki-builder에서 export)

**Interfaces:**
- Consumes: 없음
- Produces: `defaultMaxConcepts(docCount): number` (wiki-builder.js에서 export), `ingestWorkspace({ ..., maxConcepts })` 옵션 추가

- [ ] **Step 1: 실패하는 테스트 작성** — `test/keywords.test.js`에 추가

```js
import { defaultMaxConcepts } from '../src/lib/wiki-builder.js';

test('defaultMaxConcepts: 문서 수에 비례하되 14~80으로 클램프', () => {
  assert.equal(defaultMaxConcepts(7), 14);    // 소규모: 기존 동작 유지
  assert.equal(defaultMaxConcepts(100), 30);  // sqrt(100)*3
  assert.equal(defaultMaxConcepts(700), 79);  // round(sqrt(700)*3)
  assert.equal(defaultMaxConcepts(10000), 80); // 상한
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `defaultMaxConcepts` is not exported

- [ ] **Step 3: 구현** — `src/lib/wiki-builder.js`

함수 추가(파일 상단부, `topFolderFromRel` 아래):

```js
export function defaultMaxConcepts(docCount) {
  return Math.max(14, Math.min(80, Math.round(Math.sqrt(docCount) * 3)));
}
```

`ingestWorkspace` 시그니처에 `maxConcepts = null` 추가:

```js
export async function ingestWorkspace({ source, workspace, title = 'Company Knowledge OS', ollama = false, ollamaModel = DEFAULT_OLLAMA_MODEL, ollamaUrl = DEFAULT_OLLAMA_BASE_URL, maxConcepts = null }) {
```

하드코딩된 `.slice(0, 14)`(140행)를 교체:

```js
  const conceptCap = Number.isInteger(maxConcepts) && maxConcepts > 0 ? maxConcepts : defaultMaxConcepts(docs.length);
  const conceptNames = [...keywordFreq.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, conceptCap).map(([keyword]) => keyword);
```

- [ ] **Step 4: CLI 연결** — `src/cli.js`

ingest 분기의 `ingestWorkspace` 호출에 추가:

```js
      maxConcepts: args['max-concepts'] ? Number(args['max-concepts']) : null,
```

help 텍스트의 ingest 줄을 다음으로 교체:

```
  ingest --source ./docs --workspace ./workspace/company-os [--title ...] [--max-concepts 40] [--ollama --ollama-model llama3.2]
```

- [ ] **Step 5: 테스트 + 회귀 확인**

Run: `npm test && node src/cli.js ingest --source ./samples/acme-docs --workspace /tmp/p1-check --max-concepts 3 --title Demo`
Expected: 테스트 PASS, `"concepts"` ≤ 3

- [ ] **Step 6: Commit**

```bash
git add src/lib/wiki-builder.js src/cli.js test/keywords.test.js
git commit -m "feat: scale concept cap with corpus size, add --max-concepts option"
```

---

### Task 5: wikilink 해석 개선 — Obsidian식 (파일명 > 경로 > 제목)

**Files:**
- Create: `src/lib/link-resolver.js`
- Modify: `src/lib/wiki-builder.js:160-172`
- Test: `test/link-resolver.test.js`

**Interfaces:**
- Consumes: docs 배열 — 각 원소는 `{ id, file, title }` 필드를 가짐 (Task 1의 산출)
- Produces: `buildLinkResolver(docs): (rawTarget: string) => string | null` — wikilink 타깃 문자열을 doc id로 해석. `normalizeWikilinkTarget(raw): string` — `#헤딩`/`^블록` 참조 제거

**배경:** 현재는 frontmatter `title` 완전일치로만 해석해서 Obsidian vault의 링크(파일명 기준, `[[노트#섹션]]`, 대소문자 무관)가 대부분 유실된다. 해석 우선순위: ① 확장자 없는 상대경로 일치 ② 파일명(basename) 일치(중복 시 정렬 첫 번째 = 결정론적) ③ 제목 일치.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/link-resolver.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLinkResolver, normalizeWikilinkTarget } from '../src/lib/link-resolver.js';

const docs = [
  { id: 'doc:a', file: 'hr/온보딩 플레이북.md', title: '신입 온보딩 가이드' },
  { id: 'doc:b', file: 'sales/계약 프로세스.md', title: '계약 프로세스' },
  { id: 'doc:c', file: 'eng/온보딩 플레이북.md', title: '개발자 온보딩' },
];

test('normalizeWikilinkTarget: 헤딩/블록 참조 제거', () => {
  assert.equal(normalizeWikilinkTarget('온보딩 플레이북#첫 주'), '온보딩 플레이북');
  assert.equal(normalizeWikilinkTarget('노트^abc123'), '노트');
  assert.equal(normalizeWikilinkTarget('  공백  '), '공백');
});

test('resolver: 상대경로 일치가 최우선', () => {
  const resolve = buildLinkResolver(docs);
  assert.equal(resolve('hr/온보딩 플레이북'), 'doc:a');
  assert.equal(resolve('eng/온보딩 플레이북'), 'doc:c');
});

test('resolver: 파일명 일치 (중복이면 정렬 첫 번째)', () => {
  const resolve = buildLinkResolver(docs);
  // 'eng/...'가 'hr/...'보다 정렬상 앞 → doc:c
  assert.equal(resolve('온보딩 플레이북'), 'doc:c');
});

test('resolver: 제목 일치 fallback + 헤딩 무시 + 미해석은 null', () => {
  const resolve = buildLinkResolver(docs);
  assert.equal(resolve('신입 온보딩 가이드'), 'doc:a');
  assert.equal(resolve('계약 프로세스#결제'), 'doc:b');
  assert.equal(resolve('존재하지않는문서'), null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/link-resolver.js'`

- [ ] **Step 3: 구현** — `src/lib/link-resolver.js` 신규 생성

```js
// Obsidian 방식의 wikilink 해석: 경로 일치 > 파일명 일치 > 제목 일치.
// 파일명이 중복되면 file 경로 정렬상 첫 문서로 결정론적으로 해석한다.

export function normalizeWikilinkTarget(raw) {
  return String(raw || '').split('#')[0].split('^')[0].trim();
}

function stripExt(relPath) {
  return relPath.replace(/\.[^./]+$/, '');
}

export function buildLinkResolver(docs) {
  const byRel = new Map();
  const byBase = new Map();
  const byTitle = new Map();
  const sorted = [...docs].sort((a, b) => a.file.localeCompare(b.file));
  for (const doc of sorted) {
    const relNoExt = stripExt(doc.file).toLowerCase();
    if (!byRel.has(relNoExt)) byRel.set(relNoExt, doc.id);
    const base = relNoExt.split('/').pop();
    if (!byBase.has(base)) byBase.set(base, doc.id);
    const title = String(doc.title || '').toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, doc.id);
  }
  return (rawTarget) => {
    const target = normalizeWikilinkTarget(rawTarget).toLowerCase();
    if (!target) return null;
    return byRel.get(target) ?? byBase.get(target) ?? byTitle.get(target) ?? null;
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전부

- [ ] **Step 5: wiki-builder 연결** — `src/lib/wiki-builder.js`

import 추가: `import { buildLinkResolver } from './link-resolver.js';`

기존 `titleToId` 블록(160–172행)을 교체:

```js
  const resolveLink = buildLinkResolver(docs);
  const wikilinks = [];
  const seen = new Set();
  for (const doc of docs) {
    for (const targetTitle of doc.wikilinks) {
      const target = resolveLink(targetTitle);
      if (!target || target === doc.id) continue;
      const key = `${doc.id}=>${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wikilinks.push({ source: doc.id, target, kind: 'wikilink' });
    }
  }
```

- [ ] **Step 6: 회귀 확인**

Run: `npm test && node src/cli.js ingest --source ./samples/acme-docs --workspace /tmp/p1-check --title Demo`
Expected: 테스트 PASS, ingest 정상 (`links` 수가 기존 12 이상 — 샘플 문서의 wikilink가 더 많이 해석될 수 있음)

- [ ] **Step 7: Commit**

```bash
git add src/lib/link-resolver.js src/lib/wiki-builder.js test/link-resolver.test.js
git commit -m "feat: Obsidian-style wikilink resolution (path > basename > title)"
```

---

### Task 6: 한국어 fixture vault + 통합 테스트

**Files:**
- Create: `test/fixtures/ko-vault/설교/노트.md`
- Create: `test/fixtures/ko-vault/설교-노트.md`
- Create: `test/fixtures/ko-vault/설교/요한복음-강해.md`
- Create: `test/fixtures/ko-vault/목양/심방-기록.md`
- Create: `test/fixtures/ko-vault/목양/새가족-안내.md`
- Create: `test/fixtures/ko-vault/행정/재정-보고.md`
- Test: `test/integration.test.js`

**Interfaces:**
- Consumes: `ingestWorkspace` (Task 1–5의 전체 산출)
- Produces: 회귀 방지용 end-to-end 테스트 — 이후 Phase 2 작업의 안전망

- [ ] **Step 1: fixture 문서 작성**

`test/fixtures/ko-vault/설교/노트.md`:

```markdown
---
title: "설교: 준비 노트"
---
# 설교 준비 노트

하나님은 사랑이십니다. 하나님의 은혜를 묵상하며 설교를 준비합니다.
[[요한복음-강해]] 문서와 [[심방-기록#지난주]] 를 참고합니다.
```

`test/fixtures/ko-vault/설교-노트.md`:

```markdown
# 설교 노트 (루트)

하나님이 주신 말씀으로 설교합니다. 은혜가 넘칩니다.
```

`test/fixtures/ko-vault/설교/요한복음-강해.md`:

```markdown
# 요한복음 강해

하나님의 사랑과 은혜에 대한 강해입니다. 예배 중에 선포됩니다.
[[설교/노트]] 에서 이어집니다.
```

`test/fixtures/ko-vault/목양/심방-기록.md`:

```markdown
# 심방 기록

성도의 가정을 심방하며 하나님의 은혜를 나눕니다.

## 지난주
지난주 심방에서 예배와 기도로 성도를 격려했습니다.
```

`test/fixtures/ko-vault/목양/새가족-안내.md`:

```markdown
# 새가족 안내

새가족에게 예배 시간과 심방 절차를 안내합니다. 하나님의 사랑을 전합니다.
```

`test/fixtures/ko-vault/행정/재정-보고.md`:

```markdown
# 재정 보고

교회 재정을 보고합니다. 헌금은 하나님의 일에 사용됩니다.
```

- [ ] **Step 2: 통합 테스트 작성** — `test/integration.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { ingestWorkspace } from '../src/lib/wiki-builder.js';

const FIXTURE = new URL('./fixtures/ko-vault', import.meta.url).pathname;

test('한국어 vault end-to-end ingest', async (t) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'kowiki-'));
  const state = await ingestWorkspace({ source: FIXTURE, workspace: ws, title: '한국어 테스트' });

  await t.test('slug 충돌로 문서가 사라지지 않는다', () => {
    assert.equal(state.metrics.documents, 6);
    const slugs = state.documents.map((d) => d.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  await t.test('특수문자 제목이 YAML 왕복 후 보존된다', () => {
    const doc = state.documents.find((d) => d.source_path === '설교/노트.md');
    const page = fs.readFileSync(path.join(ws, doc.page_path), 'utf-8');
    assert.equal(matter(page).data.title, '설교: 준비 노트');
  });

  await t.test('개념에 조사 없는 명사가 뽑히고 서술어는 없다', () => {
    const names = state.concepts.map((c) => c.title);
    assert.ok(names.includes('하나님'), `개념 목록: ${names.join(', ')}`);
    assert.ok(!names.some((n) => /습니다$|입니다$|것입니다$/.test(n)));
    assert.ok(!names.includes('하나님은'));
    assert.ok(!names.includes('하나님의'));
  });

  await t.test('wikilink가 파일명/헤딩 포함 형태로 해석된다', () => {
    // 그래프 파일이 아닌 state 재검증: 링크 수 자체는 state.metrics.links에 합산됨
    // 문서 페이지에서 검증: 설교/노트.md → 요한복음-강해, 심방-기록 두 링크가 살아있어야 함
    assert.ok(state.metrics.links >= 2, `links=${state.metrics.links}`);
  });

  fs.rmSync(ws, { recursive: true, force: true });
});
```

- [ ] **Step 3: 실행 확인**

Run: `npm test`
Expected: PASS 전부 (integration 포함). 실패 시 해당 태스크로 돌아가 수정 — 특히 개념 추출 assert가 어긋나면 fixture의 단어 빈도(하나님 계열이 문서 2개 이상에 등장하는지)를 먼저 확인

- [ ] **Step 4: 데모 최종 스모크**

Run: `node src/cli.js demo` 후 브라우저 없이 확인:

```bash
curl -s http://127.0.0.1:3487/api/state | head -c 400
```

Expected: `"title":"Acme Knowledge OS"` 포함 JSON. 확인 후 프로세스 종료.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures test/integration.test.js
git commit -m "test: Korean vault end-to-end integration coverage"
```

---

### Task 7: 마무리 — 문서화 + 푸시

**Files:**
- Modify: `README.md` (한국어 처리 개선 노트 + `--max-concepts` 문서화)
- Modify: `WORK_PLAN.md` (진행 상황 기록)

- [ ] **Step 1: README에 변경 사항 반영**

"Options" 또는 usage 섹션에 `--max-concepts` 설명 한 줄, "Korean support" 단락 추가 (조사 스트리핑 기반 키워드 추출, 형태소 분석기 없는 휴리스틱임을 명시).

- [ ] **Step 2: 전체 테스트 + 데모 최종 확인**

Run: `npm test && node src/cli.js ingest --source ./samples/acme-docs --workspace /tmp/p1-final --title Demo`
Expected: 전부 PASS

- [ ] **Step 3: Commit + Push**

```bash
git add README.md WORK_PLAN.md
git commit -m "docs: document Korean tokenizer heuristics and --max-concepts"
# push 전 Gospel-Lab 계정 확인
gh auth status
git push -u origin feat/phase1-korean-integrity
```

주의: 활성 gh 계정이 Gospel-Lab이 아니면 `gh auth switch -u Gospel-Lab` 먼저.

- [ ] **Step 4: 메모리 갱신**

`~/.claude/projects/-Users-seonwoo/memory/project_knowledge_os_wiki.md`에 Phase 1 완료 상태·브랜치명·남은 Phase 기록.

---

## Self-Review 체크 결과

- **Spec coverage:** Phase 1 항목 5개(토크나이저·slug·YAML·wikilink·개념 수) 모두 Task 1–5에 대응. NFC 버그는 리뷰 중 발견되어 Task 1에 포함.
- **Out of scope (Phase 2+로 명시적 이월):** 증분 ingest, Ollama 병렬화/캐시, 그래프 본문 lazy화, CDN 번들링, BM25/임베딩 검색, `/api/open`, linker.js 제거, LICENSE 파일.
- **Type consistency:** doc 객체 필드(`id`, `slug`, `file`, `title`, `department`, `keywords`, `relatedConcepts`, `summary`, `body`)가 Task 1 정의와 Task 2/5 소비 지점에서 일치함을 확인.
