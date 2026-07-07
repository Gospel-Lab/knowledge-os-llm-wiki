# Knowledge OS LLM Wiki

회사 문서를 **LLM Wiki(지속적으로 축적되는 위키)**와 **Knowledge Graph(시각적 탐색)**로 연결하는 로컬 우선 MVP입니다.

핵심 아이디어는 Karpathy의 LLM Wiki 패턴처럼 문서를 매번 RAG로만 재해석하지 않고,
문서를 한 번 읽어 **문서 페이지 / 개념 페이지 / 검색 계약 / 그래프**라는 지속적 산출물로 컴파일해두는 것입니다.

이 프로젝트는 `wikigraph3d`의 문서 추출·그래프 렌더링 아이디어를 바탕으로,
회사 내부 지식 운영에 필요한 위키 구조와 대시보드를 덧붙였습니다.

## 포함 기능

- PDF / DOCX / PPTX / Markdown / TXT 문서 스캔
- 문서별 위키 페이지 자동 생성
- 개념(Concept) 페이지 자동 생성
- 검색 계약(Search Contract) JSON 생성
- 문서-개념-문서 관계를 3D 그래프로 시각화
- 브라우저 대시보드에서 검색 / 문서 탐색 / 그래프 탐색
- 선택형 로컬 Ollama 질의응답

## Phase 2: 성능 및 확장성 개선

**오프라인 우선 (Offline-First)**: 생성된 3D 그래프가 쓰는 브라우저 라이브러리 5종(Three.js, 3d-force-graph, marked, Fuse.js, DOMPurify)을 로컬에 벤더링하고 Google Fonts는 시스템 폰트 스택으로 대체하여, CDN·웹폰트 의존성을 모두 제거했습니다. 인터넷이 끊겨도 그래프 렌더링이 완전히 작동합니다.

**증분 re-ingest**: 콘텐츠 해시 매니페스트를 통해 이미 처리한 파일은 다시 추출하지 않고 건너뜁니다. 삭제된 소스의 산출물은 자동으로 정리됩니다. 같은 파일을 여러 번 ingest해도 생성된 문서의 타임스탬프가 보존되므로 불필요한 변경 추적이 없습니다.

**Ollama 캐싱 및 병렬화**: 문서 요약·태그 보강 결과를 콘텐츠 해시로 캐싱하여, 내용이 바뀌지 않은 문서는 Ollama를 다시 호출하지 않습니다. 또한 미처리 문서의 Ollama 호출을 병렬(기본 4개 동시)로 처리하여 대규모 문서 보강 속도를 향상시킵니다.

## 프로젝트 구조

- `samples/acme-docs/` — 데모용 회사 문서 샘플
- `src/cli.js` — CLI 엔트리포인트
- `src/lib/wiki-builder.js` — ingest 파이프라인
- `src/lib/server.js` — 로컬 대시보드 서버
- `src/vendor/` — `wikigraph3d`에서 가져온 그래프/키워드/렌더러 코어
- `workspace/` — 생성 결과물 위치(기본 `.gitignore` 처리)

## 빠른 시작

```bash
npm install
npm run demo
```

위 명령은 아래를 자동으로 실행합니다.

1. `workspace/acme-knowledge-os` 초기화
2. `samples/acme-docs` ingest
3. 대시보드 시작 (`http://127.0.0.1:3487`)

## 수동 사용법

### 1) 워크스페이스 초기화

```bash
npm run init -- --workspace ./workspace/company-os --title "Company Knowledge OS"
```

### 2) 회사 문서 ingest

```bash
npm run ingest -- \
  --source /path/to/company-docs \
  --workspace ./workspace/company-os \
  --title "Company Knowledge OS"
```

**옵션:**
- `--max-concepts N` — 추출할 최대 개념 수 (기본값: `max(14, min(80, round(sqrt(docCount)*3)))`)

Ollama가 있으면 문서 요약을 더 풍부하게 붙일 수 있습니다.

```bash
npm run ingest -- \
  --source /path/to/company-docs \
  --workspace ./workspace/company-os \
  --title "Company Knowledge OS" \
  --ollama \
  --ollama-model llama3.2
```

### 3) 대시보드 실행

```bash
npm run serve -- --workspace ./workspace/company-os --port 3487
```

## 생성 산출물

워크스페이스 아래에 다음이 생성됩니다.

- `docs/documents/*.md` — 문서 위키 페이지
- `docs/concepts/*.md` — 개념 위키 페이지
- `raw/imports/*.md` — 원문 보존용 마크다운
- `contracts/*.json` — 검색 계약
- `graph/company-knowledge-graph.html` — 3D 그래프
- `state.json` — 대시보드용 인덱스/메타데이터

## 아키텍처 요약

```text
회사 자료 폴더
  -> 텍스트 추출
  -> 키워드/관계 계산
  -> 문서 위키 페이지 생성
  -> 개념 페이지 생성
  -> Search Contract 생성
  -> Graph HTML 생성
  -> 브라우저 대시보드 + Ollama 질문응답
```

## 한국어 지원

이 프로젝트는 한국어 문서 처리에 최적화되어 있습니다:

- **휴리스틱 기반 키워드 추출**: 한국어 조사(은/는, 가/이, 를/을 등)를 자동 제거하고, 2글자 이상 어근만 보존합니다. 형태소 분석기를 사용하지 않으며, 정확도는 규칙 기반 휴리스틱입니다.
- **안전한 파일명 변환**: NFC 정규화를 거친 충돌 없는 슬러그(slug) 생성; Obsidian 호환 wikilink 해석(경로 > 파일명 > 제목 우선순위)
- **테스트**: `npm test`로 단위 테스트 실행 (한국어 end-to-end 포함)

## 한계

- 현재 개념 추출은 규칙 기반 키워드 집계 중심입니다.
- OCR은 포함하지 않습니다.
- 정적 생성 중심이라 실시간 동기화는 아직 없습니다.
- 대시보드의 AI Ask는 로컬 Ollama 연결 시에만 완전한 답변을 생성합니다.

## 다음 확장 후보

- Notion Export / Git repo 전용 인제스터
- 조직도/담당자 노드 타입 추가
- 중복 문서 탐지와 지식 공백 리포트
- 승인 워크플로우(인간 검수 후 wiki merge)
