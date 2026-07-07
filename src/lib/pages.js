import matter from 'gray-matter';
import { nowIso } from './utils.js';

// gray-matter(js-yaml)가 이스케이프를 처리하므로 특수문자 제목도 안전하다.
function withFrontmatter(content, data) {
  return matter.stringify(content, data);
}

export function renderDocPage(doc, contract) {
  const content = [
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
    ...(doc.relatedConcepts?.length ? doc.relatedConcepts.map((slug) => `- [[${slug}]]`) : ['- 없음']),
    '',
    '## Source Excerpt',
    doc.body.slice(0, 4000),
    '',
  ].join('\n');
  return withFrontmatter(content, {
    title: doc.title,
    source_path: doc.file,
    department: doc.department,
    keywords: doc.keywords,
    related_concepts: doc.relatedConcepts || [],
    updated_at: nowIso(),
  });
}

export function renderRawPage(doc) {
  return withFrontmatter(`${doc.body}\n`, {
    title: doc.title,
    source_path: doc.file,
    imported_at: nowIso(),
  });
}

export function renderConceptPage(concept) {
  const content = [
    `# ${concept.title}`,
    '',
    concept.summary,
    '',
    '## Related Documents',
    ...concept.relatedDocs.map((doc) => `- [[${doc.slug}]] — ${doc.summary}`),
    '',
  ].join('\n');
  return withFrontmatter(content, {
    title: concept.title,
    kind: 'concept',
    related_documents: concept.relatedDocs.map((doc) => doc.slug),
    keywords: concept.keywords,
    updated_at: nowIso(),
  });
}
