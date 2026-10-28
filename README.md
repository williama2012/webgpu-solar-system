# WebGPU Solar System

A real-time, fully client-side 3D solar system rendered with [WebGPU](https://developer.mozilla.org/docs/Web/API/WebGPU_API). The Sun, all eight planets, and twelve major moons orbit at their true periods on a committed compressed display scale: true orbital shape (real eccentricities, inclinations, node longitudes) with distances and body sizes scaled for visibility. No build step — plain ES modules loaded by `index.html`.

## Scene contents

- Sun + 8 planets with labels; 20 orbit lines (one per planet/moon), 256 segments each.
- Twelve major moons: Moon; Phobos & Deimos; Io, Europa, Ganymede & Callisto; Rhea & Titan; Titania & Oberon; Triton (retrograde). Nereid is deliberately omitted — its compressed orbit would nearly coincide with Triton's.
- Moon labels appear when the camera is within 45 scene units of their parent planet, or when the parent is selected.
- Saturn: procedural ring-strip texture, lit with the planet's shadow band.
- Factoid popups per body; time controls, jump-to grid, live scale sliders, FPS readout.

## Browser requirements

- A recent Chrome or Edge with WebGPU enabled (`navigator.gpu`). The page checks on startup and shows an unsupported overlay instead of rendering when it is missing (e.g. Firefox/Safari)。
- The page must be served over HTTP(S): WebGPU requires a secure context, so opening `index.html` via `file://` will not work.

## Running

```console
npm install
npm start          # http-server on http://localhost:8080 (no caching)
```

Open http://localhost:8080 in Chrome or Edge. Any static server that serves the project root works — there is no bundler and no build step.

## Controls

| Input | Effect |
| --- | --- |
| Left-drag | Orbit the camera (pitch clamped to ±85°) |
| Mouse wheel | Zoom (scene distance 0.4–600 u) |
| Right-drag / Shift+left-drag | Pan (panning leaves focus mode) |
| Click a body or its label | Select: factoid popup + camera follows the body |
| Empty click / Esc | Close popup and release focus |

- **Time** — speed slider with chips `1×`, `1 day/s`, `1 month/s`, `1 year/s`, `100 yr/s`, a pause toggle, and a rate readout. At 1× the scene is nearly frozen; at 1 yr/s motion is obvious.
- **Jump to** — ☀ Sun, each planet, and an Overview frame; reframes the chosen body smoothly (focus mode).
- **Scale** (collapsible panel) — planet size, Sun radius, and orbital-distance sliders re-space the scene live on change (recomputed on demand, not a per-frame cost), plus a reset.

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Serves the project root on port 8080 (http-server, no caching) |
| `npm test` | Node smoke test over the pure modules (Kepler solver, period consistency, retrograde sign, matrices, scale table) |
| `npm run lint` | ESLint (flat config) over `src/` |

## Layout

```
index.html               # page shell, loads src/main.js as a module
styles.css               # dark space theme
src/constants.js         # committed astronomical data + display scale
src/math.js              # mat4/vec helpers (pure)
src/orbital-mechanics.js # Kepler solver, orientation, spin, orbit lines (pure)
src/solar-system.js    # scene model: bodies, positions, matrices, scale recompute
src/textures.js        # procedural canvas textures → GPU upload
src/camera-controls.js # OrbitCamera: input, focus-follow, view/projection
src/ui.js              # labels, factoid popups, time/scale controls, overlays
src/renderer.js        # WebGPU device, pipelines, per-frame encoding
src/main.js            # entry: support check, init order, RAF loop
tools/smoke-test.mjs   # node smoke test over the pure modules
```

## Story

This started as the [3D solar system AI prompt](https://docsbot.ai/prompts/technical/3d-solar-system-html) I was using to test the results of different LLMs that can run on my hardware. Some models better than others but Qwen3.8-27B seemed to get the best results from my tests.




## Models tested or to test:
- ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF
- google/gemma-4-26B-A4B-it
- unsloth/DeepSeek-R1-Distill-Qwen-32B-GGUF
- unsloth/Qwen3-VL-30B-A3B-Thinking-1M-GGUF
- unsloth/Qwen3.5-0.8B-GGUF
- unsloth/Qwen3.5-4B-MTP-GGUF
- unsloth/Qwen3.6-35B-A3B-GGUF
- unsloth/Qwen3.6-35B-A3B-MTP-GGUF
- unsloth/Qwen3.8-27B-GGUF
- unsloth/flint-GGUF
- unsloth/orpheus-3b-0.1-ft


#### Config
- Thinking: Extra High
- Context Length: 65536
- t=1, top_p=0.95, top_k=20, min_p=0, repeat-penalty=1.05, presence-penalty=0.1

#### Model & Hardware

- Engine: Unsloth Studio
- Model: unsloth/Qwen3.8-27B-GGUF:UD-Q2_K_XL
- RTX 4080 Super 16GB
- NVIDIA GeForce RTX 4080 SUPER (16GB VRAM)
- Processor	13th Gen Intel(R) Core(TM) i9-13900K

## Token Count
##### I did not capture most of the tokens used on this but I'll try to take samples

Prompt eval
230ms\
Prompt speed
187.1 tok/s\
Generation
7.82s\
Speed
43.9 tok/s\
Tokens
344\
First token
230ms\
Cache hits
45,063\
Total
9.18s\
Chunks
343


#### 2026-10-25
- 12:25PM\
Tokens
2,134,338\
1,191,144 in · 943,194 out
- 1:17PM\
Tokens
2,285,859\
1,284,467 in · 1,001,392 out
- 3:05PM\
Tokens
2,756,262\
1,578,787 in · 1,177,475 out
- 8:32PM\
Tokens
2,592,580\
1,510,020 in · 1,082,560 out


