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
