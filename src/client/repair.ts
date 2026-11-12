/**
 * Backward compatibility for answers stored by older versions of the component library.
 *
 * Two kinds of drift are real in saved conversations:
 *
 *  1. Positional arguments moved. `Card([...], "column", "s")` was produced while `Card`'s
 *     second positional was its flex direction; today that slot is `variant`, so the call
 *     fails validation and the card (with everything inside it) disappears from a saved
 *     answer. `Text("some prose")` is the same story: `Text`'s first positional is now the
 *     `variant`, so an old one-argument call validates as `variant: "some prose"` and the
 *     text is dropped.
 *  2. Stored diagnostics. Older builds persisted render errors next to the answer; when the
 *     program was later fixed (or the library accepted it) the red panel stayed forever.
 *
 * The fix is applied to the *program text at render time only*. Stored content is never
 * rewritten, so a repair cannot damage a conversation, and a program that already parses is
 * returned unchanged (verified by test).
 */

const FLEX_DIRECTIONS = new Set(["row", "column"]);
const GAPS = new Set(["none", "xs", "s", "m", "l", "xl", "2xl"]);
const CARD_VARIANTS = new Set(["card", "sunk", "clear"]);
const TEXT_VARIANTS = new Set(["text", "number"]);

/** Calls this module knows how to repair. Everything else is copied through untouched. */
const REPAIRABLE = ["Card", "Text", "Query", "Mutation", "Callout"];

/**
 * Component names the model spells the ordinary English way.
 *
 * `MarkDownRenderer` ships with an interior capital the word does not have — it is the
 * library's spelling, not a typo of ours — and a model asked for a markdown renderer writes
 * `MarkdownRenderer`. The parser does not guess: it reports `Unknown component
 * "MarkdownRenderer"`, and because the call is a leaf whose value is the whole prose of the
 * answer, what the reader gets is a red "could not be drawn" panel and no text at all. That
 * is the one mistake in this file worth repairing by name rather than by slot: the arguments
 * are already right, only the identifier the library is indexed by is wrong.
 *
 * Kept as a table instead of a case-insensitive lookup so a companion bundle's component can
 * never be reached by misspelling it: every entry here names a shipped component, and
 * `repair.test.ts` fails if one of them stops resolving.
 */
export const COMPONENT_ALIASES: Record<string, string> = {
  MarkdownRenderer: "MarkDownRenderer",
  MarkdownRender: "MarkDownRenderer",
  // The same class of slip: the library splits the compound, English does not.
  CheckboxGroup: "CheckBoxGroup",
  CheckboxItem: "CheckBoxItem",
};

/** Every call the walk has to look at, by either spelling. */
const REPAIRABLE_CALLS = [...REPAIRABLE, ...Object.keys(COMPONENT_ALIASES)];

function unquote(token: string): string | null {
  const t = token.trim();
  if (t.length < 2) return null;
  const q = t[0];
  if (q !== '"' && q !== "'") return null;
  if (t[t.length - 1] !== q) return null;
  // No escapes and no interpolation: only a plain literal is safe to reinterpret.
  if (t.slice(1, -1).includes("\\") || t.slice(1, -1).includes(`${q}`)) return null;
  return t.slice(1, -1);
}

/** Split a call's argument text on top-level commas, leaving nested calls/lists intact. */
export function splitArgs(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
    } else if (ch === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out.map((a) => a.trim()).filter((a) => a.length > 0);
}

/** Index of the `)` matching the `(` at `open`, or -1. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * A plain string literal, or the literal tail of `<stray word> "literal"`.
 *
 * The second shape is a Callout slip seen in practice:
 * `Callout("info", "Title", results "Swapped the …")` — a dropped comma left an undefined
 * word in front of the description. The word is not a statement in the program, so it
 * cannot be a value; the literal after it is the text that belongs in the slot. Nothing
 * else is guessed: a computed expression or a defined name returns null and is left alone.
 */
function stringValue(arg: string | undefined, names: Set<string>): string | null {
  if (arg === undefined) return null;
  const literal = unquote(arg);
  if (literal !== null) return literal;
  const stray = /^([A-Za-z_][A-Za-z0-9_]*)\s+([\s\S]+)$/.exec(arg.trim());
  if (!stray) return null;
  if (names.has(stray[1])) return null;
  return unquote(stray[2]);
}

