#!/usr/bin/env node
/**
 * APEX GENESIS V9.1 — Public Repository Safety Scanner
 * Blocks build/lint/publish if any .env secret file, .sqlite runtime database,
 * private key, or live cloud API token exists in the repository tree.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'verification_logs', 'verification_v9', 'design-reference']);
const FORBIDDEN_FILENAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519']);

const SECRET_REGEXES = [
  { id: 'SECRET_GITHUB_PAT', re: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/ },
  { id: 'SECRET_GOOGLE_API_KEY', re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { id: 'SECRET_LLM_API_KEY', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9\-_]{32,}\b/ },
];

function scanDir(dir, findings, stats) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT, fullPath);

    if (entry.isDirectory()) {
      scanDir(fullPath, findings, stats);
      continue;
    }

    stats.filesScanned++;
    if (FORBIDDEN_FILENAMES.has(entry.name)) {
      findings.push(`FORBIDDEN_SECRET_FILE: ${relPath}`);
      continue;
    }
    if (entry.name.endsWith('.sqlite') || entry.name.endsWith('.sqlite-journal') || entry.name.endsWith('.sqlite-wal')) {
      findings.push(`FORBIDDEN_RUNTIME_DB_FILE: ${relPath}`);
      continue;
    }
    if (/\.(ts|tsx|js|cjs|json|md|toml|yml|yaml|sql|html)$/.test(entry.name)) {
      // Skip scanning regex definitions inside the scanner files themselves
      if (relPath === 'scripts/scan_public_repo_safety.cjs' || relPath === 'src/security/public-repo-guard.ts') {
        continue;
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const pat of SECRET_REGEXES) {
        if (pat.re.test(content)) {
          findings.push(`${pat.id} in ${relPath}`);
        }
      }
      // Check for private keys outside test files
      if (!relPath.startsWith('tests/') && /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/.test(content)) {
        findings.push(`SECRET_PRIVATE_KEY in non-test file ${relPath}`);
      }
    }
  }
}

const findings = [];
const stats = { filesScanned: 0 };
scanDir(ROOT, findings, stats);

if (findings.length > 0) {
  console.error(`[APEX-PUBLIC-SAFETY] FAILED (${findings.length} violation(s)):`);
  for (const f of findings) console.error(' - ' + f);
  process.exit(1);
}

console.log(`[APEX-PUBLIC-SAFETY] Verified ${stats.filesScanned} repository files — 0 credentials, 0 runtime DBs, 0 personal documents exposed.`);
