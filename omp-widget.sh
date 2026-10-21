#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

if ! command -v bun >/dev/null 2>&1; then
  printf 'OMP Toolkit: Bun is required. Install it from https://bun.sh/docs/installation\n' >&2
  exit 1
fi

exec bun run desktop:preview
