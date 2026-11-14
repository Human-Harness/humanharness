// Applies option C confirmations (chips in place, toasts for results elsewhere) to canvas components.
const fs = require('fs');
const dir = process.argv[2];
const rd = (f) => fs.readFileSync(dir + '/' + f + '.dc.html', 'utf8');
const wr = (f, s) => fs.writeFileSync(dir + '/' + f + '.dc.html', s);
function rep(s, a, b, f) { if (!s.includes(a)) throw new Error(f + ': missing ' + a.slice(0, 80)); return s.replace(a, b); }

const CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>';
const chip = (cond, text, undo) => `<sc-if value="{{${cond}}}" hint-placeholder-val="{{ false }}"><span role="status" style="font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 8px; background: {{t.green}}; color: {{t.greenInk}}; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">${CHECK}${text}</span>` + (undo ? `<a href="{{${undo}}}" style="font-size: 12px; font-weight: 500; color: {{t.ink}}; text-decoration: underline; cursor: pointer; white-space: nowrap;">Deshacer</a>` : '') + `</sc-if>`;
const TOAST = `  <sc-if value="{{cf.toast}}" hint-placeholder-val="{{ false }}">
    <div role="status" style="position: absolute; left: 50%; bottom: 32px; transform: translateX(-50%); display: flex; gap: 16px; align-items: center; padding: 10px 12px 10px 16px; border-radius: 12px; background: {{t.ink}}; color: {{t.bg}}; font-size: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.18); white-space: nowrap; z-index: 5;"><span>{{cf.toastText}}</span><a href="{{cf.toastHref}}" style="color: {{cf.toastLink}}; font-weight: 600; text-decoration: none; cursor: pointer;">{{cf.toastAction}}</a></div>
  </sc-if>
`;
// cfg: { key: {flags..., toast, action, href} } ; flags become booleans on o.cf
function logic(cfg, extra) {
  return `    const c = this.props.confirm || '';
    const CF = ${JSON.stringify(cfg)};
    const e = CF[c] || {};
    o.cf = { ...e, toast: !!e.toast, toastText: e.toast || '', toastAction: e.action || '', toastHref: e.href ? g[e.href] : '', toastLink: this.props.dark ? '#7a4f00' : o.t.cta, draft: !e.approved };
${extra || ''}    o.go = g;`;
}
function common(f, s, cfg, extra) {
  s = rep(s, '"dark":{"editor":"boolean","default":false},', '"dark":{"editor":"boolean","default":false},"confirm":{"editor":"text","default":""},', f);
  s = rep(s, '    o.go = g;', logic(cfg, extra), f);
  s = rep(s, '\n</div>\n</x-dc>', '\n' + TOAST + '</div>\n</x-dc>', f);
  const lines = s.split('\n');
  if (!/position: relative/.test(lines[16])) { lines[16] = lines[16].replace(/;">$/, '; position: relative;">'); if (!/position: relative/.test(lines[16])) throw new Error(f + ': root'); }
  return lines.join('\n');
}

// Plan: "Crear las 32 clases" -> toast, result lives in Materia.
{
  const f = 'Plan'; let s = rd(f);
  s = rep(s, '<a href="{{go.subject}}" style="height: 32px; padding: 0 16px; border: 0; border-radius: 12px; background: {{t.cta}}', '<a href="{{go.created}}" style="height: 32px; padding: 0 16px; border: 0; border-radius: 12px; background: {{t.cta}}', f);
  s = common(f, s, { created: { toast: '32 clases creadas en Biología 2º B, como pendientes', action: 'Ver las clases', href: 'subject' } }, "    g.created = b('PlanCreated');\n");
  wr(f, s);
}

// ExamReview: Aprobar in place, Guardar pregunta in place, Exportar -> toast.
{
  const f = 'ExamReview'; let s = rd(f);
  const lines = s.split('\n');
  const i46 = lines.findIndex((l) => l.includes('{{t.blueInk}};">Borrador</span>'));
  lines[i46] = '              <sc-if value="{{cf.draft}}" hint-placeholder-val="{{ true }}">' + lines[i46].trim() + '</sc-if>' +
    '<sc-if value="{{cf.approved}}" hint-placeholder-val="{{ false }}"><span role="status" style="font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 8px; background: {{t.green}}; color: {{t.greenInk}};">Aprobado</span><a href="{{go.examReview}}" style="font-size: 12px; font-weight: 500; color: {{t.ink}}; text-decoration: underline; cursor: pointer;">Deshacer</a></sc-if>' +
    chip('cf.saved', 'Pregunta 1 guardada', 'go.examReview');
  const iA = lines.findIndex((l) => l.includes('<a href="{{go.exams}}" style="height: 32px; padding: 0 16px; border: 0; border-radius: 12px; background: {{t.cta}}'));
  lines[iA] = '            <sc-if value="{{cf.draft}}" hint-placeholder-val="{{ true }}">' + lines[iA].trim().replace('href="{{go.exams}}"', 'href="{{go.approve}}"') + '</sc-if>' +
    `<sc-if value="{{cf.approved}}" hint-placeholder-val="{{ false }}"><span style="height: 32px; padding: 0 16px; border-radius: 12px; background: {{t.green}}; color: {{t.greenInk}}; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box;">${CHECK}Aprobado</span></sc-if>`;
  s = lines.join('\n');
  s = common(f, s, {
    approved: { approved: true },
    saved: { saved: true },
    exported: { toast: '3 PDF exportados: versión A, versión B y la clave', action: 'Mostrar en la carpeta', href: 'self' }
  }, "    g.approve = b('ExamReviewApproved');\n    g.self = b(c === 'exported' ? 'ExamReviewExported' : 'ExamReview');\n");
  wr(f, s);
}

// Settings: colegio, MLA and Instalar all in place.
{
  const f = 'Settings'; let s = rd(f);
  s = rep(s, '<h2 style="margin: 0; font-size: 16px; font-weight: 600; flex-grow: 1;">Colegios</h2>', '<h2 style="margin: 0; font-size: 16px; font-weight: 600;">Colegios</h2>' + chip('cf.school', 'Colegio San Martín guardado', 'go.settings') + '<span style="flex-grow: 1;"></span>', f);
  s = rep(s, '<h2 style="margin: 0; font-size: 16px; font-weight: 600;">Estilo de cita</h2>', '<div style="display: flex; align-items: center; gap: 8px;"><h2 style="margin: 0; font-size: 16px; font-weight: 600;">Estilo de cita</h2>' + chip('cf.cite', 'Guardado: MLA 9 en todas las materias', 'go.settings') + '</div>', f);
  s = rep(s, '<span role="radio" style="padding: 0 12px; display: flex; align-items: center; border-radius: 10px; background: {{t.surface}}; font-weight: 500;">APA 7</span>', '<a href="{{go.mla}}" role="radio" aria-checked="{{cf.apaOn}}" style="padding: 0 12px; display: flex; align-items: center; border-radius: 10px; background: {{cf.apaBg}}; font-weight: {{cf.apaW}}; color: {{cf.apaInk}}; text-decoration: none; cursor: pointer;">APA 7</a>', f);
  s = rep(s, '<span role="radio" style="padding: 0 12px; display: flex; align-items: center; color: {{t.muted}};">MLA 9</span>', '<a href="{{go.mla}}" role="radio" aria-checked="{{cf.mlaOn}}" style="padding: 0 12px; display: flex; align-items: center; border-radius: 10px; background: {{cf.mlaBg}}; font-weight: {{cf.mlaW}}; color: {{cf.mlaInk}}; text-decoration: none; cursor: pointer;">MLA 9</a>', f);
  const lines = s.split('\n');
  const iB = lines.findIndex((l) => l.includes('<button') && l.includes('>Instalar</button>'));
  if (iB < 0) throw new Error('Settings: Instalar');
  lines[iB] = lines[iB].replace('<button style="', '<a href="{{go.install}}" style="text-decoration: none; cursor: pointer; display: inline-flex; align-items: center; box-sizing: border-box; ').replace('>Instalar</button>', '>Instalar</a>');
  const iI = lines.findIndex((l) => l.includes('{{t.greenInk}};">Instalado</span>'));
  lines[iI] = lines[iI] + chip('m.justNow', 'Listo: ya lee fotocopias y fotos', '');
  s = lines.join('\n');
  s = common(f, s, { school: { school: true }, mla: { cite: true }, installed: { installed: true } },
    `    const t = o.t; const mla = c === 'mla';
    Object.assign(o.cf, { apaOn: String(!mla), mlaOn: String(mla), apaBg: mla ? 'transparent' : t.surface, mlaBg: mla ? t.surface : 'transparent', apaW: mla ? '400' : '500', mlaW: mla ? '500' : '400', apaInk: mla ? t.muted : t.ink, mlaInk: mla ? t.ink : t.muted });
    o.mods = (o.mods || []).map((m, i) => i === 0 && c === 'installed' ? { ...m, installed: true, notInstalled: false, justNow: true } : { ...m, justNow: false });
    g.mla = b(mla ? 'Settings' : 'SettingsMla'); g.install = b('SettingsInstalled');
`);
  wr(f, s);
}

// Source: "Guardar cambios" from the edit sheet lands here, in place.
{
  const f = 'Source'; let s = rd(f);
  s = rep(s, '<h1 style="margin: 0; font-size: 20px; font-weight: 600;">Fotosíntesis: la luz que alimenta al mundo</h1>', '<div style="display: flex; align-items: center; gap: 8px;"><h1 style="margin: 0; font-size: 20px; font-weight: 600;">Fotosíntesis: la luz que alimenta al mundo</h1>' + chip('cf.saved', 'Datos de la fuente guardados', 'go.source') + '</div>', f);
  s = common(f, s, { saved: { saved: true } }, '');
  wr(f, s);
}

// GapsSource (uploaded view): "Descargar el original" -> toast.
{
  const f = 'GapsSource'; let s = rd(f);
  s = rep(s, '<button style="height: 32px; padding: 0 12px; border-radius: 12px; font-family: inherit; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; border: 1px solid {{t.line}}; background: {{t.surface}}; color: {{t.ink}};">Descargar el original</button>',
    '<a href="{{go.downloaded}}" style="height: 32px; padding: 0 12px; border-radius: 12px; font-family: inherit; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; border: 1px solid {{t.line}}; background: {{t.surface}}; color: {{t.ink}}; box-sizing: border-box; text-decoration: none; cursor: pointer;">Descargar el original</a>', f);
  s = common(f, s, { downloaded: { toast: 'Descargado en Descargas: Kandus_2010_humedales_delta.pdf', action: 'Mostrar en la carpeta', href: 'downloaded' } }, "    g.downloaded = b('UploadedDownloaded');\n");
  wr(f, s);
}
console.log('ok');
