#!/usr/bin/env bash
set -euo pipefail

echo "[1/4] Scanning repository for credentials, runtime SQLite DBs, and candidate PII..."
node scripts/scan_public_repo_safety.cjs

echo "[2/4] Verifying TypeScript compilation and linter..."
npm run typecheck
npm run lint

echo "[3/4] Configuring canonical public remote https://github.com/akshatgogri458-blip/apex-genesis-os.git..."
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/akshatgogri458-blip/apex-genesis-os.git

echo "[4/4] Pushing branches feat/v9-1-public-repo-reliability and v9-production-truth..."
git push -u origin feat/v9-1-public-repo-reliability
git push -u origin v9-production-truth
echo "Published successfully to https://github.com/akshatgogri458-blip/apex-genesis-os"
