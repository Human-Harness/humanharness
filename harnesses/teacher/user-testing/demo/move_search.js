// Move the Search boards below every other board (they overlapped the ExamReview rows).
const fs = require('fs');
const p = process.argv[2];
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
const y = 39500;
c.boards['Search.dc.html'].y = y;
c.boards['SearchDark.dc.html'].y = y + 920;
c.notes.search.y = y - 100;
fs.writeFileSync(p, JSON.stringify(c));
console.log('moved');
