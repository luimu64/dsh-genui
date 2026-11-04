#!/usr/bin/env bash
# Regenerate the OpenUI half of the committed system prompt.
#
# The prompt is two parts: the component catalogue OpenUI renders from `library.tsx`, and
# the harness rules that no generator knows about. The rules live in
# `assets/prompt-rules.md`; this script only produces the catalogue.
#
# It writes a candidate rather than the file the plugin reads, because the committed
# catalogue has been hand-edited for the harness's own answer format. Diff the candidate
# against `assets/system-prompt.txt`, adopt what changed, then run the prompt test.
set -euo pipefail
cd "$(dirname "$0")/.."

bunx @openuidev/cli@latest generate src/client/library.tsx \
  --out /tmp/dsh-genui-prompt-body.txt \
  --prompt-options genuiPromptOptions

{
  cat /tmp/dsh-genui-prompt-body.txt
  echo
  cat assets/prompt-rules.md
} > assets/system-prompt.candidate.txt

echo "wrote assets/system-prompt.candidate.txt"
echo "body:  reference: assets/system-prompt.txt (everything before '## Harness rules')"
echo "rules: asset:     assets/prompt-rules.md"
wc -c assets/system-prompt.candidate.txt
