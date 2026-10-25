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
