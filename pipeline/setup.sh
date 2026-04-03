#!/usr/bin/env bash
# Installs the Phase 1 CI/CD workflows into .github/workflows/.
# Requires a GitHub token with the `workflow` scope to push afterward.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET=".github/workflows"

mkdir -p "$TARGET"
cp "$SCRIPT_DIR/ci.yml"     "$TARGET/ci.yml"
cp "$SCRIPT_DIR/deploy.yml" "$TARGET/deploy.yml"

echo "Workflows copied to $TARGET/"
echo "Commit and push with a token that has the 'workflow' scope:"
echo "  git add .github/workflows && git commit -m 'Activate CI/CD workflows' && git push"
