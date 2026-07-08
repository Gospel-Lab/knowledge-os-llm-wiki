import fs from 'node:fs';
import path from 'node:path';
import { extractFolder } from './extractor.js';
import { extractKeywords, keywordSimilarityLinks, tokenize } from '../vendor/keywords.js';
import { renderHtml } from '../vendor/render.js';
import { summarizeNodeWithOllama, checkOllama, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL, embedOne, DEFAULT_EMBED_MODEL } from '../vendor/ollama.js';
import { mapWithConcurrency } from './concurrency.js';
import { buildBm25Index } from './bm25.js';
import { extractConceptsTfIdf, extractConceptsEmbedding } from './concepts.js';
import { contentHash } from './hash.js';
import { createCache } from './cache.js';
import { ensureDir, createSlugger, excerpt, nowIso, writeJson, readJson } from './utils.js';
import { renderDocPage, renderRawPage, renderConceptPage } from './pages.js';
import { buildLinkResolver } from './link-resolver.js';
import { copyVendorAssets } from './assets.js';

function topFolderFromRel(relPath) {
  const parts = relPath.split('/');
  return parts.length > 1 ? parts[0] : '(root)';
}

export function defaultMaxConcepts(docCount) {
  return Math.max(14, Math.min(80, Math.round(Math.sqrt(docCount) * 3)));
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
    search_questions: (doc.ai?.questions?.length ? doc.ai.questions : inferQuestions(doc.title, doc.keywords, doc.department)),
  };
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

