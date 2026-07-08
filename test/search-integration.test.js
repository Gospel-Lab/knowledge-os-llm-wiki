import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestWorkspace } from '../src/lib/wiki-builder.js';
import { buildBm25Index, searchBm25 } from '../src/lib/bm25.js';
import { tokenize } from '../src/vendor/keywords.js';

const FIXTURE = new URL('./fixtures/ko-vault', import.meta.url).pathname;

test('BM25: 한국어 fixture에서 질의가 관련 문서를 랭크', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-'));
  try {
    await ingestWorkspace({ source: FIXTURE, workspace: ws, title: 'T' });
    const index = JSON.parse(fs.readFileSync(path.join(ws, 'search-index.json'), 'utf-8'));
    assert.ok(index.N >= 6);
    const ranked = searchBm25(index, tokenize('하나님 은혜'), 10);
    assert.ok(ranked.length > 0, '하나님 은혜 질의가 결과를 반환해야 함');
    // 상위 문서는 실제로 그 토큰을 포함해야 함
    assert.ok(ranked[0].score > 0);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('Ollama-optional 불변식: --ollama 없이도 개념이 생성된다', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-'));
  try {
    const state = await ingestWorkspace({ source: FIXTURE, workspace: ws, title: 'T' });
    assert.ok(state.metrics.concepts > 0, `개념 0개 — 폴백 실패: ${state.metrics.concepts}`);
    assert.ok(state.metrics.documents >= 6);
    assert.ok(fs.existsSync(path.join(ws, 'search-index.json')));
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
