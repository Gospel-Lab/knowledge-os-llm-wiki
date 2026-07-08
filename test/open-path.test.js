import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenTarget } from '../src/lib/open-path.js';

const roots = { source: '/data/src', workspace: '/data/ws' };

test('resolveOpenTarget: source 하위 경로 허용', () => {
  const r = resolveOpenTarget('/data/src/a/b.md', roots);
  assert.equal(r.ok, true);
  assert.equal(r.path, '/data/src/a/b.md');
});

test('resolveOpenTarget: workspace 하위 허용', () => {
  assert.equal(resolveOpenTarget('/data/ws/graph/x.html', roots).ok, true);
});

test('resolveOpenTarget: 범위 밖 거부', () => {
  assert.equal(resolveOpenTarget('/etc/passwd', roots).ok, false);
});

test('resolveOpenTarget: .. 이스케이프 거부', () => {
  assert.equal(resolveOpenTarget('/data/src/../../etc/passwd', roots).ok, false);
});

test('resolveOpenTarget: prefix 유사경로 오탐 방지 (/data/src-evil)', () => {
  // /data/src-evil 은 /data/src 의 하위가 아니다
  assert.equal(resolveOpenTarget('/data/src-evil/x', roots).ok, false);
});

test('resolveOpenTarget: 빈 입력 거부', () => {
  assert.equal(resolveOpenTarget('', roots).ok, false);
});
