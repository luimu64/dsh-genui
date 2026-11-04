## Optional workflow: anime

This deployment also enables the **anime** lane: booru-tag models, plus the full anime
checkpoints it ships as presets. Everything here extends `generate_image`; the rest of the
tool description and the rules still apply.

- `lane: "anime"` for anime, manga, cartoon, illustration and stylised art. The prompt is
  booru tags rather than a sentence: subject first ("1girl", "1boy", "no humans"), then
  scene, costume and lighting. The lane's template carries its own quality and style
  prefix, so describe the picture, not the render settings.
- `quality: "high"` on this lane runs the undistilled anime checkpoint (30 steps at CFG 5);
  `fast` stays the distilled eight-step model.
- `preset` swaps the anime checkpoint for a further full one at its own published settings
  (30 steps CFG 4.5) and replaces `quality` rather than combining with it. The ids this
  deployment ships are `"miaoharem"` and `"dasiwa"`: two different anime looks, not a
  better and a worse one. Pass one only when the user asks for that look.
- `nsfw: true` on this lane also drops the template's `safe` and score quality tags, so the
  prompt is not overwritten. Always accompany it with adult subject tags.
- `lane` still defaults to "real": pick "anime" when the user asked for that style.

root = Stack([card])
query = Query("generate_image", {prompt: "1girl, solo, red fox ears, autumn forest, golden light", lane: "anime"}, {url: ""})
card = Card([GenImage(query.url, "A red fox girl in an autumn forest")])

root = Stack([card])
query = Query("generate_image", {prompt: "1girl, solo, silver hair, black leather jacket, neon alley", lane: "anime", count: 4}, {url: "", images: []})
card = Card([GenImageSet(query.images, "Silver-haired girl in a neon alley")])

root = Stack([card])
query = Query("generate_image", {prompt: "1girl, solo, knight in battered plate armour, snowfield at dusk", lane: "anime", preset: "dasiwa", upscale: 1.5}, {url: ""})
card = Card([GenImage(query.url, "Knight in a snowfield, preset look, 1.5x")])
