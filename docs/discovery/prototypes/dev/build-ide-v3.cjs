// Builds a standalone clickable prototype from IDE.dc.html with a tiny DC runtime.
const fs = require('fs');
// Usage: node build-ide-v3.js [IDE.dc.html] [out.html]
const src = fs.readFileSync(process.argv[2] || __dirname + '/../../mockups/dev/IDE.dc.html', 'utf8');
const between = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i + a.length); if (i < 0 || j < 0) throw new Error('missing ' + a); return src.slice(i + a.length, j); };
const helmet = between('<helmet>', '</helmet>');
const tpl = between('</helmet>', '</x-dc>');
const sIdx = src.indexOf('data-dc-script');
const script = src.slice(src.indexOf('>', sIdx) + 1, src.indexOf('</script>', sIdx));
if (script.indexOf('</') >= 0 && /<\/script/i.test(script)) throw new Error('script contains closing tag');

const scenes = [
  ['Inicio', [['setup', 'Primera vez: preparar'], ['start', 'Sin proyectos: empezar'], ['import', 'Importar: el proyecto aprende'], ['create', 'Crear: decisiones → ADRs']]],
  ['Ticket spec-first', [['spec', 'Revisar el spec'], ['review', 'Agente de code review'], ['qa', 'Agente QA'], ['agents', 'Agentes y autonomía']]],
  ['Proceso, preset y MCP', [['process', 'Importar un proceso (copia)'], ['flow', 'flow.md del proyecto'], ['flowchange', 'El Configurador propone'], ['preset', 'Preset al lanzar el CLI'], ['mcp', 'MCP abierto a agentes externos']]],
  ['Sidekicks', [['sidekick', 'Sidekicks en acción'], ['sklib', 'Tus sidekicks'], ['skproj', 'Sidekicks del proyecto'], ['skimport', 'Importar tu coach']]],
  ['Focus mode', [['focus', 'Leer un spec en focus']]],
];

