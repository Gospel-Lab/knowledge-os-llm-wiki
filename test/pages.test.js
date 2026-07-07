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
