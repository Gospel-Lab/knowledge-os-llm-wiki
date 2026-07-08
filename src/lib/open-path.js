import path from 'node:path';

function isWithin(root, target) {
  if (!root) return false;
  const rel = path.relative(root, target);
  // 같은 경로이거나 하위 경로면 rel이 '..'로 시작하지 않고 절대경로도 아님
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveOpenTarget(requested, { source, workspace } = {}) {
  const raw = String(requested || '').trim();
  if (!raw) return { ok: false, reason: 'empty path' };
  const resolved = path.resolve(raw);
  const src = source ? path.resolve(source) : null;
  const ws = workspace ? path.resolve(workspace) : null;
  if (isWithin(src, resolved) || isWithin(ws, resolved)) return { ok: true, path: resolved };
  return { ok: false, reason: 'path outside allowed roots' };
}
