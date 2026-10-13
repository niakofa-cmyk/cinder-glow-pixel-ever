#!/usr/bin/env bash
# Executed non-interactively from Replit after an approved task merge.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "[post-merge] Restoring dependencies from package-lock.json"
npm ci --no-audit --no-fund

echo "[post-merge] Checking merged TypeScript"
npm run typecheck

# The project's build already invokes its idempotent migration runner.
echo "[post-merge] Building and applying the project's pending migrations"
npm run build

echo "[post-merge] Setup complete; Replit will reconcile managed workflows"
