## Optional workflow: moss

This deployment also enables the **moss** lane: MOSS-Image SFT (OpenMOSS, 5B) running raw at
its own published settings, without the four-step LoRA the `real` lane uses. It is the same
model family `real` runs, so the difference is not the model but the route: fewer shortcuts,
longer prompts, and the lettering and layout behaviour fully intact. Everything here extends
`generate_image`; the rest of the tool description still applies.

- `lane: "moss"` when the picture should be slow and considered rather than fast: a long
  caption, a scene with several elements or characters placed deliberately, a poster, an
  illustrated card, anything with words in it.
- Prompt it as a **caption**, one flowing description of what is in frame: subject, action,
  setting, light, lens, mood. Tags and JSON-ish layout phrasing also work, but a paragraph is
  what this model was trained on. It reads English best and Chinese fine.
- **Lettering:** text you want in the picture goes in quotes — `a shop sign reading "OPEN"` —
  and newlines in the string become line breaks. The lane is allowed to letter, so the
  no-text negatives are not applied to it.
- `quality: "fast"` is 25 steps at CFG 2.5 with the `er_sde` sampler, the ComfyUI template's
  tuned settings: about half a minute plus load. `high` is 50 steps at CFG 3 with euler and
  skip-layer guidance on layer 22, the OpenMOSS settings: closer to the model card, roughly
  twice the wait. Reach for `high` when one picture is the whole answer.
- Resolution wants 1 to 2 megapixels in multiples of 16, so 832x1216 and 992x1504 are the
  house sizes; a wide 1344x768 is also native. `upscale` is a latent refine pass and works
  here, but MOSS already resolves 2 MP, so prefer `high` over `upscale` when the goal is
  detail.
- `nsfw: true` drops the `nsfw` token from the negative and leaves the rest of it alone.
- This lane is slow and the `real` lane is the same weights on a four-step LoRA: for a quick
  photograph, a product or a person, `real` is the better call. Use `moss` for text, layout
  and long prompts.

root = Stack([card])
query = Query("generate_image", {prompt: "A weathered enamel shop sign reading \"Open\" hangs over a narrow cobbled street at dusk, wet stone, one warm bulb above the door, 50mm, shallow depth of field", lane: "moss"}, {url: ""})
card = Card([GenImage(query.url, "Hand-painted shop sign at dusk")])
