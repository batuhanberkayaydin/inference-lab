#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Use this project's patched runtime without changing the machine-wide default.
if ! node scripts/check-node.mjs >/dev/null 2>&1; then
  task_nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$task_nvm_dir/nvm.sh" ]; then
    source "$task_nvm_dir/nvm.sh"
    nvm use --silent
  fi
fi
node scripts/check-node.mjs
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -r backend/requirements.txt
npm ci
npm run build
exec .venv/bin/python backend/server.py "$@"
