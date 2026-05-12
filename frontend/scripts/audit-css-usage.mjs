import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cssPath = path.join(root, 'src', 'App.css');
const sourceRoots = [path.join(root, 'src')];

const css = fs.readFileSync(cssPath, 'utf8');

const walk = (dir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
};

const sourceFiles = sourceRoots.flatMap((dir) => walk(dir));
const source = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

const classes = new Set();
for (const match of css.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) {
  const className = match[1];
  if (className.startsWith('codicon')) continue;
  classes.add(className);
}

const rows = [...classes]
  .map((className) => {
    const pattern = new RegExp(`(^|[^_a-zA-Z0-9-])${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^_a-zA-Z0-9-]|$)`, 'g');
    const matches = source.match(pattern);
    return { className, uses: matches?.length ?? 0 };
  })
  .sort((a, b) => b.uses - a.uses || a.className.localeCompare(b.className));

const used = rows.filter((row) => row.uses > 0);
const unused = rows.filter((row) => row.uses === 0);

console.log(`CSS classes in App.css: ${rows.length}`);
console.log(`Referenced in src: ${used.length}`);
console.log(`Not referenced in src: ${unused.length}`);
console.log('');
console.log('Top referenced classes:');
for (const row of used.slice(0, 40)) {
  console.log(`${String(row.uses).padStart(4, ' ')}  ${row.className}`);
}
console.log('');
console.log('Potential cleanup candidates (verify dynamic usage before deleting):');
for (const row of unused.slice(0, 80)) {
  console.log(`   0  ${row.className}`);
}
