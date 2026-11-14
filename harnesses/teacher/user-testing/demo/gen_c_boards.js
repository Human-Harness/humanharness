// Generates the option C confirmation wrapper boards (light + dark) and adds them to canvas.json.
const fs = require('fs');
const dir = process.argv[2];
const B = [
  ['ClassEditApproved', 'ClassEdit', 'confirm="approved"', 900, 'Editor de clase · recién aprobada'],
  ['ClassEditSaved', 'ClassEdit', 'confirm="saved"', 900, 'Editor de clase · datos guardados'],
  ['SubjectApproved', 'Subject', 'confirm="approved"', 1000, 'Materia · clase 27 aprobada'],
  ['SubjectUnit', 'Subject', 'confirm="unit"', 1000, 'Materia · unidad creada'],
  ['SubjectStyleSaved', 'Subject', 'confirm="style"', 1000, 'Materia · estilo guardado'],
  ['SubjectCopied', 'Subject', 'year="past" confirm="copied"', 1000, 'Año anterior · unidad copiada a 2026'],
  ['PlanCreated', 'Plan', 'confirm="created"', 1000, 'Plan del año · 32 clases creadas'],
  ['ExamReviewApproved', 'ExamReview', 'confirm="approved"', 1000, 'Examen · recién aprobado'],
  ['ExamReviewSaved', 'ExamReview', 'confirm="saved"', 1000, 'Examen · pregunta guardada'],
  ['ExamReviewExported', 'ExamReview', 'confirm="exported"', 1000, 'Examen · 3 PDF exportados'],
  ['SettingsSaved', 'Settings', 'confirm="school"', 1200, 'Ajustes · colegio guardado'],
  ['SettingsMla', 'Settings', 'confirm="mla"', 1200, 'Ajustes · MLA elegido'],
  ['SettingsInstalled', 'Settings', 'confirm="installed"', 1200, 'Ajustes · OCR instalado'],
  ['SourceSaved', 'Source', 'confirm="saved"', 900, 'Fuente · datos guardados'],
  ['UploadedDownloaded', 'GapsSource', 'variant="upl" confirm="downloaded"', 900, 'Fuente subida · original descargado']
];
const page = (title, comp, props, h, dark) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${title}${dark ? ', oscuro' : ''}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&amp;display=swap" rel="stylesheet">
<style>
body{margin:0}
</style>
</helmet>
<div style="width: 1280px; height: ${h}px; background: ${dark ? '#121315' : '#f3f3f1'};">
  <dc-import name="${comp}"${dark ? ' dark="{{yes}}"' : ''} ${props} hint-size="1280px,${h}px"></dc-import>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1280,"height":${h}}}'>
class Component extends DCLogic {
  renderVals() { return ${dark ? '{ yes: true }' : '{}'}; }
}
</script>
</body>
</html>
`;
const cp = dir + '/canvas.json';
const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
const Y0 = 34040, ROW = 1320, PER = 8;
B.forEach(([name, comp, props, h, title], i) => {
  const col = i % PER, grp = Math.floor(i / PER);
  const x = col * 1360, y = Y0 + grp * 2 * ROW;
  for (const dark of [false, true]) {
    const f = name + (dark ? 'Dark' : '') + '.dc.html';
    fs.writeFileSync(dir + '/' + f, page(title, comp, props, h, dark));
    c.boards[f] = { x, y: dark ? y + ROW : y, w: 1280, h, title: title + (dark ? ' (oscuro)' : ' (claro)'), is_interactive: true };
    if (!c.order.includes(f)) c.order.push(f);
  }
});
c.notes.confirm = { x: 0, y: Y0 - 100, text: 'Confirmaciones (H01): qué se ve después de cada acción', kind: 'title1', maxW: 10800 };
fs.writeFileSync(cp, JSON.stringify(c));
console.log('boards', Object.keys(c.boards).length);
