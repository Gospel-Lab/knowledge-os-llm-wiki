#!/usr/bin/env node
import path from 'node:path';
import { initWorkspace, ingestWorkspace } from './lib/wiki-builder.js';
import { startServer } from './lib/server.js';
import { parseArgs } from './lib/utils.js';

const [command = 'help', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

function value(name, fallback) {
  return args[name] ?? fallback;
}

async function main() {
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`knowledge-os commands:\n\n  init   --workspace ./workspace/company-os --title \"Company Knowledge OS\"\n  ingest --source ./docs --workspace ./workspace/company-os [--title ...] [--max-concepts 40] [--ollama --ollama-model llama3.2]\n  serve  --workspace ./workspace/company-os [--port 3487]\n  demo   # sample docs -> ingest -> serve\n`);
    return;
  }

  if (command === 'init') {
    const workspace = path.resolve(value('workspace', './workspace/company-os'));
    const title = value('title', 'Company Knowledge OS');
    await initWorkspace(workspace, title);
    console.log(JSON.stringify({ ok: true, command, workspace, title }, null, 2));
    return;
  }

  if (command === 'ingest') {
    const source = value('source', null);
    if (!source) throw new Error('--source is required for ingest');
    const result = await ingestWorkspace({
      source: path.resolve(source),
      workspace: path.resolve(value('workspace', './workspace/company-os')),
      title: value('title', 'Company Knowledge OS'),
      ollama: Boolean(args.ollama),
      ollamaModel: value('ollama-model', 'llama3.2'),
      ollamaUrl: value('ollama-url', 'http://127.0.0.1:11434'),
      maxConcepts: typeof args['max-concepts'] === 'string' ? Number(args['max-concepts']) : null,
    });
    console.log(JSON.stringify({ ok: true, command, metrics: result.metrics, workspace: result.workspace }, null, 2));
    return;
  }

  if (command === 'serve') {
    const workspace = path.resolve(value('workspace', './workspace/company-os'));
    const port = Number(value('port', 3487));
    const host = value('host', '127.0.0.1');
    const { url } = await startServer({ workspace, port, host });
    console.log(JSON.stringify({ ok: true, command, workspace, url }, null, 2));
    return;
  }

  if (command === 'demo') {
    const workspace = path.resolve('./workspace/acme-knowledge-os');
    const source = path.resolve('./samples/acme-docs');
    await initWorkspace(workspace, 'Acme Knowledge OS');
    const result = await ingestWorkspace({ source, workspace, title: 'Acme Knowledge OS' });
    const { url } = await startServer({ workspace, port: 3487, host: '127.0.0.1' });
    console.log(JSON.stringify({ ok: true, command, metrics: result.metrics, url }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
