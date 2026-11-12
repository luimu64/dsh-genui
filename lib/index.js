// src/host/config.ts
import Schema from "@deepseek-ai/schemastery";
var Config = Schema.object({
  defaultOn: Schema.boolean().default(true).volatile()
});

// src/host/registry.ts
var EMPTY = "";
function createGenuiHostService() {
  const blocks = /* @__PURE__ */ new Map();
  const components = /* @__PURE__ */ new Map();
  const contexts = /* @__PURE__ */ new Map();
  const read = (reader) => {
    try {
      return reader().trim();
    } catch {
      return EMPTY;
    }
  };
  return {
    addPromptBlock(block) {
      blocks.set(block.id, block);
      return () => {
        if (blocks.get(block.id) === block) blocks.delete(block.id);
      };
    },
    addComponents(docs) {
      const installed = [];
      for (const doc of docs) {
        components.set(doc.name, doc);
        installed.push(doc);
      }
      return () => {
        for (const doc of installed) {
          if (components.get(doc.name) === doc) components.delete(doc.name);
        }
      };
    },
    addContext(id, text) {
      contexts.set(id, text);
      return () => {
        if (contexts.get(id) === text) contexts.delete(id);
      };
    },
    blocks(anchor) {
      const out = [];
      for (const block of blocks.values()) {
        if ((block.anchor ?? "append") !== anchor) continue;
        const text = read(block.text);
        if (text !== EMPTY) out.push(text);
      }
      return out;
    },
    components() {
      return [...components.values()];
    },
    contexts() {
      const out = [];
      for (const [id, reader] of contexts) {
        const text = read(reader);
        if (text !== EMPTY) out.push({ id, text });
      }
      return out;
    }
  };
}

// src/host/routes.ts
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var MAX_BODY_BYTES = 1024 * 1024;
function isLoopbackHost(host) {
  const bare = host.replace(/^\[|\]$/g, "");
  return bare === "localhost" || bare === "::1" || /^127\./.test(bare);
}
function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin !== "null") {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError(403, "invalid origin");
    }
    if (!isLoopbackHost(parsed.hostname)) throw new HttpError(403, "cross-origin request");
  }
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") {
    throw new HttpError(403, "cross-site request");
  }
}
async function readJson(req) {
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    throw new HttpError(415, "content-type must be application/json");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid json");
  }
}
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(text);
}
function sendText(res, status, message) {
  sendJson(res, status, { error: message });
}
function payload(body) {
  if (!body || typeof body !== "object") throw new HttpError(400, "expected a json object");
  const record = body;
  const inner = record.req ?? record.request;
  if (inner && typeof inner === "object") return inner;
  return record;
}
async function guardWith(req, res, run, log) {
  try {
    assertSameOrigin(req);
    await run();
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status >= 500) log.warn(`${req.method} ${req.url} -> ${status}: ${message}`);
    if (!res.headersSent) sendText(res, status, message);
    else res.end();
  }
}
function registerRoutes(ctx, mode) {
  const log = ctx.logger("dsh-genui");
  return [
    ctx.webServer.register({
      kind: "exact",
      path: "/genui/mode",
      handler: (req, res) => guardWith(req, res, async () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method === "GET") {
          const session2 = url.searchParams.get("session");
          if (!session2) {
            sendJson(res, 200, {
              default: mode.defaultOn,
              sessions: mode.sessions(),
              off: mode.offSessions()
            });
            return;
          }
          sendJson(res, 200, { session: session2, openui: mode.isOn(session2) });
          return;
        }
        const body = payload(await readJson(req));
        const session = typeof body.session === "string" ? body.session : "";
        if (!session) throw new HttpError(400, "session is required");
        if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be a boolean");
        mode.set(session, body.enabled);
        sendJson(res, 200, { session, openui: mode.isOn(session) });
      }, log)
    })
  ];
}

