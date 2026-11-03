// src/host/config.ts
import Schema from "@deepseek-ai/schemastery";
var Config = Schema.object({
  comfyBase: Schema.string().default("http://127.0.0.1:8188"),
  imagesDir: Schema.string().default("/home/luimu/.local/share/openui-harness/images"),
  maxBatch: Schema.number().default(8),
  pollMs: Schema.number().default(750),
  minPngBytes: Schema.number().default(3e4)
});

// src/host/service.ts
import { randomInt } from "node:crypto";

// assets/anime.json
var anime_default = {
  "1": {
    class_type: "UNETLoader",
    inputs: { unet_name: "anima-turbo-v1.1.safetensors", weight_dtype: "default" }
  },
  "2": {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: "qwen_3_06b_base.safetensors",
      type: "stable_diffusion",
      device: "default"
    }
  },
  "3": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "masterpiece, best quality, score_7, safe, ",
      clip: ["2", 0]
    }
  },
  "4": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration",
      clip: ["2", 0]
    }
  },
  "5": {
    class_type: "EmptyLatentImage",
    inputs: { width: 832, height: 1216, batch_size: 1 }
  },
  "6": {
    class_type: "KSampler",
    inputs: {
      seed: 0,
      steps: 8,
      cfg: 1,
      sampler_name: "er_sde",
      scheduler: "simple",
      denoise: 1,
      model: ["1", 0],
      positive: ["3", 0],
      negative: ["4", 0],
      latent_image: ["5", 0]
    }
  },
  "7": {
    class_type: "VAEDecode",
    inputs: { samples: ["6", 0], vae: ["8", 0] }
  },
  "8": {
    class_type: "VAELoader",
    inputs: { vae_name: "qwen_image_vae.safetensors" }
  },
  "9": {
    class_type: "SaveImage",
    inputs: { images: ["7", 0], filename_prefix: "harness_anime" }
  }
};

// assets/anime-hq.json
var anime_hq_default = {
  "1": {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "waiANIMA_v10Base10.safetensors",
      weight_dtype: "default"
    }
  },
  "2": {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: "qwen_3_06b_base.safetensors",
      type: "stable_diffusion",
      device: "default"
    }
  },
  "3": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "masterpiece, best quality, score_7, safe, ",
      clip: [
        "2",
        0
      ]
    }
  },
  "4": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration",
      clip: [
        "2",
        0
      ]
    }
  },
  "5": {
    class_type: "EmptyLatentImage",
    inputs: {
      width: 832,
      height: 1216,
      batch_size: 1
    }
  },
  "6": {
    class_type: "KSampler",
    inputs: {
      seed: 0,
      steps: 30,
      cfg: 5,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1,
      model: [
        "1",
        0
      ],
      positive: [
        "3",
        0
      ],
      negative: [
        "4",
        0
      ],
      latent_image: [
        "5",
        0
      ]
    }
  },
  "7": {
    class_type: "VAEDecode",
    inputs: {
      samples: [
        "6",
        0
      ],
      vae: [
        "8",
        0
      ]
    }
  },
  "8": {
    class_type: "VAELoader",
    inputs: {
      vae_name: "qwen_image_vae.safetensors"
    }
  },
  "9": {
    class_type: "SaveImage",
    inputs: {
      images: [
        "7",
        0
      ],
      filename_prefix: "harness_anime_hq"
    }
  }
};

// assets/real.json
var real_default = {
  "1": {
    class_type: "UNETLoader",
    inputs: { unet_name: "moss_image_sft_int8_convrot.safetensors", weight_dtype: "default" }
  },
  "2": {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: "qwen3.5_9b_w4a8_gptq.safetensors",
      type: "moss_image",
      device: "default"
    }
  },
  "3": {
    class_type: "CLIPTextEncode",
    inputs: { text: "", clip: ["2", 0] }
  },
  "4": {
    class_type: "CLIPTextEncode",
    inputs: { text: "", clip: ["2", 0] }
  },
  "5": {
    class_type: "EmptyFlux2LatentImage",
    inputs: { width: 832, height: 1216, batch_size: 1 }
  },
  "6": {
    class_type: "KSampler",
    inputs: {
      seed: 0,
      steps: 4,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1,
      model: ["10", 0],
      positive: ["3", 0],
      negative: ["4", 0],
      latent_image: ["5", 0]
    }
  },
  "7": {
    class_type: "VAEDecode",
    inputs: { samples: ["6", 0], vae: ["8", 0] }
  },
  "8": {
    class_type: "VAELoader",
    inputs: { vae_name: "flux2-vae_small.safetensors" }
  },
  "9": {
    class_type: "SaveImage",
    inputs: { images: ["7", 0], filename_prefix: "harness_real" }
  },
  "10": {
    class_type: "LoraLoaderModelOnly",
    inputs: {
      lora_name: "moss_image_sft_4step_v2.0.safetensors",
      strength_model: 1,
      model: ["1", 0]
    }
  }
};

