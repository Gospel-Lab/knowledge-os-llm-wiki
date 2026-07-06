function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDashboardHtml(title) {
  const safeTitle = esc(title);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; --bg:#07111f; --panel:#0d182b; --line:rgba(148,163,184,.18); --text:#ecf3ff; --muted:#9ab0cb; --accent:#7dd3fc; --accent2:#a7f3d0; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, "Noto Sans KR", system-ui, sans-serif; background:linear-gradient(180deg,#07111f,#09182d 30%,#081320); color:var(--text); }
    a { color:inherit; }
    .shell { max-width:1440px; margin:0 auto; padding:24px; }
    .hero { display:grid; gap:14px; margin-bottom:22px; }
    .hero h1 { margin:0; font-size:clamp(28px,5vw,48px); }
    .hero p { margin:0; color:var(--muted); max-width:900px; line-height:1.6; }
    .cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:18px 0 24px; }
    .card { background:rgba(13,24,43,.88); border:1px solid var(--line); border-radius:16px; padding:16px; }
    .card strong { display:block; font-size:28px; margin-bottom:6px; }
    .card span { color:var(--muted); font-size:14px; }
    .layout { display:grid; grid-template-columns:360px minmax(0,1fr) 360px; gap:14px; }
    .panel { min-height:300px; background:rgba(13,24,43,.88); border:1px solid var(--line); border-radius:16px; overflow:hidden; }
    .panel header { padding:14px 16px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .panel header h2 { margin:0; font-size:16px; }
    .panel .body { padding:14px 16px; }
    #docSearch { width:100%; border:1px solid var(--line); border-radius:10px; background:#08111e; color:var(--text); padding:10px 12px; }
    #docList { display:grid; gap:8px; max-height:560px; overflow:auto; }
    .doc-item { width:100%; text-align:left; background:#0a1526; color:var(--text); border:1px solid transparent; border-radius:12px; padding:12px; cursor:pointer; }
    .doc-item:hover,.doc-item.active { border-color:rgba(125,211,252,.45); background:#10203b; }
    .meta { display:flex; gap:8px; flex-wrap:wrap; color:var(--muted); font-size:12px; margin-top:6px; }
    .chip { display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:999px; background:rgba(125,211,252,.12); color:#d8f5ff; font-size:12px; }
    .preview h3 { margin:0 0 8px; font-size:24px; }
    .preview pre, .answer { white-space:pre-wrap; background:#09111b; border:1px solid var(--line); border-radius:12px; padding:14px; overflow:auto; line-height:1.6; }
    iframe { width:100%; height:720px; border:0; background:#08111e; }
    textarea { width:100%; min-height:120px; resize:vertical; border-radius:12px; border:1px solid var(--line); background:#08111e; color:var(--text); padding:12px; }
    .btn { cursor:pointer; border:0; border-radius:10px; padding:10px 14px; background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#03131f; font-weight:800; }
    .muted { color:var(--muted); }
    .sources { display:grid; gap:8px; margin-top:12px; }
    .source { background:#0a1526; border:1px solid var(--line); border-radius:12px; padding:10px; }
    @media (max-width:1200px){ .cards{grid-template-columns:repeat(2,minmax(0,1fr));} .layout{grid-template-columns:1fr;} iframe{height:540px;} }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <span class="chip">Knowledge OS · LLM Wiki + Graph</span>
      <h1>${safeTitle}</h1>
      <p>회사 문서를 지속형 위키와 3D 지식그래프로 컴파일한 대시보드입니다. 문서를 검색하고, 개념을 따라가고, 그래프에서 관계를 탐색하고, 필요하면 로컬 Ollama에게 질문할 수 있습니다.</p>
    </section>

    <section class="cards" id="metricCards"></section>

    <section class="layout">
      <article class="panel">
        <header><h2>문서 탐색</h2><span class="muted" id="docCount"></span></header>
        <div class="body">
          <input id="docSearch" placeholder="문서/요약/키워드 검색">
          <div style="height:10px"></div>
          <div id="docList"></div>
        </div>
      </article>

      <article class="panel preview">
        <header><h2>문서 상세</h2><a id="pageLink" class="chip" target="_blank">위키 페이지</a></header>
        <div class="body" id="previewBody"><p class="muted">왼쪽에서 문서를 선택하세요.</p></div>
      </article>

      <article class="panel">
        <header><h2>AI Ask</h2><span class="muted">로컬 Ollama 선택형</span></header>
        <div class="body">
          <textarea id="askInput" placeholder="예: 고객 문의 자동화에 연결된 정책/FAQ/담당 업무를 요약해줘"></textarea>
          <div style="height:10px"></div>
          <button class="btn" id="askBtn">질문하기</button>
          <div style="height:12px"></div>
          <div id="askResult" class="answer muted">질문을 입력하면 관련 문서를 추려 답변합니다.</div>
          <div id="askSources" class="sources"></div>
        </div>
      </article>
    </section>

    <div style="height:14px"></div>
    <section class="panel">
      <header><h2>3D Knowledge Graph</h2><a class="chip" href="/graph/company-knowledge-graph.html" target="_blank">새 창으로 열기</a></header>
      <iframe src="/graph/company-knowledge-graph.html"></iframe>
    </section>
  </div>

<script>
var state = null;
var filtered = [];
var selected = null;
function el(id){ return document.getElementById(id); }
function escapeHtml(text){ return String(text || '').replace(/[&<>"']/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; }); }
function docButtonHtml(doc){
  var chips = (doc.keywords || []).slice(0,4).map(function(k){ return '<span class="chip">' + escapeHtml(k) + '</span>'; }).join('');
  var active = selected === doc.slug ? ' active' : '';
  return '<button class="doc-item' + active + '" data-slug="' + escapeHtml(doc.slug) + '">' +
    '<strong>' + escapeHtml(doc.title) + '</strong>' +
    '<div class="meta"><span>' + escapeHtml(doc.department) + '</span><span>' + escapeHtml(doc.source_path) + '</span></div>' +
    '<div class="meta">' + chips + '</div>' +
  '</button>';
}
async function loadState(){
  var res = await fetch('/api/state');
  state = await res.json();
  renderMetrics();
  filtered = state.documents;
  renderDocs();
  el('docCount').textContent = state.documents.length + ' docs';
  if (state.documents[0]) selectDoc(state.documents[0].slug);
}
function renderMetrics(){
  var metrics = [['문서', state.metrics.documents], ['개념', state.metrics.concepts], ['링크', state.metrics.links], ['부서/카테고리', state.metrics.departments]];
  el('metricCards').innerHTML = metrics.map(function(pair){ return '<div class="card"><strong>' + pair[1] + '</strong><span>' + pair[0] + '</span></div>'; }).join('');
}
function matchesQuery(doc, q){
  var hay = [doc.title, doc.department, doc.summary].concat(doc.keywords || [], doc.related_concepts || []).join(' ').toLowerCase();
  return hay.indexOf(q.toLowerCase()) >= 0;
}
function renderDocs(){
  el('docList').innerHTML = filtered.map(docButtonHtml).join('');
  Array.prototype.slice.call(document.querySelectorAll('.doc-item')).forEach(function(btn){ btn.addEventListener('click', function(){ selectDoc(btn.dataset.slug); }); });
}
async function selectDoc(slug){
  selected = slug;
  renderDocs();
  var res = await fetch('/api/doc/' + encodeURIComponent(slug));
  var data = await res.json();
  var doc = data.document;
  el('pageLink').href = '/' + doc.page_path;
  el('pageLink').textContent = '위키 페이지 열기';
  var concepts = (doc.related_concepts || []).length ? doc.related_concepts.map(function(k){ return '<span class="chip">' + escapeHtml(k) + '</span>'; }).join(' ') : '<span class="muted">없음</span>';
  var keywords = (doc.keywords || []).map(function(k){ return '<span class="chip">' + escapeHtml(k) + '</span>'; }).join(' ');
  el('previewBody').innerHTML = '<h3>' + escapeHtml(doc.title) + '</h3>' +
    '<div class="meta">' + escapeHtml(doc.department) + ' · ' + escapeHtml(doc.source_path) + '</div>' +
    '<p>' + escapeHtml(doc.summary) + '</p>' +
    '<p><strong>키워드</strong><br>' + keywords + '</p>' +
    '<p><strong>관련 개념</strong><br>' + concepts + '</p>' +
    '<p><strong>Search Contract</strong></p>' +
    '<pre>' + escapeHtml(JSON.stringify(data.contract, null, 2)) + '</pre>' +
    '<p><strong>본문 미리보기</strong></p>' +
    '<pre>' + escapeHtml(doc.body_preview || '') + '</pre>';
}
async function ask(){
  var question = el('askInput').value.trim();
  if (!question) return;
  el('askResult').textContent = '관련 문서를 추리는 중...';
  el('askSources').innerHTML = '';
  var res = await fetch('/api/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question: question }) });
  var data = await res.json();
  el('askResult').textContent = data.answer;
  el('askSources').innerHTML = (data.sources || []).map(function(src){
    return '<div class="source"><strong>' + escapeHtml(src.title) + '</strong><div class="muted">' + escapeHtml(src.department) + ' · ' + escapeHtml(src.source_path) + '</div><div style="margin-top:6px">' + escapeHtml(src.summary) + '</div></div>';
  }).join('');
}
document.addEventListener('DOMContentLoaded', function(){
  loadState();
  el('docSearch').addEventListener('input', function(e){
    var q = e.target.value.trim();
    filtered = q ? state.documents.filter(function(doc){ return matchesQuery(doc, q); }) : state.documents;
    renderDocs();
  });
  el('askBtn').addEventListener('click', ask);
});
</script>
</body>
</html>`;
}
