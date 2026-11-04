#!/usr/bin/env bash
# Regenerate the OpenUI catalogue half of the system prompt.
#
# The prompt the model reads is assembled at request time from three assets:
#
#   assets/prompt-core.txt   the component catalogue + the default tool surface (generated)
#   assets/prompt-anime.md   the opt-in anime workflow (hand-written, appended only when
#                            `workflows` enables it)
#   assets/prompt-rules.md   the harness rules (hand-written, always last)
#
# This script only regenerates the first one. It writes a *candidate* rather than the file the
# plugin reads, because the committed catalogue is hand-edited for the harness's own answer
# format: diff it, adopt what changed, then run `bun test`.
set -euo pipefail
cd "$(dirname "$0")/.."

out=assets/prompt-core.candidate.txt
bunx @openuidev/cli@latest generate src/client/library.tsx \
  --out "$out" \
  --prompt-options genuiPromptOptions

echo
echo "wrote $out"
diff -u assets/prompt-core.txt "$out" || true
echo
echo "rules and the anime workflow are not regenerated: assets/prompt-rules.md, assets/prompt-anime.md"
