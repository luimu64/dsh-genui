// src/host/config.ts
import { homedir } from "node:os";
import { join } from "node:path";
import Schema from "@deepseek-ai/schemastery";

// src/shared/models.ts
var LANE_IDS = ["real", "anime"];
var DEFAULT_WORKFLOWS = ["real"];
var QUALITY_IDS = ["fast", "high"];
var PRESET_IDS = ["miaoharem", "dasiwa"];
var EDIT_LANE = "edit";
var ALL_LANE_IDS = [...LANE_IDS, EDIT_LANE];
function isLaneId(value) {
  return typeof value === "string" && LANE_IDS.includes(value);
}
function isQualityId(value) {
  return typeof value === "string" && QUALITY_IDS.includes(value);
}
function isPresetId(value) {
  return typeof value === "string" && PRESET_IDS.includes(value);
}
function parseWorkflows(value) {
  if (!Array.isArray(value)) return [...DEFAULT_WORKFLOWS];
  const asked = [...new Set(value.filter(isLaneId))];
  return asked.length > 0 ? asked : [...DEFAULT_WORKFLOWS];
}

// src/host/config.ts
function defaultImagesDir(env = process.env, home = homedir()) {
  const data = env.XDG_DATA_HOME?.trim() || join(home, ".local", "share");
  return join(data, "dsh-genui", "images");
}
var Config = Schema.object({
  comfyBase: Schema.string().default("http://127.0.0.1:8188"),
  imagesDir: Schema.string().default(defaultImagesDir()),
  maxBatch: Schema.number().default(8),
  pollMs: Schema.number().default(750),
  minPngBytes: Schema.number().default(3e4),
  defaultOn: Schema.boolean().default(true),
  filePrefix: Schema.string().default("genui"),
  workflows: Schema.array(Schema.string()).default([...DEFAULT_WORKFLOWS]).volatile()
});
function workflowsOf(config) {
  return parseWorkflows(config.workflows.get());
}

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
    inputs: { images: ["7", 0], filename_prefix: "genui_anime" }
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
      filename_prefix: "genui_anime_hq"
    }
  }
};

// assets/anime-miao.json
var anime_miao_default = {
  "1": {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "MiaoMiaoHarem_Anima_1.6.safetensors",
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
      text: "masterpiece, best quality, very aesthetic, absurdres, newest, highres, ",
      clip: ["2", 0]
    }
  },
  "4": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "worst quality, low quality, bad anatomy, bad hands, extra fingers, extra limbs, missing fingers, watermark, signature, text, jpeg artifacts",
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
      steps: 30,
      cfg: 4.5,
      sampler_name: "euler",
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
    inputs: { images: ["7", 0], filename_prefix: "genui_anima_miao" }
  }
};

// assets/anime-dasiwa.json
var anime_dasiwa_default = {
  "1": {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "dasiwaAnima_obsidianArchivesV2.safetensors",
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
      text: "masterpiece, best quality, very aesthetic, absurdres, newest, highres, ",
      clip: ["2", 0]
    }
  },
  "4": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "worst quality, low quality, bad anatomy, bad hands, extra fingers, extra limbs, missing fingers, watermark, signature, text, jpeg artifacts",
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
      steps: 30,
      cfg: 4.5,
      sampler_name: "euler",
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
    inputs: { images: ["7", 0], filename_prefix: "genui_anima_dasiwa" }
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
    inputs: { images: ["7", 0], filename_prefix: "genui_real" }
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
      filename_prefix: "genui_real_hq"
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
      image: "genui_source.png"
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
      filename_prefix: "genui_edit"
    }
  }
};

