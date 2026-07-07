import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestWorkspace } from '../src/lib/wiki-builder.js';

const FIXTURE = new URL('./fixtures/ko-vault', import.meta.url).pathname;

test('오프라인: 그래프 HTML에 외부 fetch URL이 없고 vendor 자산이 복사된다', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-'));
  try {
    await ingestWorkspace({ source: FIXTURE, workspace: ws, title: '오프라인 테스트' });
    const html = fs.readFileSync(path.join(ws, 'graph', 'company-knowledge-graph.html'), 'utf-8');
    // <script src="https://...">가 없어야 한다 (attribution <a href> 앵커는 리소스 로드가 아니므로 제외)
    assert.deepEqual(html.match(/<script[^>]+src=["']https?:/gi), null, '외부 script 없어야 함');
    // Google Fonts <link>가 없어야 한다
    assert.equal(/<link[^>]+href=["']https?:\/\/fonts\.googleapis/i.test(html), false, 'Google Fonts 없어야 함');
    // vendor 자산 5종이 실제로 복사되어야 한다
    for (const f of ['three.min.js', '3d-force-graph.min.js', 'marked.min.js', 'fuse.min.js', 'purify.min.js']) {
      assert.ok(fs.existsSync(path.join(ws, 'graph', 'vendor', f)), `${f} 복사됨`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