// assets/real-hq.json
var real_hq_default = {
  "1": {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "moss_image_sft_bf16.safetensors",
      weight_dtype: "default"
    }
  },
  "2": {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: "qwen3.5_9b_w4a8_gptq.safetensors",
      type: "moss_image",
      device: "default"
    }
  },
  "3": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "",
      clip: [
        "2",
        0
      ]
    }
  },
  "4": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "nsfw, worst quality, bad anatomy, watermark, jpeg artifact",
      clip: [
        "2",
        0
      ]
    }
  },
  "5": {
    class_type: "EmptyFlux2LatentImage",
    inputs: {
      width: 992,
      height: 1504,
      batch_size: 1
    }
  },
  "6": {
    class_type: "KSampler",
    inputs: {
      seed: 0,
      steps: 50,
      cfg: 3,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1,
      model: [
        "11",
        0
      ],
      positive: [
        "3",
        0
      ],
      negative: [
        "4",
        0
      ],
      latent_image: [
        "5",
        0
      ]
    }
  },
  "7": {
    class_type: "VAEDecode",
    inputs: {
      samples: [
        "6",
        0
      ],
      vae: [
        "8",
        0
      ]
    }
  },
  "8": {
    class_type: "VAELoader",
    inputs: {
      vae_name: "flux2-vae_small.safetensors"
    }
  },
  "9": {
    class_type: "SaveImage",
    inputs: {
      images: [
        "7",
        0
      ],
      filename_prefix: "harness_real_hq"
    }
  },
  "11": {
    class_type: "SkipLayerGuidanceDiTSimple",
    inputs: {
      model: [
        "1",
        0
      ],
      double_layers: "",
      single_layers: "22",
      start_percent: 0,
      end_percent: 0.5
    }
  }
};

// assets/edit.json
var edit_default = {
  "1": {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "flux-2-klein-4b-fp8.safetensors",
      weight_dtype: "default"
    }
  },
  "2": {
    class_type: "CLIPLoaderGGUF",
    inputs: {
      clip_name: "Qwen3-4B-Q5_K_M.gguf",
      type: "flux2"
    }
  },
  "3": {
    class_type: "VAELoader",
    inputs: {
      vae_name: "flux2-vae.safetensors"
    }
  },
  "4": {
    class_type: "LoadImage",
    inputs: {
      image: "harness_source.png"
    }
  },
  "5": {
    class_type: "ImageScaleToTotalPixels",
    inputs: {
      image: [
        "4",
        0
      ],
      upscale_method: "lanczos",
      megapixels: 1,
      resolution_steps: 1
    }
  },
  "6": {
    class_type: "GetImageSize",
    inputs: {
      image: [
        "5",
        0
      ]
    }
  },
  "7": {
    class_type: "EmptyFlux2LatentImage",
    inputs: {
      width: [
        "6",
        0
      ],
      height: [
        "6",
        1
      ],
      batch_size: 1
    }
  },
  "8": {
    class_type: "VAEEncode",
    inputs: {
      pixels: [
        "5",
        0
      ],
      vae: [
        "3",
        0
      ]
    }
  },
  "9": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "",
      clip: [
        "2",
        0
      ]
    }
  },
  "10": {
    class_type: "ConditioningZeroOut",
    inputs: {
      conditioning: [
        "9",
        0
      ]
    }
  },
  "11": {
    class_type: "ReferenceLatent",
    inputs: {
      conditioning: [
        "9",
        0
      ],
      latent: [
        "8",
        0
      ]
    }
  },
  "12": {
    class_type: "ReferenceLatent",
    inputs: {
      conditioning: [
        "10",
        0
      ],
      latent: [
        "8",
        0
      ]
    }
  },
  "13": {
    class_type: "CFGGuider",
    inputs: {
      model: [
        "1",
        0
      ],
      positive: [
        "11",
        0
      ],
      negative: [
        "12",
        0
      ],
      cfg: 1
    }
  },
  "14": {
    class_type: "RandomNoise",
    inputs: {
      noise_seed: 0
    }
  },
  "15": {
    class_type: "KSamplerSelect",
    inputs: {
      sampler_name: "euler"
    }
  },
  "16": {
    class_type: "Flux2Scheduler",
    inputs: {
      steps: 4,
      width: [
        "6",
        0
      ],
      height: [
        "6",
        1
      ]
    }
  },
  "17": {
    class_type: "SamplerCustomAdvanced",
    inputs: {
      noise: [
        "14",
        0
      ],
      guider: [
        "13",
        0
      ],
      sampler: [
        "15",
        0
      ],
      sigmas: [
        "16",
        0
      ],
      latent_image: [
        "7",
        0
      ]
    }
  },
  "18": {
    class_type: "VAEDecode",
    inputs: {
      samples: [
        "17",
        0
      ],
      vae: [
        "3",
        0
      ]
    }
  },
  "19": {
    class_type: "SaveImage",
    inputs: {
      images: [
        "18",
        0
      ],
      filename_prefix: "harness_edit"
    }
  }
};

