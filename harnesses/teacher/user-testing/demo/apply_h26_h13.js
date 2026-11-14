// H26 option A: bibliography is one question, not a 4th part; footer says what comes out.
// H13 option A: Search (⌘K window) board + every "Buscar" magnifier links to it.
const fs = require('fs');
const dir = process.argv[2];
const comps = process.argv[3];
const rd = (f) => fs.readFileSync(dir + '/' + f, 'utf8');
const wr = (f, s) => fs.writeFileSync(dir + '/' + f, s);
const edit = (file, pairs) => {
  let s = rd(file);
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(file + ': not found: ' + a.slice(0, 80));
    s = s.split(a).join(b);
  }
  wr(file, s);
  console.log('ok', file);
};

// H26
edit('Export.dc.html', [
  ["      P('Material para alumnos', 'Guía de observación para imprimir', '2 págs', true, 2),\n      P('Bibliografía', 'Las 3 fuentes de la clase, con el formato de citas del colegio', '1 pág', true, 3)\n",
   "      P('Material para alumnos', 'Guía de observación para imprimir', '2 págs', true, 2)\n"],
  ['<sc-for list="{{parts}}" as="pt" hint-placeholder-count="4">', '<sc-for list="{{parts}}" as="pt" hint-placeholder-count="3">'],
  ['>Dónde va la bibliografía</span>', '>Bibliografía</span>'],
  ['></span>En un archivo aparte</span>', '></span>Como archivo aparte</span>'],
  ['></span>Solo en las diapositivas</span>', '></span>No incluir</span>'],
  ['>Se guardan en la carpeta de la clase. La clase sigue en Borrador.</span>',
   '>3 PDF, cada uno con su bibliografía al final. Se guardan en la carpeta de la clase; la clase sigue en Borrador.</span>']
]);

// H13: magnifier buttons become links to Search.
const names = fs.readFileSync(comps, 'utf8').split(/\s+/).filter(Boolean);
const re = /<button aria-label="Buscar" style="([^"]*)">(<svg[\s\S]*?<\/svg>)<\/button>/g;
for (const n of names) {
  const f = n + '.dc.html';
  let s = rd(f);
  const count = (s.match(re) || []).length;
  if (!count) continue;
  s = s.replace(re, (m, st, svg) => `<a href="{{go.search}}" aria-label="Buscar" style="${st} text-decoration: none; cursor: pointer;">${svg}</a>`);
  if (!s.includes('    o.go = g;')) throw new Error(f + ': no o.go = g');
  s = s.replace('    o.go = g;', "    g.search = b('Search');\n    o.go = g;");
  wr(f, s);
  console.log('search link', f, count);
}

// SearchDark wrapper + boards.
wr('SearchDark.dc.html', `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Buscar · ventana ⌘K, oscuro</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{margin:0}
</style>
</helmet>
<div style="width: 1280px; height: 800px; background: #121315;">
  <dc-import name="Search" dark="{{yes}}" hint-size="1280px,800px"></dc-import>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1280,"height":800}}'>
class Component extends DCLogic {
  renderVals() { return { yes: true }; }
}
</script>
</body>
</html>
`);
const cp = dir + '/canvas.json';
const c = JSON.parse(rd('canvas.json'));
const y = 37000;
c.boards['Search.dc.html'] = { x: 0, y, w: 1280, h: 800, title: 'Buscar · ventana ⌘K con resultados (claro)', is_interactive: true };
c.boards['SearchDark.dc.html'] = { x: 0, y: y + 920, w: 1280, h: 800, title: 'Buscar · ventana ⌘K con resultados (oscuro)', is_interactive: true };
for (const f of ['Search.dc.html', 'SearchDark.dc.html']) if (!c.order.includes(f)) c.order.push(f);
c.notes.search = { x: 0, y: y - 100, text: 'Buscar (H13): la lupa o ⌘K abren una ventana encima', kind: 'title1', maxW: 2600 };
c.boards['Export.dc.html'].title = 'Exportar la clase · PDF, HTML o PowerPoint; bibliografía al final, aparte o sin incluir (claro)';
if (c.boards['ExportDark.dc.html']) c.boards['ExportDark.dc.html'].title = 'Exportar la clase · PDF, HTML o PowerPoint; bibliografía al final, aparte o sin incluir (oscuro)';
wr('canvas.json', JSON.stringify(c));
let list = fs.readFileSync(comps, 'utf8').trim();
if (!/\bSearch\b/.test(list)) fs.writeFileSync(comps, list + ' Search\n');
console.log('ok canvas.json');
