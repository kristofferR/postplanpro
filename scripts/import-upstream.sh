#!/bin/sh
# Imports a published postplan release from npm onto the upstream branch,
# unmodified. Merge it into main afterwards with: git merge upstream
set -eu

version=${1:?Usage: scripts/import-upstream.sh <version>}
root=$(git rev-parse --show-toplevel)
worktree=$(mktemp -d)
trap 'git -C "$root" worktree remove --force "$worktree"' EXIT

git -C "$root" worktree add -q "$worktree" upstream
cd "$worktree"
git rm -rq .
curl -fsSL "https://registry.npmjs.org/postplan/-/postplan-$version.tgz" | tar xz --strip-components=1
git add -A
git commit -qm "Import postplan $version from npm"
printf 'Imported postplan %s onto upstream. Next: git merge upstream\n' "$version"