// src/host/prompt.ts
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var SECTION = "genui:openui";
var ANCHORS = {
  tools: "<!-- genui:tools -->",
  examples: "<!-- genui:examples -->",
  rules: "<!-- genui:rules -->",
  components: "<!-- genui:components -->"
};
var COMPONENT_HEADING = "### Components from other bundles";
function componentCatalogue(docs) {
  if (docs.length === 0) return "";
  const lines = docs.map((doc) => `${doc.signature} \u2014 ${doc.description}`);
  return [
    COMPONENT_HEADING,
    "",
    "Ordinary components from bundles installed beside this one: same syntax, same action rules.",
    "Use one when it is the honest shape for the answer.",
    "",
    ...lines
  ].join("\n");
}
var NO_TOOLS = [
  "This deployment exposes no Query tools. A `Query(...)` would resolve to nothing, so build",
  "the answer from what you already know and from ordinary components."
].join("\n");
function asset(name2) {
  const candidates = [
    new URL(`../assets/${name2}`, import.meta.url),
    // built lib/index.js
    new URL(`../../assets/${name2}`, import.meta.url)
    // src/host/prompt.ts
  ];
  const file = candidates.find((url) => existsSync(fileURLToPath(url)));
  if (!file) throw new Error(`dsh-genui: assets/${name2} not found`);
  return readFileSync(file, "utf8").trimEnd();
}
var EMPTY_SOURCE = {
  blocks: () => [],
  components: () => [],
  contexts: () => [],
  addContext: () => () => {
  },
  addPromptBlock: () => () => {
  },
  addComponents: () => () => {
  }
};
function fillAnchor(text, marker, blocks, fallback = "") {
  const at = text.indexOf(marker);
  if (at < 0) return text;
  const body = (blocks.join("\n\n") || fallback).trim();
  const before = text.slice(0, at).replace(/\n+$/, "");
  const after = text.slice(at + marker.length).replace(/^\n+/, "");
  return body === "" ? `${before}

${after}` : `${before}

${body}

${after}`;
}
function openuiPrompt(source = EMPTY_SOURCE) {
  const catalogue = componentCatalogue(source.components());
  const core = fillAnchor(
    fillAnchor(
      fillAnchor(asset("prompt-core.txt"), ANCHORS.tools, source.blocks("tools"), NO_TOOLS),
      ANCHORS.examples,
      source.blocks("examples")
    ),
    ANCHORS.components,
    catalogue ? [catalogue] : []
  );
  const rules = fillAnchor(asset("prompt-rules.md"), ANCHORS.rules, source.blocks("rules"));
  const parts = [core, ...source.blocks("append"), rules];
  return `${parts.map((part) => part.trimEnd()).join("\n\n")}
`;
}
function agentOf(context) {
  const candidate = context?.agent;
  return candidate && typeof candidate === "object" ? candidate : void 0;
}
function registerAgentPrompt(ctx, config, mode, service) {
  ctx.on("system-prompt/assemble", async (assembly, context, next) => {
    const built = await next();
    const agent = agentOf(context);
    if (agent?.session?.header?.origin === "subagent") return built;
    const sessionId = typeof agent?.session?.id === "string" ? agent.session.id : "";
    if (!sessionId || !mode.isOn(sessionId)) return built;
    if (built.sections.some((section) => section.name === SECTION)) return built;
    const contexts = service.contexts().map((entry) => ({ name: `genui:${entry.id}`, text: entry.text }));
    return {
      ...built,
      sections: [...built.sections, { name: SECTION, text: openuiPrompt(service) }],
      contexts: contexts.length > 0 ? [...built.contexts, ...contexts] : built.contexts
    };
  }, { prepend: true });
}

// src/host/mode.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function modeFile(env = process.env) {
  const home = env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  return join(home, "genui-mode.json");
}
function unique(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((id) => typeof id === "string" && id.length > 0))];
}
function readState(file) {
  try {
    if (!existsSync2(file)) return { on: [], off: [] };
    const parsed = JSON.parse(readFileSync2(file, "utf8"));
    const on = unique(parsed.sessions);
    const off = unique(parsed.off).filter((id) => !on.includes(id));
    return { on, off };
  } catch {
    return { on: [], off: [] };
  }
}
function createModeStore(file = modeFile(), options = {}) {
  const fixed = options.defaultOn;
  const readDefault = typeof fixed === "function" ? fixed : () => fixed ?? true;
  const state = readState(file);
  let on = new Set(state.on);
  let off = new Set(state.off);
  const persist = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      const body = { default: readDefault(), sessions: [...on], off: [...off] };
      writeFileSync(temp, `${JSON.stringify(body, null, 2)}
`);
      renameSync(temp, file);
    } catch {
    }
  };
  return {
    file,
    get defaultOn() {
      return readDefault();
    },
    isOn: (sessionId) => off.has(sessionId) ? false : on.has(sessionId) || readDefault(),
    set: (sessionId, next) => {
      const current = off.has(sessionId) ? false : on.has(sessionId) || readDefault();
      if (current === next) return;
      on = new Set(on);
      off = new Set(off);
      if (next === readDefault()) {
        on.delete(sessionId);
        off.delete(sessionId);
      } else if (next) {
        on.add(sessionId);
        off.delete(sessionId);
      } else {
        off.add(sessionId);
        on.delete(sessionId);
      }
      persist();
    },
    sessions: () => [...on],
    offSessions: () => [...off]
  };
}

// src/host/commands.ts
var USAGE = "usage: /openui on | off | status";
function parseModeCommand(rawInput) {
  const word = rawInput.trim().toLowerCase();
  if (word === "" || word === "status") return "status";
  if (word === "on" || word === "enable" || word === "true") return true;
  if (word === "off" || word === "disable" || word === "false") return false;
  return void 0;
}
function modeMessage(enabled) {
  return enabled ? "OpenUI is on for this conversation: the next answer is written as an interface program." : "OpenUI is off for this conversation: answers are ordinary markdown.";
}
function registerCommands(ctx, mode) {
  ctx.inject(["commands"], (scoped) => {
    scoped.commands.register({
      name: "openui",
      description: "Answer this conversation as OpenUI interface programs instead of markdown",
      input: { hint: "on | off | status" },
      handler: ({ agent, rawInput }) => {
        const parsed = parseModeCommand(rawInput);
        if (parsed === void 0) return { kind: "error", text: USAGE };
        const sessionId = agent.session.id;
        if (parsed !== "status") mode.set(sessionId, parsed);
        return { kind: "success", text: modeMessage(mode.isOn(sessionId)) };
      }
    });
  });
}

// src/host/index.ts
var name = "dsh-genui";
var inject = ["webServer", "systemPrompt"];
function apply(ctx, config) {
  const mode = createModeStore(void 0, { defaultOn: () => config.defaultOn.get() });
  const service = createGenuiHostService();
  ctx.provide("genui", service);
  ctx.effect(() => {
    const disposers = registerRoutes(ctx, mode);
    return () => disposers.forEach((dispose) => dispose());
  });
  registerAgentPrompt(ctx, config, mode, service);
  registerCommands(ctx, mode);
}
export {
  Config,
  apply,
  inject,
  name
};
