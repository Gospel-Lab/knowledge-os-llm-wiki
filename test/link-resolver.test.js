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

test('resolver: NFD 파일명 ↔ NFC 링크 타깃도 해석된다 (macOS)', () => {
  const nfdDocs = [
    { id: 'doc:nfd', file: `${'설교노트'.normalize('NFD')}.md`, title: '설교노트'.normalize('NFD') },
  ];
  const resolve = buildLinkResolver(nfdDocs);
  assert.equal(resolve('설교노트'.normalize('NFC')), 'doc:nfd');
  assert.equal(resolve('설교노트'.normalize('NFD')), 'doc:nfd');
});
