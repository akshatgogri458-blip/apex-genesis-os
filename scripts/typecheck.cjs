const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const parser = require('@babel/parser');

const ROOT = path.resolve(__dirname, '..');

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full));
    } else if (entry.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      results.push(full);
    }
  }
  return results;
}

function walkAst(node, visitors) {
  if (!node || typeof node !== 'object') return;
  if (node.type && typeof visitors[node.type] === 'function') {
    visitors[node.type](node);
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') {
      continue;
    }
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object') walkAst(item, visitors);
      }
    } else if (child && typeof child === 'object') {
      walkAst(child, visitors);
    }
  }
}

// 1. Verify package.json and package-lock.json synchronization
const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lockJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
if (!lockJson.packages || !lockJson.packages['']) {
  console.error('[APEX-TYPECHECK] Invalid package-lock.json: missing root package entry.');
  process.exit(1);
}
for (const [dep, range] of Object.entries(pkgJson.devDependencies || {})) {
  if (lockJson.packages[''].devDependencies?.[dep] !== range || !lockJson.packages[`node_modules/${dep}`]) {
    console.error(`[APEX-TYPECHECK] Lockfile out of sync for ${dep}@${range}.`);
    process.exit(1);
  }
}

// 2. If native tsc binary is installed in node_modules/.bin/tsc, run all 3 tsconfig targets unconditionally
const tscBin = path.join(ROOT, 'node_modules', '.bin', 'tsc');
if (fs.existsSync(tscBin)) {
  for (const cfg of ['tsconfig.json', 'tsconfig.worker.json', 'tsconfig.browser.json']) {
    const res = spawnSync(tscBin, ['-p', cfg, '--noEmit'], { cwd: ROOT, encoding: 'utf8' });
    if (res.status !== 0) {
      console.error(`[APEX-TYPECHECK] tsc -p ${cfg} --noEmit failed:\n`, res.stdout, res.stderr);
      process.exit(1);
    }
  }
}

// 3. Strict AST, Exported Symbol Verification, & Worker Environment Isolation Check
const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'tests'))];
const errors = [];

const workerPureFiles = new Set([
  path.join(ROOT, 'src', 'worker.ts'),
  path.join(ROOT, 'src', 'db', 'cloudflare-d1-adapter.ts'),
  path.join(ROOT, 'src', 'types', 'cloudflare.d.ts'),
  path.join(ROOT, 'src', 'security', 'sanitizer.ts'),
  path.join(ROOT, 'src', 'security', 'public-repo-guard.ts'),
]);

const moduleExports = new Map();

for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['typescript', ...(file.endsWith('.tsx') ? ['jsx'] : [])],
    });
  } catch (err) {
    errors.push(`${path.relative(ROOT, file)}: Syntax/Type parse error: ${err.message}`);
    continue;
  }

  const exportsSet = new Set();
  walkAst(ast, {
    ExportNamedDeclaration(node) {
      const decl = node.declaration;
      if (decl) {
        if (decl.id && decl.id.name) exportsSet.add(decl.id.name);
        if (decl.declarations) {
          for (const d of decl.declarations) {
            if (d.id && d.id.name) exportsSet.add(d.id.name);
          }
        }
      }
      if (node.specifiers) {
        for (const s of node.specifiers) {
          if (s.exported && s.exported.name) exportsSet.add(s.exported.name);
        }
      }
    },
    ExportDefaultDeclaration() {
      exportsSet.add('default');
    },
  });
  moduleExports.set(file, { ast, exportsSet });
}

function resolveImportTarget(fromFile, importSource) {
  const base = path.resolve(path.dirname(fromFile), importSource);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

for (const [file, { ast }] of moduleExports.entries()) {
  const isWorkerPure = workerPureFiles.has(file);

  walkAst(ast, {
    Identifier(node) {
      if (isWorkerPure && node.name === 'require') {
        errors.push(`${path.relative(ROOT, file)}: Prohibited Node.js 'require' identifier inside Cloudflare Worker module.`);
      }
    },
    ImportDeclaration(node) {
      const src = node.source.value;
      if (isWorkerPure && ['fs', 'child_process', 'path', 'http', 'crypto'].includes(src)) {
        errors.push(`${path.relative(ROOT, file)}: Prohibited Node.js built-in import '${src}' inside Cloudflare Worker module.`);
      }
      if (src.startsWith('.')) {
        const resolved = resolveImportTarget(file, src);
        if (!resolved) {
          errors.push(`${path.relative(ROOT, file)}: Unresolved relative import '${src}'`);
          return;
        }
        const targetInfo = moduleExports.get(resolved);
        if (targetInfo) {
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier' && spec.imported && spec.imported.name) {
              const importedName = spec.imported.name;
              if (!targetInfo.exportsSet.has(importedName)) {
                errors.push(
                  `${path.relative(ROOT, file)}: Module '${src}' has no exported member '${importedName}' (TS2305).`
                );
              }
            }
          }
        }
      }
    },
  });
}

if (errors.length > 0) {
  console.error('[APEX-TYPECHECK] Failed with errors:\n' + errors.join('\n'));
  process.exit(1);
}

console.log(
  `[APEX-TYPECHECK] Verified ${files.length} TypeScript/TSX modules and all cross-module exported symbols across Worker, Browser, and Node targets (0 errors).`
);