// src/host/models.ts
function spec(graph, rest) {
  return { graph, ...rest };
}
var LANE_MODELS = {
  // Distilled anime model: a booru-tag prompt carried on top of the template's style block.
  anime: {
    fast: spec(anime_default, {
      suffix: "anime",
      width: 832,
      height: 1216,
      steps: 8,
      cfg: 1,
      carriesStyle: true
    }),
    high: spec(anime_hq_default, {
      suffix: "anime_hq",
      width: 832,
      height: 1216,
      steps: 30,
      cfg: 5,
      carriesStyle: true
    })
  },
  // Caption-driven photographic model: one natural-language sentence, no style prefix.
  real: {
    fast: spec(real_default, {
      suffix: "real",
      width: 832,
      height: 1216,
      steps: 4,
      cfg: 1,
      carriesStyle: false
    }),
    high: spec(real_hq_default, {
      suffix: "real_hq",
      width: 992,
      height: 1504,
      steps: 50,
      cfg: 3,
      carriesStyle: false
    })
  }
};
var EDIT_MODEL = spec(edit_default, {
  suffix: "edit",
  width: 832,
  height: 1216,
  steps: 4,
  cfg: 1,
  carriesStyle: false
});
var PRESET_MODELS = {
  miaoharem: spec(anime_miao_default, {
    suffix: "anima_miao",
    width: 832,
    height: 1216,
    steps: 30,
    cfg: 4.5,
    carriesStyle: true
  }),
  dasiwa: spec(anime_dasiwa_default, {
    suffix: "anima_dasiwa",
    width: 832,
    height: 1216,
    steps: 30,
    cfg: 4.5,
    carriesStyle: true
  })
};
var PRESET_LANE = "anime";
function modelFor(lane, quality, preset) {
  return preset ? PRESET_MODELS[preset] : LANE_MODELS[lane][quality];
}

