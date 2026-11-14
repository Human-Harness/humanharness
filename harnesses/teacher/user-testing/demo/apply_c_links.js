// Repoints the save/approve/export links to the new confirmation boards.
const fs = require('fs');
const dir = process.argv[2];
const edits = {
  GapsClass: [['subject', 'Aprobar', 'cfApprove', 'ClassEditApproved', 4], ['classEdit', 'Guardar', 'cfClassSaved', 'ClassEditSaved', 1]],
  GapsMisc: [['examReview', 'Guardar pregunta', 'cfQSaved', 'ExamReviewSaved', 1], ['settings', 'Guardar colegio', 'cfSchoolSaved', 'SettingsSaved', 1], ['subject', 'Guardar', 'cfStyleSaved', 'SubjectStyleSaved', 1]],
  SubjectFlow: [['subject', 'Crear unidad', 'cfUnit', 'SubjectUnit', 1]],
  ExportFlow: [['examReview', 'Exportar 3 PDF', 'cfExported', 'ExamReviewExported', 1]]
};
for (const [f, list] of Object.entries(edits)) {
  const p = dir + '/' + f + '.dc.html';
  let s = fs.readFileSync(p, 'utf8');
  const keys = [];
  for (const [from, label, key, board, n] of list) {
    const re = new RegExp('href="\\{\\{go\\.' + from + '\\}\\}"([^>]*)>' + label + '<', 'g');
    const hits = (s.match(re) || []).length;
    if (hits !== n) throw new Error(f + ' ' + label + ': ' + hits);
    s = s.replace(re, 'href="{{go.' + key + '}}"$1>' + label + '<');
    keys.push('g.' + key + " = b('" + board + "');");
  }
  if (!s.includes('    o.go = g;')) throw new Error(f + ': o.go');
  s = s.replace('    o.go = g;', '    ' + keys.join(' ') + '\n    o.go = g;');
  fs.writeFileSync(p, s);
}
{
  const p = dir + '/SourceSheet.dc.html';
  let s = fs.readFileSync(p, 'utf8');
  const a = "g.sheetSave = nw ? g.uploaded : g.source;";
  if (!s.includes(a)) throw new Error('SourceSheet');
  s = s.replace(a, "g.sheetSave = nw ? g.uploaded : b('SourceSaved');");
  fs.writeFileSync(p, s);
}
console.log('ok');
