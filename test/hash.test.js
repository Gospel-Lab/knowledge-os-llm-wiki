import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHash } from '../src/lib/hash.js';

test('contentHash: 동일 입력 동일 해시, 다른 입력 다른 해시', () => {
  assert.equal(contentHash('hello'), contentHash('hello'));
  assert.notEqual(contentHash('hello'), contentHash('world'));
  assert.match(contentHash('x'), /^[0-9a-f]{40}$/);
});

test('contentHash: NFC/NFD 정규화 후 해시 (한국어 안정)', () => {
  assert.equal(contentHash('은혜'.normalize('NFC')), contentHash('은혜'.normalize('NFD')));
});