async function maybeEnrichWithOllama(nodes, options) {
  if (!options.ollama) return { ok: false, enabled: false };
  const status = await checkOllama({ baseUrl: options.ollamaUrl, model: options.ollamaModel });
  if (!status.ok || !status.modelAvailable) return { ok: false, enabled: true, status };
  const cache = options.aiCache;
  const model = options.ollamaModel;
  const toRun = [];
  for (const node of nodes) {
    const key = `ai:${model}:${contentHash(node.body)}`;
    const hit = cache?.get(key);
    if (hit) { node.ai = hit; } else { toRun.push({ node, key }); }
  }
  await mapWithConcurrency(toRun, options.ollamaConcurrency || 4, async ({ node, key }) => {
    try {
      node.ai = await summarizeNodeWithOllama(node, { baseUrl: options.ollamaUrl, model });
      cache?.set(key, node.ai);
    } catch (error) {
      node.ai = { error: error.message, model };
    }
  });
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

export async function ingestWorkspace({ source, workspace, title = 'Company Knowledge OS', ollama = false, ollamaModel = DEFAULT_OLLAMA_MODEL, ollamaUrl = DEFAULT_OLLAMA_BASE_URL, maxConcepts = null, ollamaConcurrency = 4, graphBodyLimit = 2000, ollamaEmbeddings = false, ollamaEmbedModel = DEFAULT_EMBED_MODEL }) {
  ensureDir(workspace);
  await initWorkspace(workspace, title);

  const llmDir = path.join(workspace, '.llmwiki');
  const extractCache = createCache(path.join(llmDir, 'extract-cache.json'));
  const aiCache = createCache(path.join(llmDir, 'ai-cache.json'));
  const prevManifest = readJson(path.join(llmDir, 'manifest.json'), {}) || {};
  const nextManifest = {};

  const extracted = await extractFolder(source, { cache: extractCache });
  const toDocSlug = createSlugger();
  const docs = extracted.map(({ filePath, result }) => {
    const rel = path.relative(source, filePath).split(path.sep).join('/');
    const name = path.basename(filePath, path.extname(filePath));
    const slug = toDocSlug(rel);
    return {
      id: `doc:${slug}`,
      slug,
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

  await maybeEnrichWithOllama(docs, { ollama, ollamaModel, ollamaUrl, aiCache, ollamaConcurrency });
  docs.forEach((doc) => {
    if (doc.ai?.summary) doc.summary = doc.ai.summary;
    if (doc.ai?.tags?.length) doc.keywords = unique([...doc.ai.tags, ...doc.keywords]).slice(0, 8);
  });

  const conceptCap = Number.isInteger(maxConcepts) && maxConcepts > 0 ? maxConcepts : defaultMaxConcepts(docs.length);
  const docMini = docs.map((d) => ({ slug: d.slug, keywords: d.keywords }));

  let conceptSpecs = null;
  if (ollamaEmbeddings) {
    const status = await checkOllama({ baseUrl: ollamaUrl, model: ollamaEmbedModel });
    if (status.ok) {
      const vectors = await mapWithConcurrency(docs, ollamaConcurrency || 4,
        (d) => embedOne(d.body, { baseUrl: ollamaUrl, model: ollamaEmbedModel }));
      if (vectors.every((v) => Array.isArray(v) && v.length)) {
        conceptSpecs = extractConceptsEmbedding(docMini, vectors, { maxConcepts: conceptCap });
      }
    }
  }
  if (!conceptSpecs) conceptSpecs = extractConceptsTfIdf(docMini, { maxConcepts: conceptCap });

  const toConceptSlug = createSlugger();
  const concepts = conceptSpecs.map((spec) => {
    const slug = toConceptSlug(spec.title);
    const relatedDocs = docs.filter((doc) => spec.relatedSlugs.includes(doc.slug));
    return {
      id: `concept:${slug}`,
      slug,
      title: spec.title,
      type: 'Concept',
      folder: 'Concepts',
      file: `concepts/${slug}.md`,
      absolutePath: path.join(workspace, 'docs', 'concepts', `${slug}.md`),
      body: `${spec.title} 관련 핵심 문서: ${relatedDocs.map((doc) => doc.title).join(', ')}`,
      summary: `${spec.title}는 ${relatedDocs.length}개 문서에 걸쳐 등장하는 핵심 개념입니다.`,
      keywords: unique(relatedDocs.flatMap((doc) => doc.keywords)).slice(0, 8),
      relatedDocs,
    };
  });

  const resolveLink = buildLinkResolver(docs);
  const wikilinks = [];
  const seen = new Set();
  for (const doc of docs) {
    for (const targetTitle of doc.wikilinks) {
      const target = resolveLink(targetTitle);
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
    doc.relatedConcepts = concepts.filter((c) => c.relatedDocs.some((rd) => rd.slug === doc.slug)).map((c) => c.slug);
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
    const h = contentHash(doc.body);
    const prev = prevManifest[doc.slug];
    doc.updatedAt = (prev && prev.hash === h) ? prev.updatedAt : nowIso();
    nextManifest[doc.slug] = { hash: h, updatedAt: doc.updatedAt, source_path: doc.file };
  }

  for (const doc of docs) {
    const relatedDocs = similarLinks.filter((link) => link.source === doc.id || link.target === doc.id)
      .map((link) => (link.source === doc.id ? link.target : link.source))
      .map((id) => docs.find((item) => item.id === id))
      .filter(Boolean)
      .slice(0, 4);
    const contract = buildSearchContract(doc, relatedDocs, doc.relatedConcepts);
    fs.writeFileSync(path.join(workspace, 'docs', 'documents', `${doc.slug}.md`), renderDocPage(doc, contract), 'utf-8');
    fs.writeFileSync(path.join(workspace, 'raw', 'imports', `${doc.slug}.md`), renderRawPage(doc), 'utf-8');
    writeJson(path.join(workspace, 'contracts', `${doc.slug}.json`), contract);
  }

  // stale 개념 페이지 제거 (개념은 전량 재생성되므로 디렉토리를 비우고 다시 쓴다)
  const conceptsDir = path.join(workspace, 'docs', 'concepts');
  try { for (const f of fs.readdirSync(conceptsDir)) if (f.endsWith('.md')) fs.rmSync(path.join(conceptsDir, f), { force: true }); } catch {}

  for (const concept of concepts) {
    fs.writeFileSync(path.join(workspace, 'docs', 'concepts', `${concept.slug}.md`), renderConceptPage(concept), 'utf-8');
  }

  const docNodes = docs.map((doc) => ({ id: doc.id, title: doc.title, type: doc.department, file: doc.file, absolutePath: doc.absolutePath, folder: doc.folder, body: doc.body.slice(0, graphBodyLimit), ai: { summary: doc.summary, tags: doc.keywords } }));
  const conceptNodes = concepts.map((concept) => ({ id: concept.id, title: concept.title, type: 'Concept', file: concept.file, absolutePath: concept.absolutePath, folder: concept.folder, body: concept.body, ai: { summary: concept.summary, tags: concept.keywords } }));
  const nodes = [...docNodes, ...conceptNodes];
  const links = [...wikilinks, ...folderLinks, ...similarLinks, ...conceptLinks, ...conceptCooccur];
  const typeCounts = {};
  nodes.forEach((node) => { typeCounts[node.type] = (typeCounts[node.type] || 0) + 1; });

  const html = renderHtml({ title, nodes, links, typeCounts, ai: { enabled: ollama, runtimeAsk: true, model: ollamaModel, baseUrl: ollamaUrl } });
  fs.writeFileSync(path.join(workspace, 'graph', 'company-knowledge-graph.html'), html, 'utf-8');
  copyVendorAssets(path.join(workspace, 'graph', 'vendor'));

  const bm25Docs = docs.map((doc) => ({ slug: doc.slug, tokens: tokenize(doc.body) }));
  const searchIndex = buildBm25Index(bm25Docs);
  writeJson(path.join(workspace, 'search-index.json'), searchIndex);

  const state = {
    title,
    generated_at: nowIso(),
    source: path.resolve(source),
    workspace: path.resolve(workspace),
    settings: { ollama, ollamaModel, ollamaUrl },
    metrics: { documents: docs.length, concepts: concepts.length, links: links.length, departments: unique(docs.map((doc) => doc.department)).length },
    graph: { file: 'graph/company-knowledge-graph.html' },
    search: { index_path: 'search-index.json' },
    documents: docs.map((doc) => ({ slug: doc.slug, title: doc.title, department: doc.department, source_path: doc.file, summary: doc.summary, keywords: doc.keywords, related_concepts: doc.relatedConcepts, page_path: `docs/documents/${doc.slug}.md`, raw_path: `raw/imports/${doc.slug}.md`, contract_path: `contracts/${doc.slug}.json`, body_preview: excerpt(doc.body, 420) })),
    concepts: concepts.map((concept) => ({ slug: concept.slug, title: concept.title, summary: concept.summary, keywords: concept.keywords, related_documents: concept.relatedDocs.map((doc) => doc.slug), page_path: `docs/concepts/${concept.slug}.md` }))
  };
  // 이전 매니페스트에 있으나 이번엔 없는 slug의 산출물 제거
  const currentSlugs = new Set(docs.map((d) => d.slug));
  for (const slug of Object.keys(prevManifest)) {
    if (currentSlugs.has(slug)) continue;
    for (const p of [
      path.join(workspace, 'docs', 'documents', `${slug}.md`),
      path.join(workspace, 'raw', 'imports', `${slug}.md`),
      path.join(workspace, 'contracts', `${slug}.json`),
    ]) { try { fs.rmSync(p, { force: true }); } catch {} }
  }
  // 매니페스트/캐시 flush
  writeJson(path.join(llmDir, 'manifest.json'), nextManifest);
  extractCache.save();
  aiCache.save();

  writeJson(path.join(workspace, 'state.json'), state);
  return state;
}
