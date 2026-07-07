# knowledge-os-llm-wiki 작업계획서

## 프로젝트 개요
- 원본: leejun-cloud/knowledge-os-llm-wiki → 작업 포크: **Gospel-Lab/knowledge-os-llm-wiki**
- 정체: 문서 폴더 → LLM Wiki + Search Contract + 3D 지식그래프 + 로컬 대시보드 컴파일러
- 목표: 한국어 문서(교회 사역·Obsidian vault)에 실사용 가능한 수준으로 고도화

## 전체 로드맵
| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 1 | 한국어 토크나이저(조사 스트리핑)·slug 충돌·YAML 안전화·wikilink 파일명 해석·개념 수 동적화 | ✅ 완료 (2026-07-07) |
| Phase 2 | 해시 기반 증분 ingest, Ollama 병렬+캐시, 그래프 본문 lazy 로드, CDN vendoring | 대기 |
| Phase 3 | BM25 전문 검색, Ollama 임베딩(bge-m3) 기반 개념 클러스터링, AI questions → Search Contract 연결 | 대기 |
| Phase 4 | CI, LICENSE, 데드코드(linker.js) 제거, /api/open 구현 | 대기 |

## Phase 1 상세 계획
→ `docs/plans/2026-07-07-phase1-korean-integrity.md` (Task 0~7, TDD, node:test)

## 작업 로그
- **2026-07-07 (오전)**: 원본 레포 전수 분석 + 한국어 700문서 스트레스 테스트 → 치명적 문제 7건 발견
- **2026-07-07 (저녁)**: Gospel-Lab 포크를 `~/Documents/GitHub`에 클론, 2차 정밀 리뷰로 추가 버그 8건 발견(YAML 미이스케이프, Ollama questions 폐기, wikilink title-only 해석, slug NFD 잔류 등), Phase 1 구현 계획 작성
- **2026-07-07 (밤)**: Phase 1 구현 완료 — Task 0~7, 리뷰 게이트 통과, 테스트 21개 (커밋 02684c0..HEAD)

## 주의 사항
- push는 Gospel-Lab gh 계정으로만 (`gh auth switch -u Gospel-Lab`)
- 새 의존성 추가 금지 (로컬 우선 철학), 테스트는 node:test 내장 러너
- 상세 발견 사항: `~/.claude/projects/-Users-seonwoo/memory/project_knowledge_os_wiki.md`
