import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/lib/utils.js';

test('slugify: 기본 동작', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify(''), 'untitled');
});