/**
 * `Callout(variant, title, description, $visible)`.
 *
 * `description` is required, and slot four is a `$binding<boolean>` visibility flag. A
 * saved answer sometimes carries a string there — the model shifted a line of text into
 * the binding slot, or dropped the comma that separated the two — which fails validation
 * with `"/visible" expects boolean but got string` and `"/description" cannot be null`,
 * and the whole callout disappears. The text is moved into the description it was meant
 * to be; it is never coerced into a boolean, and it is never dropped. When the value in
 * slot four is not a string and not a boolean, the call is left untouched rather than
 * guessed at.
 */
function repairCallout(args: string[], names: Set<string>): string[] | null {
  if (args.length < 2) return null;
  const fourth = args[3]?.trim();
  // A real reactive binding is the documented shape: nothing to repair.
  if (fourth !== undefined && fourth.startsWith("$")) return null;
  const description = stringValue(args[2], names);
  const spill = fourth === undefined ? null : stringValue(fourth, names);
  if (fourth !== undefined && spill === null && fourth !== "true" && fourth !== "false") {
    return null;
  }
  // Nothing recognisable in either text slot: leave the honest failure, do not invent copy.
  if (description === null && spill === null) return null;
  const text =
    description === null ? spill! : spill === null ? description : `${description} ${spill}`;
  return [args[0], args[1], JSON.stringify(text)];
}

/**
 * Repair one call's positional arguments. Returns the rewritten arguments, or null when
 * nothing needed changing.
 *
 * Everything here stays POSITIONAL. An earlier version of this repair rewrote the legacy
 * `Card(children, "column", "s")` into `Card(children, direction: "column", gap: "s")`,
 * and the parser has no named-argument syntax: it read `direction: "column"` as one more
 * positional value, so `gap` received `"column"` and `wrap` received a string. The card
 * still failed to draw, and it failed with a *different* error than the one in the stored
 * answer. A repair has to produce text the parser actually accepts - so a missing slot is
 * filled with the component's default instead of being named.
 */
function repairCall(
  name: string,
  args: string[],
  literals: Map<string, string>,
  names: Set<string>,
): string[] | null {
  if (name === "Callout") return repairCallout(args, names);
  if (name === "Card") {
    if (args.length < 2) return null;
    const second = unquote(args[1]);
    if (second === null) return null;
    // Already a variant, or an expression we cannot read: not ours to guess.
    if (CARD_VARIANTS.has(second)) return null;
    // `Card(children, "column", "m")`: the model skipped the optional variant, which is
    // the slot everything after shifts by.
    if (FLEX_DIRECTIONS.has(second)) return [args[0], '"card"', ...args.slice(1)];
    if (GAPS.has(second)) return [args[0], '"card"', '"column"', ...args.slice(1)];
    return null;
  }

  if (name === "Text" && args.length === 1) {
    const value = unquote(args[0]);
    if (value !== null && !TEXT_VARIANTS.has(value)) {
      return ['"text"', args[0]];
    }
    return null;
  }

  if (name === "Query" || name === "Mutation") {
    // A tool argument that names a statement (`prompt = "…"`, then `{prompt: prompt}`)
    // is evaluated with only Query/Mutation results in scope, so a plain value statement
    // arrives at the tool as `null` - the host route then rejects it as a type error and
    // the picture never renders. Inlining a statement whose whole value is one unambiguous
    // string literal restores exactly the text the tool needs. Ambiguous or computed
    // statements are left alone: better a visible, honest failure than a guess.
    const at = args.findIndex((arg) => arg.trim().startsWith("{"));
    if (at < 0) return null;
    const object = args[at].trim();
    if (!object.endsWith("}")) return null;
    const entries = splitArgs(object.slice(1, -1));
    let changed = false;
    const next = entries.map((entry) => {
      const named = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(entry);
      if (!named) return entry;
      const literal = literals.get(named[2]);
      if (literal === undefined) return entry;
      changed = true;
      return `${named[1]}: ${literal}`;
    });
    if (!changed) return null;
    const out = [...args];
    out[at] = `{${next.join(", ")}}`;
    return out;
  }

  return null;
}

/**
 * Value statements whose entire right-hand side is a plain string literal, keyed by name.
 * A name assigned more than once is dropped: the reference could mean either value.
 */
function literalStatements(program: string): Map<string, string> {
  const literals = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const line of program.split("\n")) {
    const assigned = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line.trim());
    if (!assigned) continue;
    const [, name, raw] = assigned;
    const value = raw.trim();
    if (unquote(value) === null) continue;
    if (literals.has(name) || ambiguous.has(name)) {
      literals.delete(name);
      ambiguous.add(name);
      continue;
    }
    literals.set(name, value);
  }
  return literals;
}