// src/host/graphs.ts
var MAX_BATCH = 8;
var HIGH_MIN_STEPS = 20;
var HIGH_MIN_CFG = 1.5;
var MAX_CFG = 9;
var LANES = ["anime", "real", "edit"];
var QUALITIES = ["fast", "high"];
function isLane(value) {
  return typeof value === "string" && LANES.includes(value);
}
function isQuality(value) {
  return typeof value === "string" && QUALITIES.includes(value);
}
function parseQuality(value) {
  return isQuality(value) ? value : void 0;
}
function parseLane(value) {
  return isLane(value) ? value : void 0;
}
function template(lane, quality) {
  const source = lane === "anime" ? quality === "high" ? anime_hq_default : anime_default : lane === "real" ? quality === "high" ? real_hq_default : real_default : edit_default;
  return structuredClone(source);
}
function qualityDefaults(lane, quality) {
  const anime = lane === "anime";
  const edit = lane === "edit";
  const high = quality === "high";
  const steps = edit ? 4 : anime ? high ? 30 : 8 : high ? 50 : 4;
  const cfg = edit ? 1 : anime ? high ? 5 : 1 : high ? 3 : 1;
  const width = !anime && !edit && high ? 992 : 832;
  const height = !anime && !edit && high ? 1504 : 1216;
  const prefix = edit ? "harness_edit" : anime ? high ? "harness_anime_hq" : "harness_anime" : high ? "harness_real_hq" : "harness_real";
  return { width, height, steps, cfg, prefix };
}
function effectiveSteps(req, lane, quality) {
  const fallback = qualityDefaults(lane, quality).steps;
  const asked = typeof req.steps === "number" && Number.isFinite(req.steps) ? Math.round(req.steps) : void 0;
  if (quality === "fast") return asked ?? fallback;
  return Math.max(asked ?? fallback, HIGH_MIN_STEPS);
}
function effectiveCfg(req, lane, quality) {
  const fallback = qualityDefaults(lane, quality).cfg;
  const asked = typeof req.cfg === "number" && Number.isFinite(req.cfg) ? req.cfg : void 0;
  if (quality === "fast") return asked ?? fallback;
  return Math.min(Math.max(asked ?? fallback, HIGH_MIN_CFG), MAX_CFG);
}
function effectiveCount(req, maxBatch = MAX_BATCH) {
  const asked = typeof req.count === "number" && Number.isFinite(req.count) ? Math.round(req.count) : 1;
  return Math.min(Math.max(asked, 1), Math.max(1, maxBatch));
}
function stripContentNegatives(graph) {
  const negative = String(graph["4"]?.inputs?.text ?? "");
  const kept = negative.split(",").map((token) => token.trim()).filter((token) => token.length > 0).filter((token) => !["score_1", "score_2", "score_3", "safe", "nsfw"].includes(token));
  graph["4"].inputs.text = kept.join(", ");
}
function buildGraph(req, seed, maxBatch = MAX_BATCH) {
  const lane = parseLane(req.lane) ?? "real";
  if (lane === "edit") throw new Error("the edit lane needs edit_image (it takes a source image)");
  const quality = parseQuality(req.quality) ?? "fast";
  const graph = template(lane, quality);
  const carried = String(graph["3"].inputs.text ?? "");
  const prompt = req.prompt.trim();
  graph["3"].inputs.text = lane === "anime" && !req.nsfw ? `${carried}${prompt}` : prompt;
  if (req.nsfw) stripContentNegatives(graph);
  if (typeof req.negative === "string") graph["4"].inputs.text = req.negative;
  const defaults = qualityDefaults(lane, quality);
  graph["5"].inputs.width = req.width ?? defaults.width;
  graph["5"].inputs.height = req.height ?? defaults.height;
  graph["5"].inputs.batch_size = effectiveCount(req, maxBatch);
  graph["6"].inputs.seed = seed;
  graph["6"].inputs.steps = effectiveSteps(req, lane, quality);
  graph["6"].inputs.cfg = effectiveCfg(req, lane, quality);
  graph["9"].inputs.filename_prefix = `${defaults.prefix}_${seed}`;
  return graph;
}
function buildEditGraph(req) {
  const graph = template("edit", "fast");
  const seed = Math.trunc(req.seed);
  const steps = req.steps ?? qualityDefaults("edit", "fast").steps;
  graph["4"].inputs.image = req.sourceName;
  graph["9"].inputs.text = req.prompt.trim();
  graph["14"].inputs.noise_seed = seed;
  graph["16"].inputs.steps = steps;
  graph["19"].inputs.filename_prefix = req.prefix ?? `harness_edit_${seed}`;
  const lora = req.lora?.trim();
  if (lora) {
    graph["20"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: lora,
        strength_model: req.loraStrength ?? 0.8,
        model: ["1", 0]
      }
    };
    graph["13"].inputs.model = ["20", 0];
  }
  return graph;
}

