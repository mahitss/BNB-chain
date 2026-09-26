#!/usr/bin/env bash
# Runs every Phase 1 verification in one pass.
# Requires node+pnpm, python 3.12+, go 1.23+, and a rust toolchain on PATH.
# On Windows, run from Git Bash.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> TypeScript workspace: install, format, lint, build, typecheck"
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm build
pnpm typecheck
pnpm test

echo "==> Python agent: venv, ruff lint, ruff format, import check"
if [ ! -d services/agent/.venv ]; then
  python -m venv services/agent/.venv
fi
if [ -x services/agent/.venv/bin/python ]; then
  AGENT_PY=services/agent/.venv/bin/python
  AGENT_PIP=services/agent/.venv/bin/pip
else
  AGENT_PY=services/agent/.venv/Scripts/python.exe
  AGENT_PIP=services/agent/.venv/Scripts/pip.exe
fi
"$AGENT_PIP" install --quiet --disable-pip-version-check -r services/agent/requirements.txt ruff
"$AGENT_PY" -m ruff check services/agent
"$AGENT_PY" -m ruff format --check services/agent
(cd services/agent && "../$AGENT_PY" -c "import app.main")

echo "==> Go execution: gofmt, vet, build"
test -z "$(gofmt -l services/execution)"
(cd services/execution && go vet ./... && go build ./...)

echo "==> Rust risk-engine: fmt, clippy, build"
(cd services/risk-engine && cargo fmt --check && cargo clippy -- -D warnings && cargo build)

echo "All checks passed."