const runtime = `
const SCENES = ${JSON.stringify(scenes)};
class DCLogic { constructor(props) { this.props = props; this.state = null; } setState(s) { this.state = s; App.render(); } }
${script}
const App = (() => {
  const KEY = 'devharness-proto-v2';
  const stage = document.getElementById('stage');
  const tplRoot = document.getElementById('ide-tpl').content;
  let comp = null, scene = 'setup', vals = null;
  const look = (path, scope) => {
    if (path === 'true') return true; if (path === 'false') return false;
    if (/^-?\\d+(\\.\\d+)?$/.test(path)) return Number(path);
    let v = scope; for (const k of path.split('.')) { if (v == null) return undefined; v = v[k]; } return v;
  };
  const HOLE = /\\{\\{\\s*([^}]+?)\\s*\\}\\}/g;
  const single = (s) => { const m = /^\\{\\{\\s*([^}]+?)\\s*\\}\\}$/.exec(s); return m ? m[1] : null; };
  const interp = (s, scope) => s.replace(HOLE, (_, p) => { const v = look(p, scope); return v == null || v === false ? '' : String(v); });
  const BOOL = { checked: 1, disabled: 1, hidden: 1, selected: 1, readonly: 1 };
  function build(node, scope, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(node.data.indexOf('{{') >= 0 ? interp(node.data, scope) : node.data)); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-if') { if (look(single(node.getAttribute('value')) || '', scope)) for (const c of node.childNodes) build(c, scope, out); return; }
    if (tag === 'sc-for') {
      const list = look(single(node.getAttribute('list')) || '', scope) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((item, i) => { const s = Object.create(scope); s[as] = item; s[as + 'Index'] = i; for (const c of node.childNodes) build(c, s, out); });
      return;
    }
    const el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ? document.createElementNS(node.namespaceURI, tag) : document.createElement(tag);
    for (const a of node.attributes) {
      const n = a.name, v = a.value;
      if (n.indexOf('hint-') === 0) continue;
      const one = single(v);
      if (/^on[a-z]+$/.test(n)) {
        const fn = one && look(one, scope); if (typeof fn !== 'function') continue;
        const textual = tag === 'input' && (node.getAttribute('type') || 'text') === 'text';
        el.addEventListener(n === 'onchange' ? (textual ? 'input' : 'change') : n.slice(2), (e) => { fn(e); });
        continue;
      }
      if (BOOL[n]) { const on = one ? !!look(one, scope) : true; if (on) { el.setAttribute(n, ''); if (n === 'checked') el.checked = true; } continue; }
      if (one) { const val = look(one, scope); if (val == null) continue; el.setAttribute(n, String(val)); continue; }
      el.setAttribute(n, v.indexOf('{{') >= 0 ? interp(v, scope) : v);
    }
    for (const c of node.childNodes) build(c, scope, el);
    out.appendChild(el);
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ scene, state: comp.state })); } catch (e) {} }
  function render() {
    vals = comp.renderVals();
    const old = stage.querySelectorAll('*'); const scrolls = [];
    old.forEach((el, i) => { if (el.scrollTop || el.scrollLeft) scrolls.push([i, el.scrollTop, el.scrollLeft]); });
    // Inputs are uncontrolled: keep their text, caret and focus across the full re-render.
    const keyOf = (el) => el.getAttribute('data-cmd-input') ? 'cmd' : el.getAttribute('placeholder') || '';
    const inputs = {}; stage.querySelectorAll('input[type="text"]').forEach((el) => { inputs[keyOf(el)] = el.value; });
    const act = document.activeElement; const focusKey = act && act.tagName === 'INPUT' && stage.contains(act) ? keyOf(act) : null;
    const caret = focusKey !== null ? act.selectionStart : null;
    const frag = document.createDocumentFragment();
    for (const c of tplRoot.childNodes) build(c, vals, frag);
    stage.replaceChildren(frag);
    const now = stage.querySelectorAll('*');
    scrolls.forEach(([i, t, l]) => { if (now[i]) { now[i].scrollTop = t; now[i].scrollLeft = l; } });
    stage.querySelectorAll('input[type="text"]').forEach((el) => {
      const k = keyOf(el); if (inputs[k] != null) el.value = inputs[k];
      if (k === focusKey) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) {} }
    });
    const cmdIn = stage.querySelector('[data-cmd-input]');
    if (cmdIn && document.activeElement !== cmdIn) cmdIn.focus();
    document.documentElement.dataset.ide = comp.st().theme;
    save(); menu.mark();
  }
  function go(s, state) { scene = s; comp = new Component({ scene: s, theme: comp ? comp.st().theme : 'dark' }); comp.state = state || null; render(); }
  function fit() { const w = window.innerWidth, h = window.innerHeight; const k = Math.min(w / 1440, h / 900); stage.style.transform = 'translate(' + Math.max(0, (w - 1440 * k) / 2) + 'px,' + Math.max(0, (h - 900 * k) / 2) + 'px) scale(' + k + ')'; }
  const menu = (() => {
    const btn = document.getElementById('demo-btn'), pane = document.getElementById('demo-pane');
    let html = '<div class="dm-head"><b>Demo</b><span>Saltá a cualquier pantalla. El estado sigue mientras navegás dentro del IDE.</span></div><button class="dm-reset" data-go="setup">Empezar desde cero</button>';
    SCENES.forEach(([g, items]) => { html += '<div class="dm-group">' + g + '</div>'; items.forEach(([id, label]) => { html += '<button class="dm-item" data-go="' + id + '">' + label + '</button>'; }); });
    html += '<div class="dm-foot">⌘K paleta · ⌘. focus mode · ⇧⌘M problemas · Esc sale · el tema se cambia desde la barra de estado</div>';
    pane.innerHTML = html;
    const close = () => { pane.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); pane.hidden = !pane.hidden; btn.setAttribute('aria-expanded', String(!pane.hidden)); });
    pane.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) { go(b.dataset.go); close(); } e.stopPropagation(); });
    document.addEventListener('click', close);
    return { close, mark: () => pane.querySelectorAll('.dm-item').forEach((b) => b.classList.toggle('on', b.dataset.go === scene)) };
  })();
  document.addEventListener('keydown', (e) => {
    if (!vals) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); menu.close(); if (vals.cmdOpen) vals.closePalette(); else vals.openPalette(); return; }
    if (vals.cmdOpen) {
      if (e.key === 'Escape') { e.preventDefault(); vals.closePalette(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); vals.cmdMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); vals.cmdMove(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); vals.cmdRun(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); vals.showProblems && vals.showProblems(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); if (!vals.focusOn && vals.enterFocus && (vals.vDoc || vals.vFlow)) vals.enterFocus(); return; }
    if (e.key !== 'Escape') return;
    if (!document.getElementById('demo-pane').hidden) { menu.close(); return; }
    if (vals.focusOn && typeof vals.exitFocus === 'function') vals.exitFocus();
  });
  window.addEventListener('resize', fit);
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  fit();
  if (saved && saved.scene) go(saved.scene, saved.state); else go('setup');
  return { render, go };
})();
`;