// src/host/graphs.ts
var MAX_BATCH = 8;
var HIGH_MIN_STEPS = 20;
var HIGH_MIN_CFG = 1.5;
var MAX_CFG = 9;
var MIN_UPSCALE = 1.05;
var MAX_UPSCALE = 2;
var MAX_HIRES_PIXELS = 42e5;
var HIRES_DENOISE = 0.45;
var UPSCALE_NODE = "21";
var REFINE_NODE = "22";
var DEFAULT_FILE_PREFIX = "genui";
function isLane(value) {
  return isLaneId(value) || value === EDIT_LANE;
}
function isQuality(value) {
  return isQualityId(value);
}
function isPreset(value) {
  return isPresetId(value);
}
function parseQuality(value) {
  return isQualityId(value) ? value : void 0;
}
function parseLane(value) {
  return isLane(value) ? value : void 0;
}
function parsePreset(value) {
  return isPresetId(value) ? value : void 0;
}
function defaultsOf(spec2, filePrefix) {
  return {
    width: spec2.width,
    height: spec2.height,
    steps: spec2.steps,
    cfg: spec2.cfg,
    prefix: `${filePrefix}_${spec2.suffix}`
  };
}
function renderDefaults(lane, quality, preset, filePrefix = DEFAULT_FILE_PREFIX) {
  return defaultsOf(modelFor(lane, quality, preset), filePrefix);
}
function effectiveSteps(req, lane, quality, preset) {
  const fallback = renderDefaults(lane, quality, preset).steps;
  const asked = typeof req.steps === "number" && Number.isFinite(req.steps) ? Math.round(req.steps) : void 0;
  if (preset || quality === "fast") return Math.max(asked ?? fallback, 1);
  return Math.max(asked ?? fallback, HIGH_MIN_STEPS);
}
function effectiveCfg(req, lane, quality, preset) {
  const fallback = renderDefaults(lane, quality, preset).cfg;
  const asked = typeof req.cfg === "number" && Number.isFinite(req.cfg) ? req.cfg : void 0;
  if (preset || quality === "fast") return asked ?? fallback;
  return Math.min(Math.max(asked ?? fallback, HIGH_MIN_CFG), MAX_CFG);
}
function effectiveUpscale(req, width, height) {
  const raw = req.upscale;
  const asked = raw === true ? 1.5 : typeof raw === "number" && Number.isFinite(raw) ? raw : 1;
  if (asked < MIN_UPSCALE) return 1;
  const room = Math.sqrt(MAX_HIRES_PIXELS / Math.max(1, width * height));
  const factor = Math.min(asked, MAX_UPSCALE, Math.max(1, room));
  if (factor < MIN_UPSCALE) return 1;
  return Math.round(factor * 100) / 100;
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
function template(lane, quality, preset) {
  return structuredClone(modelFor(lane, quality, preset).graph);
}
function buildGraph(req, seed, maxBatch = MAX_BATCH, filePrefix = DEFAULT_FILE_PREFIX) {
  const lane = parseLane(req.lane) ?? "real";
  if (lane === EDIT_LANE) throw new Error("the edit lane needs edit_image (it takes a source image)");
  const preset = parsePreset(req.preset);
  if (preset && lane !== "anime") {
    throw new Error(`preset "${preset}" is a full anime checkpoint: it needs lane "anime"`);
  }
  const quality = parseQuality(req.quality) ?? "fast";
  const model = modelFor(lane, quality, preset);
  const graph = template(lane, quality, preset);
  const carried = String(graph["3"].inputs.text ?? "");
  const prompt = req.prompt.trim();
  graph["3"].inputs.text = model.carriesStyle && !req.nsfw ? `${carried}${prompt}` : prompt;
  if (req.nsfw) stripContentNegatives(graph);
  if (typeof req.negative === "string") graph["4"].inputs.text = req.negative;
  const defaults = renderDefaults(lane, quality, preset, filePrefix);
  const width = req.width ?? defaults.width;
  const height = req.height ?? defaults.height;
  const steps = effectiveSteps(req, lane, quality, preset);
  graph["5"].inputs.width = width;
  graph["5"].inputs.height = height;
  graph["5"].inputs.batch_size = effectiveCount(req, maxBatch);
  graph["6"].inputs.seed = seed;
  graph["6"].inputs.steps = steps;
  graph["6"].inputs.cfg = effectiveCfg(req, lane, quality, preset);
  graph["9"].inputs.filename_prefix = `${defaults.prefix}_${seed}`;
  const upscale = effectiveUpscale(req, width, height);
  if (upscale > 1) {
    const first = graph["6"];
    graph[UPSCALE_NODE] = {
      class_type: "LatentUpscaleBy",
      inputs: {
        samples: ["6", 0],
        scale_by: upscale,
        upscale_method: "nearest-exact"
      }
    };
    graph[REFINE_NODE] = {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: Math.max(8, Math.round(steps * 0.6)),
        cfg: first.inputs.cfg,
        sampler_name: first.inputs.sampler_name,
        scheduler: first.inputs.scheduler,
        denoise: HIRES_DENOISE,
        model: first.inputs.model,
        positive: first.inputs.positive,
        negative: first.inputs.negative,
        latent_image: [UPSCALE_NODE, 0]
      }
    };
    graph["7"].inputs.samples = [REFINE_NODE, 0];
  }
  return graph;
}
function buildEditGraph(req, filePrefix = DEFAULT_FILE_PREFIX) {
  const graph = structuredClone(EDIT_MODEL.graph);
  const seed = Math.trunc(req.seed);
  const steps = req.steps ?? EDIT_MODEL.steps;
  graph["4"].inputs.image = req.sourceName;
  graph["9"].inputs.text = req.prompt.trim();
  graph["14"].inputs.noise_seed = seed;
  graph["16"].inputs.steps = steps;
  graph["19"].inputs.filename_prefix = req.prefix ?? `${filePrefix}_${EDIT_MODEL.suffix}_${seed}`;
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
var QUEUE_WAIT_MS = 30 * 6e4;
function createComfyClient(options) {
  const base = options.base.replace(/\/+$/, "");
  const defaultPoll = options.pollMs ?? 750;
  const clientId = `dsh-genui-${Math.random().toString(36).slice(2)}`;
  const call = (path, init = {}, signal) => fetch(`${base}${path}`, { ...init, signal: signal ?? options.signal });
  const isRunning = async (promptId) => {
    try {
      const res = await call("/queue");
      if (!res.ok) return true;
      const body = await res.json();
      const running = Array.isArray(body?.queue_running) ? body.queue_running : [];
      if (running.length === 0) return true;
      return running.some((entry) => Array.isArray(entry) && entry[1] === promptId);
    } catch {
      return true;
    }
  };
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
      let started = false;
      let deadline = 0;
      const queuedSince = Date.now();
      for (; ; ) {
        const res = await call(`/history/${encodeURIComponent(promptId)}`).catch((err) => {
          throw new Error(`comfy history request failed: ${String(err)}`);
        });
        const body = await jsonBody(res, "history");
        const parsed = parseHistoryEntry(body?.[promptId]);
        if (parsed.state === "done") return parsed.images;
        if (parsed.state === "failed") throw new Error(parsed.message);
        if (!started) {
          if (await isRunning(promptId)) {
            started = true;
            deadline = Date.now() + timeoutMs;
          } else if (Date.now() - queuedSince >= QUEUE_WAIT_MS) {
            throw new Error(
              `comfy queued this render for ${Math.round(QUEUE_WAIT_MS / 1e3)}s without starting it - ComfyUI is busy with another job`
            );
          }
        } else if (Date.now() >= deadline) {
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
import { join as join2 } from "node:path";
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
  return join2(dir, `.${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
}
async function saveRender(dir, filename, bytes) {
  const file = safeImageName(filename);
  await mkdir(dir, { recursive: true });
  const target = join2(dir, file);
  const temp = tempName(dir, file);
  await writeFile(temp, bytes);
  await rename(temp, target);
  return file;
}
async function readRender(dir, filename) {
  const file = safeImageName(filename);
  const bytes = await readFile(join2(dir, file));
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
      const stat = statSync(join2(dir, name2));
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
    if (!existsSync(join2(dir, file))) throw new Error(`no such image: ${asked}`);
    return file;
  }
  const newest = listRenders(dir, 1)[0];
  if (!newest) throw new Error(`no renders in ${dir} to edit yet`);
  return newest.file;
}

// src/host/service.ts
var FAST_TIMEOUT_MS = 24e4;
var PRESET_TIMEOUT_MS = 6e5;
var HIGH_TIMEOUT_MS = 9e5;
var IMAGE_ROUTE = "/genui/images";
function imageUrl(file) {
  return `${IMAGE_ROUTE}/${encodeURIComponent(file)}`;
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
  const filePrefix = config.filePrefix?.trim() || "genui";
  const workflowsNow = () => workflowsOf(config);
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
        ...base.preset ? { preset: base.preset } : {},
        ...base.upscale && base.upscale > 1 ? { upscale: base.upscale } : {},
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
      ...meta.preset ? { preset: meta.preset } : {},
      ...meta.upscale && meta.upscale > 1 ? { upscale: meta.upscale } : {},
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
      const workflows = workflowsNow();
      if (!workflows.includes(lane)) {
        throw new Error(
          `lane "${lane}" is not enabled in this deployment (enabled workflows: ${workflows.join(", ")})`
        );
      }
      const preset = isPreset(input.preset) ? input.preset : void 0;
      if (preset && lane !== PRESET_LANE) {
        throw new Error(
          `preset "${preset}" is a full ${PRESET_LANE} checkpoint: it needs lane "${PRESET_LANE}"`
        );
      }
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
        nsfw: input.nsfw === true,
        preset,
        upscale: input.upscale
      };
      const seed = randomInt(0, 2 ** 32);
      const graph = buildGraph(req, seed, maxBatch, filePrefix);
      const defaults = renderDefaults(lane, quality, preset, filePrefix);
      const upscale = effectiveUpscale(req, req.width ?? defaults.width, req.height ?? defaults.height);
      const promptId = await comfy.queue(graph);
      const timeout = quality === "high" ? HIGH_TIMEOUT_MS : preset || upscale > 1 ? PRESET_TIMEOUT_MS : FAST_TIMEOUT_MS;
      const images = await comfy.wait(promptId, timeout, config.pollMs);
      const steps = Number(graph["6"].inputs.steps);
      const out = await collect(images, seed, steps, { prompt, lane, quality, preset, upscale });
      return result(out, { prompt, lane, quality, preset, upscale, seed, steps });
    },
    async edit(input) {
      const prompt = requirePrompt(input.prompt, "edit_image");
      const source = resolveSource(config.imagesDir, stringOr(input.source));
      const bytes = await readRender(config.imagesDir, source);
      const uploaded = await comfy.upload(source, bytes);
      const seed = Math.trunc(numberOr(input.seed, randomInt(0, 2 ** 32)));
      const steps = Math.trunc(numberOr(input.steps, EDIT_MODEL.steps));
      const graph = buildEditGraph({
        prompt,
        sourceName: uploaded,
        seed,
        steps,
        lora: stringOr(input.lora),
        loraStrength: numberOr(input.loraStrength, numberOr(input.lora_strength, void 0))
      }, filePrefix);
      const promptId = await comfy.queue(graph);
      const images = await comfy.wait(promptId, FAST_TIMEOUT_MS, config.pollMs);
      const out = await collect(images, seed, steps, { prompt, lane: "edit", quality: "fast" });
      return result(out, { prompt, lane: "edit", quality: "fast", seed, steps });
    },
    async health() {
      const workflows = workflowsNow();
      try {
        const res = await fetch(`${config.comfyBase.replace(/\/+$/, "")}/system_stats`, {
          signal: AbortSignal.timeout(2e3)
        });
        return { comfy: res.ok, workflows };
      } catch {
        return { comfy: false, workflows };
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
function registerRoutes(ctx, service, config, mode) {
  const log = ctx.logger("dsh-genui");
  const guard = (req, res, run) => guardWith(req, res, run, log);
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
      path: IMAGE_ROUTE,
      handler: (req, res) => guard(req, res, async () => {
        const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        const prefix = `${IMAGE_ROUTE}/`;
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
function asset(name2) {
  const candidates = [
    new URL(`../assets/${name2}`, import.meta.url),
    // built lib/index.js
    new URL(`../../assets/${name2}`, import.meta.url)
    // src/host/prompt.ts
  ];
  const file = candidates.find((url) => existsSync2(fileURLToPath(url)));
  if (!file) throw new Error(`dsh-genui: assets/${name2} not found`);
  return readFileSync2(file, "utf8").trimEnd();
}
function openuiPrompt(workflows = DEFAULT_WORKFLOWS) {
  const parts = [asset("prompt-core.txt")];
  if (workflows.includes("anime")) parts.push(asset("prompt-anime.md"));
  parts.push(asset("prompt-rules.md"));
  return `${parts.join("\n\n")}
`;
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
  let cachedKey = "";
  let cached = "";
  const promptNow = () => {
    const workflows = workflowsOf(config);
    const key = workflows.join(",");
    if (key !== cachedKey) {
      cached = openuiPrompt(workflows);
      cachedKey = key;
    }
    return cached;
  };
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
      sections: [...built.sections, { name: SECTION, text: promptNow() }],
      contexts: renders ? [...built.contexts, { name: CONTEXT, text: renders }] : built.contexts
    };
  }, { prepend: true });
}

// src/host/mode.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join3 } from "node:path";
function modeFile(env = process.env) {
  const home = env.DSH_HOME?.trim() || join3(homedir2(), ".dsh");
  return join3(home, "genui-mode.json");
}
function unique(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((id) => typeof id === "string" && id.length > 0))];
}
function readState(file) {
  try {
    if (!existsSync3(file)) return { on: [], off: [] };
    const parsed = JSON.parse(readFileSync3(file, "utf8"));
    const on = unique(parsed.sessions);
    const off = unique(parsed.off).filter((id) => !on.includes(id));
    return { on, off };
  } catch {
    return { on: [], off: [] };
  }
}
function createModeStore(file = modeFile(), options = {}) {
  const defaultOn = options.defaultOn ?? true;
  const state = readState(file);
  let on = new Set(state.on);
  let off = new Set(state.off);
  const persist = () => {
    try {
      mkdirSync2(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      const body = { default: defaultOn, sessions: [...on], off: [...off] };
      writeFileSync2(temp, `${JSON.stringify(body, null, 2)}
`);
      renameSync2(temp, file);
    } catch {
    }
  };
  return {
    file,
    defaultOn,
    isOn: (sessionId) => off.has(sessionId) ? false : on.has(sessionId) || defaultOn,
    set: (sessionId, next) => {
      const current = off.has(sessionId) ? false : on.has(sessionId) || defaultOn;
      if (current === next) return;
      on = new Set(on);
      off = new Set(off);
      if (next === defaultOn) {
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
  const mode = createModeStore(void 0, { defaultOn: config.defaultOn });
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
