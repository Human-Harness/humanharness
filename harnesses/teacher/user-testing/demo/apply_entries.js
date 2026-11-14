// Entry points H03 (A: "+ 2027" year tab), H04 (B: row under the subject list), H05 (C: "Editar categorías" header button).
const fs = require('fs');
const dir = process.argv[2];
const edit = (file, pairs) => {
  const p = dir + '/' + file;
  let s = fs.readFileSync(p, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(file + ': not found: ' + a.slice(0, 80));
    s = s.replace(a, b);
  }
  fs.writeFileSync(p, s);
  console.log('ok', file);
};

// H03: Subject year tabs get "+ 2027" (current year, not flat) linking to GapYearStart.
edit('Subject.dc.html', [[
  "o.years = (o.years || []).map((y) => ({ ...y, href: String(y.label).startsWith('2026') ? g.subject : g.subjectPast }));",
  "o.years = (o.years || []).map((y) => ({ ...y, href: String(y.label).startsWith('2026') ? g.subject : g.subjectPast }));\n    if (!this.props.flat && o.current) o.years = o.years.concat([{ label: '+ 2027', href: g.yearStart, bg: 'transparent', ink: o.t.ink, w: '500' }]);"
]]);

// H04: drop the header link, add a dashed row after the subject groups (any non-empty home).
const row = `
          <sc-if value="{{notEmpty}}" hint-placeholder-val="{{ true }}">
            <a href="{{go.past}}" style="height: 44px; padding: 0 16px; border: 1px dashed {{t.lineS}}; border-radius: 14px; display: flex; align-items: center; gap: 8px; font-size: 14px; color: {{t.muted}}; text-decoration: none; cursor: pointer;"><span style="flex-grow: 1;">Materias que ya no das · 2</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg></a>
          </sc-if>
`;
edit('OptB.dc.html', [
  [`        <sc-if value="{{full}}" hint-placeholder-val="{{ false }}">
          <a href="{{go.past}}" style="height: 32px; display: flex; align-items: center; font-size: 14px; color: {{t.muted}}; text-decoration: none; cursor: pointer;">Materias que ya no das · 2</a>
        </sc-if>
`, ''],
  [`          </sc-for>

          <sc-if value="{{normal}}" hint-placeholder-val="{{ true }}">`, `          </sc-for>
${row}
          <sc-if value="{{normal}}" hint-placeholder-val="{{ true }}">`]
]);

// H05: "Editar categorías" secondary button left of "Agregar fuente".
edit('Library.dc.html', [
  [`        <a href="{{go.addMenu}}" style="height: 32px; padding: 0 12px 0 16px;`,
   `        <a href="{{go.cats}}" style="height: 32px; padding: 0 12px; border: 1px solid {{t.line}}; border-radius: 12px; background: {{t.surface}}; color: {{t.ink}}; font-family: inherit; font-size: 14px; font-weight: 500; display: flex; align-items: center; box-sizing: border-box; text-decoration: none; cursor: pointer;">Editar categorías</a>
        <a href="{{go.addMenu}}" style="height: 32px; padding: 0 12px 0 16px;`],
  [`    o.go = g;`, `    g.cats = b('GapCategories');\n    o.go = g;`]
]);
