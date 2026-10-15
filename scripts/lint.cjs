const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full));
    } else if (entry.isFile() && /\.(ts|tsx|cjs|js)$/.test(full)) {
      results.push(full);
    }
  }
  return results;
}

const files = [
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'tests')),
  ...walk(path.join(ROOT, 'scripts')),
];

const violations = [];
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const forbiddenPath = ['/usr', 'share', 'nodejs'].join('/');
  if (rel !== 'scripts/lint.cjs' && content.includes(forbiddenPath)) {
    violations.push(`${rel}: Hardcoded system path '/usr/share/nodejs' is prohibited.`);
  }
  if (rel !== 'scripts/lint.cjs' && /\beval\s*\(/.test(content)) {
    violations.push(`${rel}: Use of eval() is prohibited.`);
  }
}

if (violations.length > 0) {
  console.error('[APEX-LINT] Violations found:\n' + violations.join('\n'));
  process.exit(1);
}
console.log(`[APEX-LINT] Checked ${files.length} source and build files — 0 violations.`);
