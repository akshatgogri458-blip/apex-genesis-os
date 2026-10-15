const fs = require('fs');
const path = require('path');

let ts = null;
try {
  ts = require('typescript');
} catch (_) {
  ts = null;
}

let babel = null;
if (!ts) {
  babel = require('@babel/core');
}

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full));
    } else if (entry.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx')) && !full.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

function compileAll() {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'tests'))];
  let count = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const outRel = rel.replace(/\.(tsx|ts)$/, '.js');
    const outPath = path.join(DIST, outRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const code = fs.readFileSync(file, 'utf8');

    let compiledCode = '';
    if (ts) {
      const transpiled = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: file.endsWith('.tsx') ? ts.JsxEmit.React : ts.JsxEmit.None,
          esModuleInterop: true,
          sourceMap: false,
        },
      });
      compiledCode = transpiled.outputText;
    } else {
      const presets = [
        ['@babel/preset-typescript', { isTSX: file.endsWith('.tsx'), allExtensions: true }],
        ['@babel/preset-env', { targets: { node: '18' }, modules: 'commonjs' }],
      ];
      if (file.endsWith('.tsx')) {
        presets.push(['@babel/preset-react', { runtime: 'classic' }]);
      }
      const transformed = babel.transformSync(code, {
        filename: file,
        presets,
        sourceMaps: false,
      });
      compiledCode = transformed.code;
    }

    // Ensure Node 18 CommonJS test runner has WebCrypto initialized on globalThis when loading compiled dist/src/worker.js
    const prefix =
      rel === path.join('src', 'worker.ts')
        ? "if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }\n"
        : '';
    fs.writeFileSync(outPath, prefix + compiledCode, 'utf8');
    count++;
  }
  console.log(
    `[APEX-BUILD] Compiled ${count} TypeScript/TSX modules to dist/ using ${ts ? 'native TypeScript compiler' : 'portable @babel/core'}`
  );
}

compileAll();
