# Client contract spike — findings and decision

Date: 2026-11-04. Installed DSH: `0.2.1-rc.5`. Checkout:
`/home/luimu/.npm/_npx/b5e10b118beccd0f`.

Browser verification (`hello` in the transcript, one row, copy/fork banner) is **not
recorded here**: this run stopped at Task 12 and the live E2E pass (Task 13) was left to the
operator. What follows is what the installed client source proves, which is what decided the
architecture.

## 1. The exclusive-claim path loses the Turn tail

The plan's primary design claims `assistant/live-chunk` and `assistant/message` with an
exclusive Definition. The installed client makes the consequence unambiguous:

- `TurnTailChatData.closing` is built from the **business** Assistant payload published on
  the step: `dsh-client-ui-chat/lib/client.js:11132`
  (`turn.steps.map((step) => step.data.get('assistant-step'))` → `.filter(has finalNode)`).
- `TurnTailNodeView` renders the copy/fork/usage banner **only when `closing !== null`**
  (`lib/client.js:7015`). With `closing === null` it returns just the `turnTail` feature slot.
- A Definition may publish Location data **only under its own kind**
  (`dsh-client-ui-conversation/lib/client.js:3216`: `data.key !== context.kind` throws), so a
  plugin Definition cannot publish `assistant-step` data on the built-in's behalf.
- Exclusive claims on `assistant/message` stop the built-in Definition from settling, so
  `finalNode` is never published and `closing` stays `null`.

That is exactly the degradation the plan says must trigger the fallback. It was chosen
statically; the browser check would only confirm it.

## 2. Decision: replace the `assistant-step` renderer at priority -1

`conversation.chat.node` is a keyed slot: `priority` is the cell shadowing rank, ascending,
so `priority: 0` is the shipped renderer and `-1` shadows it
(`dsh-client-ui-slots/lib/types/index.d.ts:566`). The slot types are reachable through
`@deepseek-ai/dsh-client-ui-renderer/client`, which declares `ctx.slots: SlotRegistry`.

What this keeps:

- the built-in `assistant-step` Definition and its Context (no duplicate row: there is only
  one row, painted by this plugin);
- `AssistantChatData` in full, so Turn-tail actions, the token footer, the process
  disclosure, `answerAnchorSeq`/`answerStep`, `endsWithResponse`, and the legacy
  composer/token projections all read what they read in stock DSH;
- the built-in `assistant/…` event handling, `llm/retry` reset, reasoning blocks, and
  `assistant-step` Location data.

What it changes:

- the answer's pixels: OpenUI program, or plain text, instead of markdown;
- reasoning blocks are painted by this row (a collapsed `<details>`) instead of the
  built-in `AssistantMarkdown` + `conversation.chat.reasoning.body` slot.

## 3. Liveness without a Definition

Replay safety needs to know whether a step was produced by *this page session* or loaded
from the log. `AssistantChatData.status` is the signal: a live step is painted `running` at
least once, a stored step is already `settled` (or `interrupted`) the first time it is
painted. `src/client/assistant.ts` records that observation per `turn:step`.

Two consequences, both resolved in `rowMode`:

- a stored step that is still `running` on load is a frozen prefix from an interrupted
  turn. It is painted as text, not as an endless "Building interface" shimmer.
- a provider that never streams a chunk makes a live step look historical. The missing
  frame's retry control is the fallback, same as the plan's risk 3.

## 4. What the operator should still check in the browser

1. exactly one assistant row per step, and no duplicate built-in row;
2. Turn-tail copy/fork/branch and the token footer still render on a settled answer;
3. the "Building interface" row appears while streaming, then the OpenUI rendering;
4. reloading the session paints the same row once;
5. reasoning still appears (collapsed) above the answer;
6. no console error from the slot registration (`priority -1` must not collide).
