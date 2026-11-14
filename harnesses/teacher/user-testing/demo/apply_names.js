// Follow-ups to v35/v36: the categories window is "Editar categorías" everywhere; the Editar materia
// dialog shows a sample rename and the saved Subject state reflects it.
const fs = require('fs');
const dir = process.argv[2];
const edit = (file, pairs) => {
  const p = dir + '/' + file;
  let s = fs.readFileSync(p, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(file + ': not found: ' + a.slice(0, 80));
    s = s.split(a).join(b);
  }
  fs.writeFileSync(p, s);
  console.log('ok', file);
};

// 1. Categories window name.
edit('GapsSource.dc.html', [
  ['aria-label="Administrar categorías"', 'aria-label="Editar categorías"'],
  ['<span style="font-size: 20px; font-weight: 600;">Categorías</span>', '<span style="font-size: 20px; font-weight: 600;">Editar categorías</span>']
]);
edit('SourceSheet.dc.html', [['>Administrar categorías</span>', '>Editar categorías</span>']]);
edit('GapCategories.dc.html', [['<title>Administrar categorías', '<title>Editar categorías']]);
edit('GapCategoriesDark.dc.html', [['<title>Administrar categorías', '<title>Editar categorías']]);

// 2. Dialog: the Nombre field holds an edited value (focused border, like the selected option).
edit('GapsMisc.dc.html', [[
  '<span style="font-size: 12px; font-weight: 600; color: {{t.muted}};">Nombre</span><div style="height: 36px; box-sizing: border-box; padding: 0 12px; border-radius: 12px; border: 1.5px solid {{t.lineS}};',
  '<span style="font-size: 12px; font-weight: 600; color: {{t.muted}};">Nombre</span><div style="height: 36px; box-sizing: border-box; padding: 0 12px; border-radius: 12px; border: 1.5px solid {{t.activeInk}};'
], [
  '<span style="flex-grow: 1; white-space: nowrap; overflow: hidden;">Biología</span>',
  '<span style="flex-grow: 1; white-space: nowrap; overflow: hidden;">Biología y ambiente</span>'
]]);

// Saved state: Subject shows the new name in title and breadcrumb.
edit('Subject.dc.html', [
  ["style: 'Cambios de la materia guardados'", "style: 'Materia guardada: nuevo nombre y estilo propio'"],
  ["    if (c === 'approved') o.subline", "    if (c === 'style') { o.title = 'Biología y ambiente · 2º B'; o.crumb = 'Biología y ambiente 2º B'; }\n    if (c === 'approved') o.subline"]
]);

const cp = dir + '/canvas.json';
const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
const ren = { GapCategories: 'Editar categorías', SubjectStyleSaved: 'Materia · renombrada, estilo propio guardado' };
for (const [k, v] of Object.entries(ren)) {
  c.boards[k + '.dc.html'].title = v + ' (claro)';
  c.boards[k + 'Dark.dc.html'].title = v + ' (oscuro)';
}
fs.writeFileSync(cp, JSON.stringify(c));
console.log('ok canvas.json');