// src/host/comfy.ts
function viewUrl(base, image) {
  return `${base}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(
    image.subfolder
  )}&type=${encodeURIComponent(image.type)}`;
}
function parseHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return { state: "pending" };
  const record = entry;
  const status = record.status;
  if (!status || typeof status !== "object") return { state: "pending" };
  if (status.status_str === "error") {
    return { state: "failed", message: "comfyui reported an execution error" };
  }
  if (status.completed !== true) return { state: "pending" };
  const images = [];
  const outputs = record.outputs;
  if (outputs && typeof outputs === "object") {
    for (const node of Object.values(outputs)) {
      const list = node?.images;
      if (!Array.isArray(list)) continue;
      for (const image of list) {
        images.push({
          filename: String(image?.filename ?? ""),
          subfolder: String(image?.subfolder ?? ""),
          type: String(image?.type ?? "output")
        });
      }
    }
  }
  if (images.length === 0) {
    return { state: "failed", message: "comfyui finished with no images" };
  }
  return { state: "done", images };
}
async function jsonBody(response, what) {
  try {
    return await response.json();
  } catch (err) {
    throw new Error(`comfy ${what} was not json (${response.status}): ${String(err)}`);
  }
}
function createComfyClient(options) {
  const base = options.base.replace(/\/+$/, "");
  const defaultPoll = options.pollMs ?? 750;
  const clientId = `dsh-genui-${Math.random().toString(36).slice(2)}`;
  const call = (path, init = {}, signal) => fetch(`${base}${path}`, { ...init, signal: signal ?? options.signal });
  return {
    async queue(graph, signal) {
      const res = await call(
        "/api/prompt",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: graph, client_id: clientId })
        },
        signal
      ).catch((err) => {
        throw new Error(`comfy queue request failed: ${String(err)}`);
      });
      const body = await jsonBody(res, "queue response");
      if (!res.ok) throw new Error(`comfy rejected the graph (${res.status}): ${JSON.stringify(body)}`);
      const nodeErrors = body?.node_errors;
      if (nodeErrors && typeof nodeErrors === "object" && Object.keys(nodeErrors).length > 0) {
        throw new Error(`comfy node_errors: ${JSON.stringify(nodeErrors)}`);
      }
      if (typeof body?.prompt_id !== "string") {
        throw new Error(`comfy returned no prompt_id: ${JSON.stringify(body)}`);
      }
      return body.prompt_id;
    },
    async wait(promptId, timeoutMs, pollMs) {
      const interval = pollMs ?? defaultPoll;
      const deadline = Date.now() + timeoutMs;
      for (; ; ) {
        const res = await call(`/history/${encodeURIComponent(promptId)}`).catch((err) => {
          throw new Error(`comfy history request failed: ${String(err)}`);
        });
        const body = await jsonBody(res, "history");
        const parsed = parseHistoryEntry(body?.[promptId]);
        if (parsed.state === "done") return parsed.images;
        if (parsed.state === "failed") throw new Error(parsed.message);
        if (Date.now() >= deadline) {
          throw new Error(`comfy timed out after ${Math.round(timeoutMs / 1e3)}s`);
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    },
    async fetch(image) {
      const res = await call(viewUrl("", image)).catch((err) => {
        throw new Error(`comfy view request failed: ${String(err)}`);
      });
      if (!res.ok) throw new Error(`comfy view returned ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    /** Put a local file in ComfyUI's `input/` so LoadImage can reference it. */
    async upload(filename, bytes) {
      const form = new FormData();
      form.set("type", "input");
      form.set("overwrite", "true");
      form.set("image", new Blob([bytes], { type: "image/png" }), filename);
      const res = await call("/upload/image", { method: "POST", body: form }).catch((err) => {
        throw new Error(`comfy upload failed: ${String(err)}`);
      });
      const body = await jsonBody(res, "upload response");
      if (!res.ok) throw new Error(`comfy upload rejected (${res.status}): ${JSON.stringify(body)}`);
      const name2 = typeof body?.name === "string" ? body.name : "";
      if (!name2) throw new Error(`comfy upload returned no name: ${JSON.stringify(body)}`);
      const subfolder = typeof body?.subfolder === "string" ? body.subfolder : "";
      return subfolder ? `${subfolder}/${name2}` : name2;
    }
  };
}

// src/host/images.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
var SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;
function safeImageName(name2) {
  const value = typeof name2 === "string" ? name2.trim() : "";
  if (!value) throw new Error("image name is empty");
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error(`unsafe image name: ${value}`);
  }
  if (!SAFE.test(value)) throw new Error(`not a png file name: ${value}`);
  return value;
}
function tempName(dir, file) {
  return join(dir, `.${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
}
async function saveRender(dir, filename, bytes) {
  const file = safeImageName(filename);
  await mkdir(dir, { recursive: true });
  const target = join(dir, file);
  const temp = tempName(dir, file);
  await writeFile(temp, bytes);
  await rename(temp, target);
  return file;
}
async function readRender(dir, filename) {
  const file = safeImageName(filename);
  const bytes = await readFile(join(dir, file));
  return new Uint8Array(bytes);
}
function listRenders(dir, limit = 20) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name2 of names) {
    if (!name2.toLowerCase().endsWith(".png")) continue;
    if (!SAFE.test(name2)) continue;
    try {
      const stat = statSync(join(dir, name2));
      if (!stat.isFile()) continue;
      out.push({ file: name2, mtimeMs: stat.mtimeMs });
    } catch {
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));
  return out.slice(0, Math.max(0, limit));
}
function resolveSource(dir, source) {
  const asked = source?.trim();
  if (asked) {
    const file = safeImageName(asked);
    if (!existsSync(join(dir, file))) throw new Error(`no such image: ${asked}`);
    return file;
  }
  const newest = listRenders(dir, 1)[0];
  if (!newest) throw new Error(`no renders in ${dir} to edit yet`);
  return newest.file;
}

// src/host/service.ts
var FAST_TIMEOUT_MS = 24e4;
var HIGH_TIMEOUT_MS = 9e5;
function imageUrl(file) {
  return `/genui/images/${encodeURIComponent(file)}`;
}
function numberOr(value, fallback) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function stringOr(value) {
  return typeof value === "string" ? value : void 0;
}
function requirePrompt(value, tool) {
  const prompt = typeof value === "string" ? value.trim() : "";
  if (!prompt) throw new Error(`${tool} needs a prompt`);
  return prompt;
}
function createGenuiService(config, comfy = createComfyClient({ base: config.comfyBase, pollMs: config.pollMs })) {
  const maxBatch = Math.max(1, Math.trunc(config.maxBatch || 8));
  const minPngBytes = Math.max(1, Math.trunc(config.minPngBytes || 3e4));
  async function collect(images, seed, steps, base) {
    const out = [];
    for (const image of images) {
      const bytes = await comfy.fetch(image);
      if (bytes.byteLength < minPngBytes) {
        throw new Error(
          `comfy returned a ${bytes.byteLength} byte png - failed render, not an image`
        );
      }
      const file = await saveRender(config.imagesDir, image.filename, bytes);
      out.push({
        url: imageUrl(file),
        prompt: base.prompt,
        lane: base.lane,
        quality: base.quality,
        seed,
        steps,
        file
      });
    }
    if (out.length === 0) throw new Error("comfy finished with no images");
    return out;
  }
  function result(images, meta) {
    const first = images[0];
    return {
      url: first.url,
      file: first.file,
      prompt: meta.prompt,
      lane: meta.lane,
      quality: meta.quality,
      seed: meta.seed,
      steps: meta.steps,
      images
    };
  }
  return {
    async generate(input) {
      const prompt = requirePrompt(input.prompt, "generate_image");
      const lane = isLane(input.lane) ? input.lane : "real";
      if (lane === "edit") throw new Error("the edit lane needs edit_image (it takes a source image)");
      const quality = isQuality(input.quality) ? input.quality : "fast";
      const req = {
        lane,
        quality,
        prompt,
        count: effectiveCount({ prompt, count: numberOr(input.count, 1) }, maxBatch),
        steps: numberOr(input.steps, void 0),
        cfg: numberOr(input.cfg, void 0),
        width: numberOr(input.width, void 0),
        height: numberOr(input.height, void 0),
        negative: stringOr(input.negative),
        nsfw: input.nsfw === true
      };
      const seed = randomInt(0, 2 ** 32);
      const graph = buildGraph(req, seed, maxBatch);
      const promptId = await comfy.queue(graph);
      const timeout = quality === "high" ? HIGH_TIMEOUT_MS : FAST_TIMEOUT_MS;
      const images = await comfy.wait(promptId, timeout, config.pollMs);
      const steps = Number(graph["6"].inputs.steps);
      const out = await collect(images, seed, steps, { prompt, lane, quality });
      return result(out, { prompt, lane, quality, seed, steps });
    },
    async edit(input) {
      const prompt = requirePrompt(input.prompt, "edit_image");
      const source = resolveSource(config.imagesDir, stringOr(input.source));
      const bytes = await readRender(config.imagesDir, source);
      const uploaded = await comfy.upload(source, bytes);
      const seedFallback = qualityDefaults("edit", "fast");
      const seed = Math.trunc(numberOr(input.seed, randomInt(0, 2 ** 32)));
      const steps = Math.trunc(numberOr(input.steps, seedFallback.steps));
      const graph = buildEditGraph({
        prompt,
        sourceName: uploaded,
        seed,
        steps,
        lora: stringOr(input.lora),
        loraStrength: numberOr(input.loraStrength, numberOr(input.lora_strength, void 0))
      });
      const promptId = await comfy.queue(graph);
      const images = await comfy.wait(promptId, FAST_TIMEOUT_MS, config.pollMs);
      const out = await collect(images, seed, steps, { prompt, lane: "edit", quality: "fast" });
      return result(out, { prompt, lane: "edit", quality: "fast", seed, steps });
    },
    async health() {
      try {
        const res = await fetch(`${config.comfyBase.replace(/\/+$/, "")}/system_stats`, {
          signal: AbortSignal.timeout(2e3)
        });
        return { comfy: res.ok };
      } catch {
        return { comfy: false };
      }
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
async function guard(req, res, run) {
  try {
    assertSameOrigin(req);
    await run();
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) sendText(res, status, message);
    else res.end();
  }
}
function registerRoutes(ctx, service, config, mode) {
  const post = (path, run) => ctx.webServer.register({
    kind: "exact",
    path,
    handler: (req, res) => guard(req, res, async () => {
      const body = payload(await readJson(req));
      sendJson(res, 200, await run(body));
    })
  });
  return [
    post("/genui/generate", (body) => service.generate(body)),
    post("/genui/edit", (body) => service.edit(body)),
    ctx.webServer.register({
      kind: "exact",
      path: "/genui/mode",
      handler: (req, res) => guard(req, res, async () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method === "GET") {
          const session2 = url.searchParams.get("session");
          if (!session2) {
            sendJson(res, 200, { sessions: mode.sessions() });
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
      })
    }),
    ctx.webServer.register({
      kind: "exact",
      path: "/genui/health",
      handler: (req, res) => guard(req, res, async () => {
        sendJson(res, 200, await service.health());
      })
    }),
    ctx.webServer.register({
      kind: "prefix",
      path: "/genui/images",
      handler: (req, res) => guard(req, res, async () => {
        const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        const prefix = "/genui/images/";
        if (!pathname.startsWith(prefix)) throw new HttpError(404, "not found");
        let name2;
        try {
          name2 = decodeURIComponent(pathname.slice(prefix.length));
        } catch {
          throw new HttpError(400, "bad image name");
        }
        if (!name2) throw new HttpError(404, "not found");
        let bytes;
        try {
          bytes = await readRender(config.imagesDir, name2);
        } catch {
          throw new HttpError(404, "no such image");
        }
        res.writeHead(200, {
          "content-type": "image/png",
          "content-length": bytes.byteLength,
          "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff"
        });
        res.end(Buffer.from(bytes));
      })
    })
  ];
}

// src/host/prompt.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath } from "node:url";
var SECTION = "genui:openui";
var CONTEXT = "genui:renders";
function openuiPrompt() {
  const candidates = [
    new URL("../assets/system-prompt.txt", import.meta.url),
    // built lib/index.js
    new URL("../../assets/system-prompt.txt", import.meta.url)
    // src/host/prompt.ts
  ];
  const file = candidates.find((url) => existsSync2(fileURLToPath(url)));
  if (!file) throw new Error("dsh-genui: assets/system-prompt.txt not found");
  return readFileSync2(file, "utf8");
}
function renderList(imagesDir, limit = 20) {
  const renders = listRenders(imagesDir, limit);
  if (renders.length === 0) return "";
  const lines = renders.map((render, index) => `- ${render.file}${index === 0 ? " (newest)" : " (older)"}`);
  return ["### Renders in this conversation", "", ...lines].join("\n");
}
function agentOf(context) {
  const candidate = context?.agent;
  return candidate && typeof candidate === "object" ? candidate : void 0;
}
function registerAgentPrompt(ctx, config, mode) {
  const prompt = openuiPrompt();
  ctx.on("system-prompt/assemble", async (assembly, context, next) => {
    const built = await next();
    const agent = agentOf(context);
    if (agent?.session?.header?.origin === "subagent") return built;
    const sessionId = typeof agent?.session?.id === "string" ? agent.session.id : "";
    if (!sessionId || !mode.isOn(sessionId)) return built;
    if (built.sections.some((section) => section.name === SECTION)) return built;
    const renders = renderList(config.imagesDir);
    return {
      ...built,
      sections: [...built.sections, { name: SECTION, text: prompt }],
      contexts: renders ? [...built.contexts, { name: CONTEXT, text: renders }] : built.contexts
    };
  }, { prepend: true });
}

// src/host/mode.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir } from "node:os";
import { dirname, join as join2 } from "node:path";
function modeFile(env = process.env) {
  const home = env.DSH_HOME?.trim() || join2(homedir(), ".dsh");
  return join2(home, "genui-mode.json");
}
function readSessions(file) {
  try {
    if (!existsSync3(file)) return [];
    const parsed = JSON.parse(readFileSync3(file, "utf8"));
    if (Array.isArray(parsed.sessions)) {
      return [...new Set(parsed.sessions.filter((id) => typeof id === "string" && id.length > 0))];
    }
    return [];
  } catch {
    return [];
  }
}
function createModeStore(file = modeFile()) {
  let on = new Set(readSessions(file));
  const persist = () => {
    try {
      mkdirSync2(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync2(temp, `${JSON.stringify({ sessions: [...on] }, null, 2)}
`);
      renameSync2(temp, file);
    } catch {
    }
  };
  return {
    file,
    isOn: (sessionId) => on.has(sessionId),
    set: (sessionId, next) => {
      const changed = next ? !on.has(sessionId) : on.has(sessionId);
      if (!changed) return;
      on = new Set(on);
      if (next) on.add(sessionId);
      else on.delete(sessionId);
      persist();
    },
    sessions: () => [...on]
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
  const mode = createModeStore();
  const service = createGenuiService(config);
  ctx.effect(() => {
    const disposers = registerRoutes(ctx, service, config, mode);
    return () => disposers.forEach((dispose) => dispose());
  });
  registerAgentPrompt(ctx, config, mode);
  registerCommands(ctx, mode);
}
export {
  Config,
  apply,
  inject,
  name
};
