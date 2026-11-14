// Runs each linkified component's renderVals with stub props; checks every {{x.href}}/{{go.*}} hole resolves.
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const names = fs.readFileSync(process.argv[3], 'utf8').split(/\s+/).filter(Boolean);
const variants = {
  OptB: [{ scenario: 'normal' }, { scenario: 'full' }, { scenario: 'empty' }],
  Subject: [{ year: 'current' }, { year: 'past' }, { flat: true }, { year: 'past', confirm: 'copiedClass' }, { year: 'past', confirm: 'copyAll' }, { year: 'past', confirm: 'copiedAll' }, { confirm: 'unit' }],
  ClassEdit: [{}, { confirm: 'approving' }, { confirm: 'approved' }],
  ExamReview: [{}, { confirm: 'approving' }, { from: 'material' }],
  Plan: [{}, { confirm: 'sources' }],
  SourceSheet: [{ variant: 'new' }, { variant: 'edit' }, { variant: 'scan' }],
  ExamNew: [{ origin: 'classes' }, { origin: 'material' }],
  Chat: ['a', 'b', 'c', 'closed', 'narrow'].map((variant) => ({ variant })),
  Working: ['a', 'b', 'c', 'bg', 'exam', 'plan'].map((variant) => ({ variant })),
  SubjectFlow: ['new', 'empty', 'unit'].map((variant) => ({ variant })),
};
class DCLogic { constructor(props) { this.props = props; } }
let bad = 0;
for (const name of names) {
  const s = fs.readFileSync(path.join(dir, name + '.dc.html'), 'utf8');
  const js = s.match(/data-dc-script[^>]*>([\s\S]*?)<\/script>/)[1];
  const Component = new Function('DCLogic', js + '\nreturn Component;')(DCLogic);
  const holes = [...s.matchAll(/href="\{\{([^}]+)\}\}"/g)].map((m) => m[1]);
  for (const base of variants[name] || [{}]) {
    for (const dark of [false, true]) {
      const o = new Component({ ...base, dark }).renderVals();
      for (const h of holes) {
        const [root, key] = h.split('.');
        let vals;
        if (root === 'go') vals = [o.go[key]];
        else {
          // item hole: find any array in o whose items carry `key`
          vals = Object.values(o).filter(Array.isArray).flat().filter((x) => x && typeof x === 'object' && key in x).map((x) => x[key]);
          if (!vals.length) continue; // list not present in this variant
        }
        for (const v of vals) {
          const ok = typeof v === 'string' && /\.dc\.html$/.test(v) && (dark ? /Dark\.dc\.html$/.test(v) : !/Dark\.dc\.html$/.test(v));
          const exists = ok && fs.existsSync(path.join(dir, v));
          if (!exists) { bad++; console.log('BAD', name, JSON.stringify(base), dark, h, v); }
        }
      }
    }
  }
  console.log('ok', name, holes.length, 'links');
}
process.exit(bad ? 1 : 0);
