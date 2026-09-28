// For each id the DOM audit reported as missing, work out whether it is
// genuinely dead (referenced but never defined anywhere) or simply defined in
// markup/JS the audit did not reach (e.g. a modal it never opened).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const ids = process.argv.slice(2);
if (!ids.length) { console.error('usage: node tools/trace-missing-ids.js <id> [...]'); process.exit(1); }

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const jsDir = path.join(ROOT, 'app', 'js');
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js') && !/chart|bundle|\.min\./.test(f));

const dead = [], inHtml = [], inJs = [];

for (const id of ids) {
  const inHtmlTag = new RegExp('id="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(html);
  const sites = [];
  for (const f of jsFiles) {
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      if (line.includes(id)) sites.push(f + ':' + (i + 1));
    });
  }
  const definedInJs = sites.filter(s => {
    const [f, ln] = s.split(':');
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8').split(/\r?\n/);
    const line = src[Number(ln) - 1] || '';
    return /id\s*=\s*["'`]/.test(line) || /setAttribute\(\s*['"]id/.test(line) || /\.id\s*=/.test(line);
  });

  if (inHtmlTag) inHtml.push(id);
  else if (definedInJs.length) inJs.push({ id, definedAt: definedInJs });
  else dead.push({ id, referencedAt: sites.length, sites: sites.slice(0, 3) });
}

console.log(`\ndefined in index.html (audit simply did not reach them): ${inHtml.length}`);
inHtml.forEach(i => console.log('  ' + i));

console.log(`\ndefined by JS at runtime: ${inJs.length}`);
inJs.forEach(i => console.log(`  ${i.id}  <- ${i.definedAt.join(', ')}`));

console.log(`\nNEVER DEFINED ANYWHERE (genuinely dead references): ${dead.length}`);
dead.forEach(d => {
  console.log(`  ${d.id}   referenced ${d.referencedAt}x  e.g. ${d.sites.join(', ')}`);
});
