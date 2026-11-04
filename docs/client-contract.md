# Client contract: why the assistant row is shadowed

Findings from reading the installed DSH client (`@deepseek-ai/dsh-client-ui-*`, 0.2.1-rc.5)
while choosing how this bundle should paint an answer. They decided the architecture, and they
are the reason the plugin does not claim the assistant events with an exclusive Definition.

## 1. The exclusive-claim path loses the Turn tail

Claiming `assistant/live-chunk` and `assistant/message` with an exclusive Definition is the
obvious design, and it breaks the row's footer:

- `TurnTailChatData.closing` is built from the **business** Assistant payload published on the
  step (`dsh-client-ui-chat`: `turn.steps.map((step) => step.data.get("assistant-step"))`,
  then filtered to those carrying a `finalNode`).
- `TurnTailNodeView` renders the copy/fork/usage banner only when `closing !== null`; with no
  closing it returns just the `turnTail` feature slot.
- A Definition may publish Location data only under its own kind
  (`dsh-client-ui-conversation` throws when `data.key !== context.kind`), so a plugin cannot
  publish `assistant-step` data on the built-in's behalf.
- An exclusive claim on `assistant/message` stops the built-in Definition from settling, so
  `finalNode` is never published and `closing` stays `null`.

## 2. Decision: replace the `assistant-step` renderer at priority -1

`conversation.chat.node` is a keyed slot whose `priority` is the cell shadowing rank,
ascending: `priority: 0` is the shipped renderer, `-1` shadows it. The slot types are reachable
through `@deepseek-ai/dsh-client-ui-renderer/client`, which declares `ctx.slots`.

What this keeps:

- the built-in `assistant-step` Definition and its Context — there is still exactly one row;
- `AssistantChatData` in full, so Turn-tail actions, the token footer, the process
  disclosure, `answerAnchorSeq`/`answerStep` and `endsWithResponse` read what they read in
  stock DSH;
- the built-in `assistant/…` event handling, `llm/retry` reset, reasoning blocks and
  `assistant-step` Location data.

What it changes:

- the answer's pixels: an OpenUI program, or plain markdown when the mode is off;
- reasoning blocks are painted by this row instead of the built-in markdown body.

## 3. Liveness without a Definition

Replay safety needs to know whether a step was produced by *this page session* or loaded from
the session log. `AssistantChatData.status` is the signal: a live step is painted `running` at
least once, a stored step is already `settled` (or `interrupted`) the first time it is
painted. `src/client/assistant.ts` records that observation per `turn:step`.

Two consequences, both handled in `rowMode`:

- a stored step that is still `running` on load is a frozen prefix from an interrupted turn:
  it is painted as text, not as an endless "Building interface" shimmer;
- a provider that never streams a chunk makes a live step look historical. The missing
  frame's retry control is the fallback, and `isTailStep` covers the common case by letting
  the newest answer in the transcript render.

## 4. What to check in a browser

1. exactly one assistant row per step, and no duplicate built-in row;
2. Turn-tail copy/fork/branch and the token footer still render on a settled answer;
3. the "Building interface" line appears while streaming, then the OpenUI rendering;
4. reloading the session paints the same row once;
5. reasoning still appears above the answer;
6. no console error from the slot registration (`priority -1` must not collide).
