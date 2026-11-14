// H07 option D: "Editar materia" button in Subject opens the subject dialog (data + export style).
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
const field = (label, value, flex, menu) => `<div style="display: flex; flex-direction: column; gap: 6px; flex: ${flex}; min-width: 0;"><span style="font-size: 12px; font-weight: 600; color: {{t.muted}};">${label}</span><div style="height: 36px; box-sizing: border-box; padding: 0 12px; border-radius: 12px; border: 1.5px solid {{t.lineS}}; background: {{t.surface}}; font-size: 14px; color: {{t.ink}}; display: flex; align-items: center; gap: 8px;"><span style="flex-grow: 1; white-space: nowrap; overflow: hidden;">${value}</span>${menu ? '<span style="color: {{t.muted}}; font-size: 12px;">▾</span>' : ''}</div></div>`;
const data = `<div style="display: flex; gap: 12px;">${field('Nombre', 'Biología', 2, false)}${field('Curso', '2º B', 1, false)}${field('Colegio', 'San Martín', 2, true)}</div><span style="font-size: 14px; font-weight: 600; margin-top: 4px;">Estilo para exportar</span>`;

edit('GapsMisc.dc.html', [
  ['aria-label="Estilo de la materia" style="position: absolute; left: 370px; top: 150px;', 'aria-label="Editar materia" style="position: absolute; left: 370px; top: 80px;'],
  ['>Estilo de Biología 2º B</span>', '>Editar Biología 2º B</span>'],
  ['Cambia cómo se exportan las clases y exámenes de esta materia.</span></div>', 'Datos de la materia y cómo se exportan sus clases y exámenes.</span></div>' + data]
]);

edit('Subject.dc.html', [
  ['              <a href="{{go.unitNew}}"', '              <a href="{{go.editSubject}}" style="height: 32px; padding: 0 12px; border: 1px solid {{t.line}}; border-radius: 12px; background: {{t.surface}}; color: {{t.ink}}; font-family: inherit; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; text-decoration: none; cursor: pointer;">Editar materia</a>\n              <a href="{{go.unitNew}}"'],
  ["    g.copyUnit = b('SubjectCopied');", "    g.copyUnit = b('SubjectCopied');\n    g.editSubject = b('GapSubjectStyle');"],
  ["style: 'Estilo de la materia guardado'", "style: 'Cambios de la materia guardados'"]
]);

const cp = dir + '/canvas.json';
const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
const ren = { 'GapSubjectStyle': 'Editar materia · datos y estilo', 'SubjectStyleSaved': 'Materia · cambios guardados' };
for (const [k, v] of Object.entries(ren)) {
  c.boards[k + '.dc.html'].title = v + ' (claro)';
  c.boards[k + 'Dark.dc.html'].title = v + ' (oscuro)';
}
fs.writeFileSync(cp, JSON.stringify(c));
console.log('ok canvas.json');
