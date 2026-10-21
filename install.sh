#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/kamishino/omp-toolkit.git"
INSTALL_DIR="${OMP_TOOLKIT_HOME:-$HOME/.omp/omp-toolkit}"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
MIN_BUN="1.4.3"

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

version_ge() {
  awk -v have="$1" -v need="$2" 'BEGIN {
    split(have, h, "."); split(need, n, ".");
    for (i = 1; i <= 3; i++) {
      if (h[i] + 0 > n[i] + 0) exit 0;
      if (h[i] + 0 < n[i] + 0) exit 1;
    }
    exit 0;
  }'
}

command -v git >/dev/null 2>&1 || fail "git is required: https://git-scm.com/downloads"
command -v bun >/dev/null 2>&1 || fail "bun is required: https://bun.sh/docs/installation"

BUN_VERSION="$(bun --version)"
version_ge "$BUN_VERSION" "$MIN_BUN" ||
  fail "bun $MIN_BUN or newer is required (found $BUN_VERSION). Run: bun upgrade"

if [ -d "$INSTALL_DIR/.git" ]; then
  printf 'Updating %s\n' "$INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin main
  git -C "$INSTALL_DIR" reset --hard FETCH_HEAD
elif [ -e "$INSTALL_DIR" ]; then
  fail "$INSTALL_DIR exists and is not a git checkout. Move it or set OMP_TOOLKIT_HOME."
else
  printf 'Cloning into %s\n' "$INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

(
  cd "$INSTALL_DIR"
  bun install --frozen-lockfile
  bun run install:omp
)

printf '\nOMP Toolkit installed.\n'
printf 'Health CLI: bun "%s/scripts/omp-provider-usage.js" --health\n' "$AGENT_DIR"
printf 'OMP command: /gemini-health\n'
printf 'Orca tab: cd "%s" && bun run monitor:orca\n' "$INSTALL_DIR"
