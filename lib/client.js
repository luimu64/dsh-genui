window.__ModuleLoader__.load({
  id: "dsh-genui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/assistant.ts
var liveSteps = /* @__PURE__ */ new Set();
function stepKey(data) {
  return `${data.turn}:${data.step}`;
}
function observeStep(key, status) {
  if (status === "running") liveSteps.add(key);
  return liveSteps.has(key);
}
function assistantText(blocks) {
  return blocks.filter((block) => block.kind === "text").map((block) => block.text).join("");
}
function reasoningText(blocks) {
  return blocks.filter((block) => block.kind === "reasoning").map((block) => block.text.trim()).filter((text) => text.length > 0).join("\n\n");
}
function looksLikeOpenUI(text) {
  return /^\s*root\s*=/m.test(text);
}
function rowMode(data, text, live) {
  const trimmed = text.trim();
  if (trimmed === "") return data.status === "running" && live ? "building" : "empty";
  if (data.status === "running") return live ? "building" : "partial";
  return looksLikeOpenUI(text) ? "program" : "text";
}

// src/client/renderer.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function Reasoning({ text }) {
  if (!text) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "genui-reasoning", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "Reasoning" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "genui-reasoning-body", style: { whiteSpace: "pre-wrap" }, children: text })
  ] });
}
function OpenUIRow({ node }) {
  const data = node.data;
  const live = observeStep(stepKey(data), data.status);
  const text = assistantText(data.blocks);
  const mode = rowMode(data, text, live);
  if (mode === "empty") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "genui-row", "data-genui-step": stepKey(data), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Reasoning, { text: reasoningText(data.blocks) }),
    mode === "building" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "genui-building", children: "Building interface\u2026" }) : null,
    mode === "partial" || mode === "text" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "genui-fallback", style: { whiteSpace: "pre-wrap" }, children: text }) : null,
    mode === "program" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "genui-program-raw", children: text }) : null
  ] });
}

// src/client/index.tsx
var name = "dsh-genui-client";
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject(
    "conversation.chat.node",
    () => ctx.slots.register(
      { name: "conversation.chat.node", key: "assistant-step", priority: -1 },
      OpenUIRow
    )
  );
}

    return module.exports;
  },
});
