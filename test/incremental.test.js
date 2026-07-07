import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestWorkspace } from '../src/lib/wiki-builder.js';

function mkSource() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
  fs.mkdirSync(path.join(dir, 'a'));
  fs.writeFileSync(path.join(dir, 'a', 'one.md'), '# 하나\n하나님의 은혜와 사랑. 예배를 드립니다.');
  fs.writeFileSync(path.join(dir, 'a', 'two.md'), '# 둘\n하나님은 사랑이시다. 은혜가 넘칩니다. 예배와 기도.');
  return dir;
}

test('증분: 변경 없는 재-ingest는 문서 페이지를 바이트 동일하게 유지', async () => {
  const src = mkSource();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  try {
    await ingestWorkspace({ source: src, workspace: ws, title: 'T' });
    const p = path.join(ws, 'docs', 'documents');
    const before = Object.fromEntries(fs.readdirSync(p).map((f) => [f, fs.readFileSync(path.join(p, f), 'utf-8')]));
    await ingestWorkspace({ source: src, workspace: ws, title: 'T' });
    const after = Object.fromEntries(fs.readdirSync(p).map((f) => [f, fs.readFileSync(path.join(p, f), 'utf-8')]));
    assert.deepEqual(after, before, '재-ingest가 파일을 바꾸지 않아야 함(updated_at 보존)');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('증분: 소스 삭제 시 orphan 산출물이 제거된다', async () => {
  const src = mkSource();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  try {
    const s1 = await ingestWorkspace({ source: src, workspace: ws, title: 'T' });
    assert.equal(s1.metrics.documents, 2);
    // two.md 삭제 후 재-ingest
    fs.rmSync(path.join(src, 'a', 'two.md'));
    const s2 = await ingestWorkspace({ source: src, workspace: ws, title: 'T' });
    assert.equal(s2.metrics.documents, 1);
    const remaining = fs.readdirSync(path.join(ws, 'docs', 'documents'));
    assert.equal(remaining.length, 1, `orphan 남음: ${remaining.join(',')}`);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
