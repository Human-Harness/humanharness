// Gaps* components draw the magnifier as a span; make it a link to Search too.
const fs = require('fs');
const dir = process.argv[2];
const re = /<span aria-label="Buscar" style="([^"]*)">(<svg[\s\S]*?<\/svg>)<\/span>/g;
for (const n of ['GapsClass', 'GapsMisc', 'GapsSource', 'GapsYear']) {
  const f = dir + '/' + n + '.dc.html';
  let s = fs.readFileSync(f, 'utf8');
  const k = (s.match(re) || []).length;
  s = s.replace(re, (m, st, svg) => `<a href="{{go.search}}" aria-label="Buscar" style="${st} text-decoration: none; cursor: pointer;">${svg}</a>`);
  if (!s.includes("g.search = b('Search')")) s = s.replace('    o.go = g;', "    g.search = b('Search');\n    o.go = g;");
  fs.writeFileSync(f, s);
  console.log(n, k);
}
