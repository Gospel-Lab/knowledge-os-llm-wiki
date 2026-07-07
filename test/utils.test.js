import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, createSlugger } from '../src/lib/utils.js';

test('slugify: 기본 동작', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify(''), 'untitled');
});

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
