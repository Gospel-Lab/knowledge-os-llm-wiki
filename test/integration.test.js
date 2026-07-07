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
  try {
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
      assert.ok(state.metrics.links >= 2, `links=${state.metrics.links}`);

      // metrics.links는 wikilink/folder/similar/semantic/concept 5종을 모두 합산하므로
      // (이 fixture에서 wikilink 외 종류만 합쳐도 34개) 위 카운트만으로는 wikilink 해석이
      // 완전히 깨져도 통과할 수 있다. 그래프 HTML에 박힌 DATA.links를 직접 읽어
      // kind==='wikilink' 엣지가 정확히 기대한 3개인지 검증한다.
      const graphHtml = fs.readFileSync(path.join(ws, state.graph.file), 'utf-8');
      const dataMatch = graphHtml.match(/const DATA = (\{.*?\});\n/s);
      assert.ok(dataMatch, 'graph HTML embeds DATA');
      const graphData = JSON.parse(dataMatch[1]);
      const wikilinks = graphData.links.filter((l) => l.kind === 'wikilink');

      const idOf = (sourcePath) => {
        const doc = state.documents.find((d) => d.source_path === sourcePath);
        assert.ok(doc, `document not found for ${sourcePath}`);
        return `doc:${doc.slug}`;
      };
      const noteId = idOf('설교/노트.md');
      const sermonId = idOf('설교/요한복음-강해.md');
      const visitId = idOf('목양/심방-기록.md');

      const expectedEdges = [
        // [[요한복음-강해]]
        { source: noteId, target: sermonId },
        // [[심방-기록#지난주]] — 헤딩이 잘려나가야 함
        { source: noteId, target: visitId },
        // [[설교/노트]] — 경로 형태
        { source: sermonId, target: noteId },
      ];

      for (const expected of expectedEdges) {
        assert.ok(
          wikilinks.some((l) => l.source === expected.source && l.target === expected.target),
          `expected wikilink edge ${expected.source} -> ${expected.target} not found (got: ${JSON.stringify(wikilinks)})`
        );
      }
      assert.equal(wikilinks.length, 3, `wikilinks=${JSON.stringify(wikilinks)}`);
    });
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