const page = `<title>Dev Harness IDE</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${helmet.trim()}
<style>
:root { --shell: #101114; --pill: #26282f; --pill-text: #e7e7ea; --pill-muted: #9a9ca5; --pill-line: #3a3d46; --pill-on: #6ea8fe; color-scheme: dark; }
html, body { height: 100%; }
body { margin: 0; background: var(--shell); overflow: hidden; }
#stage { position: absolute; left: 0; top: 0; width: 1440px; height: 900px; transform-origin: 0 0; }
#demo-btn { position: fixed; z-index: 50; top: calc(8px + env(safe-area-inset-top, 0px)); right: calc(12px + env(safe-area-inset-right, 0px)); font: 600 12px Inter, system-ui, sans-serif; color: var(--pill-text); background: var(--pill); border: 1px solid var(--pill-line); border-radius: 999px; padding: 5px 12px; cursor: pointer; opacity: .82; }
#demo-btn:hover, #demo-btn[aria-expanded="true"] { opacity: 1; }
#demo-btn:focus-visible, .dm-item:focus-visible, .dm-reset:focus-visible { outline: 2px solid var(--pill-on); outline-offset: 2px; }
#demo-pane { position: fixed; z-index: 50; top: calc(40px + env(safe-area-inset-top, 0px)); right: calc(12px + env(safe-area-inset-right, 0px)); width: 280px; max-height: calc(100% - 60px); overflow: auto; background: var(--pill); color: var(--pill-text); border: 1px solid var(--pill-line); border-radius: 10px; padding: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.45); font: 13px Inter, system-ui, sans-serif; display: flex; flex-direction: column; gap: 2px; }
.dm-head { display: flex; flex-direction: column; gap: 4px; padding-bottom: 8px; }
.dm-head span, .dm-foot { color: var(--pill-muted); font-size: 12px; line-height: 1.4; }
.dm-foot { padding-top: 10px; }
.dm-group { color: var(--pill-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; padding: 10px 6px 4px; }
.dm-item, .dm-reset { font: inherit; color: inherit; background: none; border: 0; text-align: left; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.dm-item:hover, .dm-reset:hover { background: var(--pill-line); }
.dm-item.on { color: var(--pill-on); font-weight: 600; }
.dm-reset { border: 1px solid var(--pill-line); text-align: center; font-weight: 600; }
</style>
<div id="stage" aria-label="Dev Harness IDE"></div>
<button id="demo-btn" aria-expanded="false" aria-controls="demo-pane">Demo ▾</button>
<div id="demo-pane" hidden></div>
<template id="ide-tpl">${tpl}</template>
<script>${runtime}</script>
`;
const out = process.argv[3] || __dirname + '/ide-v3.html';
fs.writeFileSync(out, page);
console.log('wrote', out, page.length);
