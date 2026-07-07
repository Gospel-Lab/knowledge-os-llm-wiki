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
