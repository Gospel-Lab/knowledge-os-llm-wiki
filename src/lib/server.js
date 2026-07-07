import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { renderDashboardHtml } from './dashboard-template.js';
import { readJson, scoreByTokenOverlap } from './utils.js';
import { checkOllama, normalizeOllamaBaseUrl, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '../vendor/ollama.js';

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.md')) return 'text/markdown; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function askOllama({ question, sources, baseUrl, model }) {
  const status = await checkOllama({ baseUrl, model, timeoutMs: 2500 });
  if (!status.ok || !status.modelAvailable) return null;
  const prompt = [
    'You are an internal company knowledge assistant.',
    'Answer in Korean.',
    'Use only the evidence below. If something is not supported, say it is not yet documented.',
    '',
    `Question: ${question}`,
    '',
    'Evidence:',
    ...sources.map((src, idx) => `${idx + 1}. ${src.title} [${src.department}]\nSummary: ${src.summary}\nKeywords: ${(src.keywords || []).join(', ')}\nExcerpt: ${src.body_preview || ''}`)
  ].join('\n');
  const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.1 } })
  });
  const json = await response.json();
  return String(json.response || '').trim();
}

export function startServer({ workspace, port = 3487, host = '127.0.0.1' }) {
  const statePath = path.join(workspace, 'state.json');
  const state = readJson(statePath);
  if (!state) throw new Error(`state.json not found in ${workspace}`);
  const workspaceRoot = path.resolve(workspace);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderDashboardHtml(state.title));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(state));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/doc/')) {
      const slug = decodeURIComponent(url.pathname.split('/').pop());
      const doc = state.documents.find((item) => item.slug === slug);
      if (!doc) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Document not found' }));
        return;
      }
      const contract = readJson(path.join(workspaceRoot, doc.contract_path), {});
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ document: doc, contract }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const { question = '' } = JSON.parse(body || '{}');
          const ranked = scoreByTokenOverlap(question, state.documents, ['title', 'summary', 'department', 'source_path', 'body_preview'])
            .filter((row) => row.score > 0)
            .slice(0, 5)
            .map((row) => row.item);
          const sources = ranked.length ? ranked : state.documents.slice(0, 5);
          const baseUrl = state.settings?.ollamaUrl || process.env.OLLAMA_URL || DEFAULT_OLLAMA_BASE_URL;
          const model = state.settings?.ollamaModel || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
          const answer = await askOllama({ question, sources, baseUrl, model }).catch(() => null);
          const fallback = [
            `질문: ${question}`,
            '',
            '현재 선택된 근거 문서:',
            ...sources.map((src) => `- ${src.title} (${src.department}) — ${src.summary}`),
            '',
            'Ollama가 연결되지 않았거나 모델이 없어, 우선 관련 문서 묶음을 제시했습니다.'
          ].join('\n');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ answer: answer || fallback, sources }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    const filePath = path.join(workspaceRoot, url.pathname.replace(/^\/+/, ''));
    if (filePath.startsWith(workspaceRoot) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      res.end(fs.readFileSync(filePath));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({ server, url: `http://${host}:${port}` });
    });
  });
}