/** Every name the program assigns, whatever shape its value has. */
function statementNames(program: string): Set<string> {
  const names = new Set<string>();
  for (const line of program.split("\n")) {
    const assigned = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line.trim());
    if (assigned) names.add(assigned[1]);
  }
  return names;
}

/** Walk every `Name(...)` call in the program, innermost first, repairing as it goes. */
function walk(
  text: string,
  literals: Map<string, string>,
  names: Set<string>,
): { text: string; changed: boolean } {
  let out = "";
  let changed = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      // Copy string literals verbatim.
      const quote = ch;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") j += 2;
        else if (text[j] === quote) {
          j++;
          break;
        } else j++;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      const name = text.slice(i, j);
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === "(") {
        const close = closingParen(text, k);
        if (close > 0) {
          const inner = walk(text.slice(k + 1, close), literals, names);
          changed = changed || inner.changed;
          const args = splitArgs(inner.text);
          // A member access is a value, not a component: `state.markdownRenderer(...)` is
          // the model's own name for something, and renaming it would address a symbol the
          // program never defined.
          const member = out.replace(/\s+$/, "").endsWith(".");
          const called = member ? name : COMPONENT_ALIASES[name] ?? name;
          if (called !== name) changed = true;
          const repaired = repairCall(called, args, literals, names);
          if (repaired) changed = true;
          out += `${called}(${(repaired ?? args).join(", ")})`;
          i = close + 1;
          continue;
        }
      }
      out += name;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return { text: out, changed };
}

/** A call head: `TextContent(`. What a component call starts with, and prose does not. */
const CALL_HEAD = /^[A-Z][A-Za-z0-9_]*\s*\(/;

/**
 * A one-line answer with nothing binding it to the entry point: `TextContent("Two.")`.
 *
 * The format allows a reply that is a single component, and a model writes it as the call
 * alone - the statement in front of it reads as ceremony when there is only one element. The
 * renderer has no entry point to paint without `root`, so that answer arrived as an empty
 * row, and the row's own gate showed it as raw source rather than an interface. The call is
 * already right; the repair is the missing statement and nothing else. Only a body that is
 * exactly one balanced call is touched, so prose that happens to open a bracket is not one.
 */
export function rootlessCall(program: string): string | null {
  const text = program.trim();
  if (!CALL_HEAD.test(text)) return null;
  const open = text.indexOf("(");
  if (closingParen(text, open) !== text.length - 1) return null;
  return `root = ${text}`;
}

/** Returns the program unchanged when it needs no repair (identity for current output). */
export function repairProgram(program: string): string {
  if (!program) return program;
  // A bare call becomes a program first, so the rest of the walk reads ordinary statements.
  const rooted = rootlessCall(program) ?? program;
  // Cheap gate: only programs that call something repairable are worth walking.
  if (!REPAIRABLE_CALLS.some((name) => rooted.includes(`${name}(`))) return rooted;
  const literals = literalStatements(rooted);
  const result = walk(rooted, literals, statementNames(rooted));
  // A program the current library already accepts must come back byte-identical.
  return result.changed ? result.text : rooted;
}

type UiError = string | { code?: string; message?: string; component?: string; path?: string };

/**
 * Turn renderer diagnostics into something a person can read: one line per distinct
 * problem, without the catalogue dump the library appends to unknown-component errors.
 */
export function friendlyErrors(errors: unknown): string {
  const list: UiError[] = Array.isArray(errors) ? errors : [String(errors)];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of list) {
    const message = typeof raw === "string" ? raw : raw?.message ?? raw?.code ?? "";
    if (!message) continue;
    const clean = message
      .split("\n")[0]
      .replace(/\s*[—-]\s*Available components?:.*$/i, "")
      .trim();
    // The catalog dump for an unknown component is 80 lines of names; name the component
    // instead and leave the source one click away.
    const simplified = /^Unknown component "([^"]+)"/.exec(clean)
      ? `The answer asked for a component this version does not have (${/^Unknown component "([^"]+)"/.exec(clean)![1]}).`
      : clean;
    if (seen.has(simplified)) continue;
    seen.add(simplified);
    lines.push(simplified);
    if (lines.length === 4) break;
  }
  return lines.join("\n");
}