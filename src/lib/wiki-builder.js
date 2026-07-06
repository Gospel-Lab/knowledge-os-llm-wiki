import fs from 'node:fs';
import path from 'node:path';
import { extractFolder } from './extractor.js';
import { extractKeywords, keywordSimilarityLinks } from '../vendor/keywords.js';
import { renderHtml } from '../vendor/render.js';
import { summarizeNodeWithOllama, checkOllama, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '../vendor/ollama.js';
import { ensureDir, slugify, excerpt, nowIso, writeJson } from './utils.js';

function topFolderFromRel(relPath) {
  const parts = relPath.split('/');
  return parts.length > 1 ? parts[0] : '(root)';
}

function folderSiblingLinks(nodes) {
  const byFolder = new Map();
  for (const node of nodes) {
    if (!byFolder.has(node.folder)) byFolder.set(node.folder, []);
    byFolder.get(node.folder).push(node.id);
  }
  const links = [];
  for (const ids of byFolder.values()) {
    if (ids.length < 2 || ids.length > 20) continue;
    ids.sort().forEach((id, i) => {
      links.push({ source: id, target: ids[(i + 1) % ids.length], kind: 'folder' });
    });
  }
  return links;
}

function inferQuestions(title, keywords, department) {
  const head = keywords.slice(0, 3);
  return [
    `${title} 문서는 어떤 업무를 설명하나요?`,
    `${department} 관점에서 ${head.join(', ')} 관련 참고 문서는 무엇인가요?`,
    `${title}와 연결된 정책/프로세스/FAQ는 무엇인가요?`
  ];
}

function buildSearchContract(doc, relatedDocs, relatedConcepts) {
  return {
    id: doc.slug,
    title: doc.title,
    source_path: doc.file,
    department: doc.department,
    document_type: doc.ext,
    summary: doc.summary,
    keywords: doc.keywords,
    related_documents: relatedDocs.map((item) => item.slug),
    related_concepts: relatedConcepts,
    search_questions: inferQuestions(doc.title, doc.keywords, doc.department),
  };
}

function frontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${String(item).replace(/\n/g, ' ')}`);
    } else {
      lines.push(`${key}: ${String(value).replace(/\n/g, ' ')}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

async function maybeEnrichWithOllama(nodes, options) {
  if (!options.ollama) return { ok: false, enabled: false };
  const status = await checkOllama({ baseUrl: options.ollamaUrl, model: options.ollamaModel });
  if (!status.ok || !status.modelAvailable) return { ok: false, enabled: true, status };
  for (const node of nodes) {
    try {
      node.ai = await summarizeNodeWithOllama(node, { baseUrl: options.ollamaUrl, model: options.ollamaModel });
    } catch (error) {
      node.ai = { error: error.message, model: options.ollamaModel };
    }
  }
  return { ok: true, enabled: true, status };
}

export async function initWorkspace(workspaceRoot, title = 'Company Knowledge OS') {
  const dirs = ['docs/documents', 'docs/concepts', 'raw/imports', 'contracts', 'graph', '.llmwiki'];
  for (const dir of dirs) ensureDir(path.join(workspaceRoot, dir));
  fs.writeFileSync(path.join(workspaceRoot, '.llmwiki', 'workspace.json'), JSON.stringify({ title, created_at: nowIso() }, null, 2));
  fs.writeFileSync(path.join(workspaceRoot, 'README.md'), [
    `# ${title}`,
    '',
    '이 워크스페이스는 회사 문서를 LLM Wiki + Knowledge Graph 형태로 컴파일한 결과물입니다.',
    '',
    '- `docs/documents/`: 문서 페이지',
    '- `docs/concepts/`: 개념 페이지',
    '- `contracts/`: Search Contract',
    '- `graph/`: 시각화 결과',
    '- `raw/imports/`: 원문 보존본',
    ''
  ].join('\n'));
  return { workspaceRoot, title };
}

export async function ingestWorkspace({ source, workspace, title = 'Company Knowledge OS', ollama = false, ollamaModel = DEFAULT_OLLAMA_MODEL, ollamaUrl = DEFAULT_OLLAMA_BASE_URL }) {
  ensureDir(workspace);
  await initWorkspace(workspace, title);
  const extracted = await extractFolder(source);
  const docs = extracted.map(({ filePath, result }) => {
    const rel = path.relative(source, filePath).split(path.sep).join('/');
    const name = path.basename(filePath, path.extname(filePath));
    return {
      id: `doc:${slugify(rel)}`,
      slug: slugify(rel),
      title: result.title || name,
      file: rel,
      absolutePath: path.resolve(filePath),
      ext: path.extname(filePath).toLowerCase().replace(/^\./, ''),
      department: topFolderFromRel(rel),
      folder: topFolderFromRel(rel),
      body: result.body.trim(),
      wikilinks: result.wikilinks || [],
    };
  });

  const keywordSets = extractKeywords(docs.map((doc) => doc.body), 8);
  docs.forEach((doc, index) => {
    doc.keywords = keywordSets[index] || [];
    doc.summary = excerpt(doc.body, 240);
  });

  await maybeEnrichWithOllama(docs, { ollama, ollamaModel, ollamaUrl });
  docs.forEach((doc) => {
    if (doc.ai?.summary) doc.summary = doc.ai.summary;
    if (doc.ai?.tags?.length) doc.keywords = unique([...doc.ai.tags, ...doc.keywords]).slice(0, 8);
  });

  const keywordFreq = new Map();
  for (const doc of docs) unique(doc.keywords).forEach((keyword) => keywordFreq.set(keyword, (keywordFreq.get(keyword) || 0) + 1));
  const conceptNames = [...keywordFreq.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([keyword]) => keyword);

  const concepts = conceptNames.map((name) => {
    const slug = slugify(name);
    const relatedDocs = docs.filter((doc) => doc.keywords.includes(name));
    return {
      id: `concept:${slug}`,
      slug,
      title: name,
      type: 'Concept',
      folder: 'Concepts',
      file: `concepts/${slug}.md`,
      absolutePath: path.join(workspace, 'docs', 'concepts', `${slug}.md`),
      body: `${name} 관련 핵심 문서: ${relatedDocs.map((doc) => doc.title).join(', ')}`,
      summary: `${name}는 ${relatedDocs.length}개 문서에 걸쳐 반복적으로 등장하는 핵심 개념입니다.`,
      keywords: unique(relatedDocs.flatMap((doc) => doc.keywords)).slice(0, 8),
      relatedDocs,
    };
  });

  const titleToId = new Map(docs.map((doc) => [doc.title, doc.id]));
  const wikilinks = [];
  const seen = new Set();
  for (const doc of docs) {
    for (const targetTitle of doc.wikilinks) {
      const target = titleToId.get(targetTitle);
      if (!target || target === doc.id) continue;
      const key = `${doc.id}=>${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wikilinks.push({ source: doc.id, target, kind: 'wikilink' });
    }
  }

  const similarLinks = keywordSimilarityLinks(docs.map((doc) => doc.id), docs.map((doc) => doc.keywords), 2);
  const folderLinks = folderSiblingLinks(docs);
  const conceptLinks = [];
  const conceptCooccur = [];

  for (const doc of docs) {
    doc.relatedConcepts = concepts.filter((concept) => doc.keywords.includes(concept.title)).map((concept) => concept.slug);
  }
  for (const concept of concepts) {
    for (const doc of concept.relatedDocs) conceptLinks.push({ source: doc.id, target: concept.id, kind: 'semantic' });
  }
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const shared = concepts[i].relatedDocs.filter((doc) => concepts[j].relatedDocs.some((other) => other.slug === doc.slug)).length;
      if (shared >= 2) conceptCooccur.push({ source: concepts[i].id, target: concepts[j].id, kind: 'concept' });
    }
  }

  for (const doc of docs) {
    const relatedDocs = similarLinks.filter((link) => link.source === doc.id || link.target === doc.id)
      .map((link) => (link.source === doc.id ? link.target : link.source))
      .map((id) => docs.find((item) => item.id === id))
      .filter(Boolean)
      .slice(0, 4);
    const contract = buildSearchContract(doc, relatedDocs, doc.relatedConcepts);
    const docPage = [
      frontmatter({ title: doc.title, source_path: doc.file, department: doc.department, keywords: doc.keywords, related_concepts: doc.relatedConcepts, updated_at: nowIso() }),
      `# ${doc.title}`,
      '',
      '## Summary',
      doc.summary,
      '',
      '## Search Contract',
      '```json',
      JSON.stringify(contract, null, 2),
      '```',
      '',
      '## Related Concepts',
      ...(doc.relatedConcepts.length ? doc.relatedConcepts.map((slug) => `- [[${slug}]]`) : ['- 없음']),
      '',
      '## Source Excerpt',
      doc.body.slice(0, 4000),
      ''
    ].join('\n');
    const rawPage = [frontmatter({ title: doc.title, source_path: doc.file, imported_at: nowIso() }), doc.body, ''].join('\n');
    fs.writeFileSync(path.join(workspace, 'docs', 'documents', `${doc.slug}.md`), docPage, 'utf-8');
    fs.writeFileSync(path.join(workspace, 'raw', 'imports', `${doc.slug}.md`), rawPage, 'utf-8');
    writeJson(path.join(workspace, 'contracts', `${doc.slug}.json`), contract);
  }

  for (const concept of concepts) {
    const conceptPage = [
      frontmatter({ title: concept.title, kind: 'concept', related_documents: concept.relatedDocs.map((doc) => doc.slug), keywords: concept.keywords, updated_at: nowIso() }),
      `# ${concept.title}`,
      '',
      concept.summary,
      '',
      '## Related Documents',
      ...concept.relatedDocs.map((doc) => `- [[${doc.slug}]] — ${doc.summary}`),
      ''
    ].join('\n');
    fs.writeFileSync(path.join(workspace, 'docs', 'concepts', `${concept.slug}.md`), conceptPage, 'utf-8');
  }

  const docNodes = docs.map((doc) => ({ id: doc.id, title: doc.title, type: doc.department, file: doc.file, absolutePath: doc.absolutePath, folder: doc.folder, body: doc.body, ai: { summary: doc.summary, tags: doc.keywords } }));
  const conceptNodes = concepts.map((concept) => ({ id: concept.id, title: concept.title, type: 'Concept', file: concept.file, absolutePath: concept.absolutePath, folder: concept.folder, body: concept.body, ai: { summary: concept.summary, tags: concept.keywords } }));
  const nodes = [...docNodes, ...conceptNodes];
  const links = [...wikilinks, ...folderLinks, ...similarLinks, ...conceptLinks, ...conceptCooccur];
  const typeCounts = {};
  nodes.forEach((node) => { typeCounts[node.type] = (typeCounts[node.type] || 0) + 1; });

  const html = renderHtml({ title, nodes, links, typeCounts, ai: { enabled: ollama, runtimeAsk: true, model: ollamaModel, baseUrl: ollamaUrl } });
  fs.writeFileSync(path.join(workspace, 'graph', 'company-knowledge-graph.html'), html, 'utf-8');

  const state = {
    title,
    generated_at: nowIso(),
    source: path.resolve(source),
    workspace: path.resolve(workspace),
    settings: { ollama, ollamaModel, ollamaUrl },
    metrics: { documents: docs.length, concepts: concepts.length, links: links.length, departments: unique(docs.map((doc) => doc.department)).length },
    graph: { file: 'graph/company-knowledge-graph.html' },
    documents: docs.map((doc) => ({ slug: doc.slug, title: doc.title, department: doc.department, source_path: doc.file, summary: doc.summary, keywords: doc.keywords, related_concepts: doc.relatedConcepts, page_path: `docs/documents/${doc.slug}.md`, raw_path: `raw/imports/${doc.slug}.md`, contract_path: `contracts/${doc.slug}.json`, body_preview: excerpt(doc.body, 420) })),
    concepts: concepts.map((concept) => ({ slug: concept.slug, title: concept.title, summary: concept.summary, keywords: concept.keywords, related_documents: concept.relatedDocs.map((doc) => doc.slug), page_path: `docs/concepts/${concept.slug}.md` }))
  };
  writeJson(path.join(workspace, 'state.json'), state);
  return state;
}
