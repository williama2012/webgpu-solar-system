# WebGPU Solar System Simulation — Execution Plan

Plan written 2026-10-24. Source of truth for the executing agent: re-read this file after any context compaction.
Original task spec: `agent/webgpu-solar-system-instructions.md` — requirements stay authoritative; §2 below traces every one of them.

## 1. Mission

Build a single-page, zero-asset WebGPU solar-system simulation: Sun at the center emitting light and casting (analytic) shadows, all 8 planets orbiting on real Keplerian elements, their major satellites, Saturn's rings, procedural photo-plausible surface textures, screen-space labels, click-to-select with focus + factoid popups, rotate/zoom/pan camera, time control from real-time up to ~100 years per second, and Jump-To buttons for the Sun and all planets. Code is plain ES modules under `src/`, linted with the pre-installed eslint, served by the existing `http-server` script.

## 2. Acceptance criteria (requirement → deliverable trace)

| Requirement | Satisfied by | Verified by |
|---|---|---|
| Render via WebGPU (`navigator.gpu`) | `src/main.js` device bootstrap + `#unsupported-overlay` when absent | Manual: Chrome/Edge opens page, no console errors; Firefox shows overlay message |
| Sun at center with light emission + shadows | Emissive sun pipeline + corona billboard; analytic sphere-occlusion shadowing from all 10 major bodies (sun never occluded) | Manual: day/night terminator on planets; dark eclipse-style bands on Saturn's rings; moons darken when behind a planet |
| All 8 planets orbit realistically | Kepler solver driven by real (a, e, i, Ω, ω, T) per §5 table | Smoke test (§13): period-closure assertion; manual: orbits stable, non-drifting across 10× time presets |
| Major satellites of planet-bearing worlds | 12 satellites listed in §5 (Moon; Phobos/Deimos; 4 Galileans; Rhea/Titan; Titania/Oberon; Triton) | Manual: each parent shows its moons when zoomed in |
| Real-time or accelerated time, motion clearly visible | Log slider 1 s/s → 3.156e9 (100 yr/s) + preset chips (§10) | Manual: at 1× Earth barely moves; at 1 yr/s planets sweep visibly |
| Conceptual gravitational effects (no N-body) | Keplerian orbits with correct relative periods = the concept; documented decision | Review of `orbital-mechanics.js` comments |
| Relative sizes + real relative ratios kept for clarity | One size multiplier S applied to every body (ratios preserved); separate sun display radius; power-law distance compression K·a^p | §4 table; manual: Jupiter clearly bigger than Earth, moons keep correct relative sizes |
| Labels on planets/sun/moons | DOM label layer, projected per frame; moon labels LOD-gated by zoom | Manual: labels track bodies; moon labels appear only when close |
| Camera rotate/zoom/pan | `OrbitCamera` in §9 (drag/wheel/shift-drag) | Manual: all three gestures work; focus lerp is smooth |
| Click planet → focus + factoid popup (diameter, distance from sun, orbital period, temperature range, number of moons, extras) | Screen-space picking (§9.5) or label click → select+focus+popup | Manual: popup fields match §5 data; Esc/close/empty-click dismiss |
| Time-scale control 1 s/s … 100 yr/s | Log mapping `multiplier = 10^(t·log10(3.15576e9))` + readout formatter | Manual: readout switches s/s → h/s → d/s → yr/s; preset chips land on correct values |
| Jump To buttons (Sun + all planets) | `#jump-to-grid` in HUD | Manual: each button reframes that body smoothly |
| Split into modules, human-readable names, no minification, function comments with descriptions+signatures | `src/` layout §3, conventions §11 | eslint passes; code review |
| Use eslint for basic validation | `npm run lint` (already `eslint src`) green | CI-less gate: run before completion claim |

## 3. Repository layout (write each file to disk the moment it is complete — never hold a half-written file)

```
index.html            # page shell: canvas#viewport, #label-layer, HUD, popup, overlays; <script type="module" src="./src/main.js">
styles.css            # dark space theme, label chips, panels, popup, sliders, responsive
src/constants.js      # astronomical data + committed scene scale (§4/§5) — pure data, node-importable
src/math.js           # mat4/vec helpers + NDC→screen projection — pure, node-importable
src/orbital-mechanics.js  # Kepler solver, orientation, spin, moon/retrograde rules — pure, node-importable
src/textures.js       # procedural canvas 2D textures (planets/sun/moons/rings) → GPUTexture upload
src/solar-system.js   # scene model: bodies, display radii/distances, per-frame world positions + matrices
src/camera-controls.js# OrbitCamera class (input, focus lerp, view/projection)
src/ui.js             # labels, factoid popup, time controls, jump-to grid, scale panel, fps, unsupported overlay
src/renderer.js       # GPU: device, pipelines, buffers, bind groups, per-frame encode/submit, draw order
src/main.js           # entry: support check, init order, RAF loop, resize, error overlays
eslint.config.mjs     # flat config (§11)
README.md             # run/serve/browser requirements/control summary
package.json          # existing; add `globals` devDep via npm + a "test" script only
tools/smoke-test.mjs  # node import smoke test for pure modules (§13)
```

Write order (one file fully written+saved before starting the next; run lint after each checkpoint group): A) index.html, styles.css → B) constants.js → C) math.js, orbital-mechanics.js (+ `node tools/smoke-test.mjs`) → D) textures.js (verify texture-upload API against a reference first, §14) → E) solar-system.js → F) camera-controls.js → G) ui.js → H) renderer.js → I) main.js → J) eslint.config.mjs, README.md, tools/smoke-test.mjs → K) final full validation (§13) + requirement walk-through.

## 4. Committed scene-scale model (use exactly; do not re-derive waffle-style)

Units: 1 scene unit is arbitrary. Scene frame: right-handed, Y-up, X–Z = ecliptic plane. Light at origin.

- Planet display distance: `D(a_AU) = K · a_AU^p`, **K=20, p=0.5** (slider p ∈ [0.4, 0.8], step 0.05). Real eccentricities applied to the *compressed* a (orbit shapes look right at every zoom).
- Every body's display radius: `R_disp = (R_km / 1e6) · S`, **S=40** (slider 10…300, step 5; single multiplier ⇒ relative sizes always exact). Moons use the same S — no separate moon scale.
- Sun display radius: separate slider, **default 5.0 u** (range 1…20). Never let the slider break planet/moon ratios (it doesn't).
- Moon display distance: `d(a_mMkm) = M · a_mMkm^q`, **M=10, q=0.7**, with floor `d = max(d, 1.8 × parent_display_radius)` (floor chosen at 1.8× because 2.0× would merge Europa/Io and break their radial order — verified below).
- Initial camera: target (0,0,0), distance **240 u**, yaw 35°, pitch 18° → Neptune at 109.7 u frames with margin.

Committed numbers (computed once; encode as expected values in the smoke test):

| Body | a (AU) | D(u) | R(km) | R_disp(u) |
|---|---|---|---|---|
| Sun | — | 0 | 696,340 | 5.0 (slider) |
| Mercury | 0.3871 | 12.44 | 2,439.7 | 0.098 |
| Venus | 0.7233 | 17.01 | 6,051.8 | 0.242 |
| Earth | 1.0000 | 20.00 | 6,371.0 | 0.255 |
| Mars | 1.5237 | 24.69 | 3,389.5 | 0.136 |
| Jupiter | 5.2026 | 45.62 | 69,911 | 2.796 |
| Saturn | 9.55 | 61.81 | 58,232 | 2.329 |
| Uranus | 19.189 | 87.61 | 25,362 | 1.014 |
| Neptune | 30.07 | 109.66 | 24,622 | 0.985 |

| Moon | a (Mmkm) | d(u) | R(km) | R_disp(u) |
|---|---|---|---|---|
| Moon (Earth) | 0.3844 | 5.12 | 1,737.5 | 0.069 |
| Phobos (Mars) | 0.009378 | 0.383 | 11.1 | 0.00044 |
| Deimos (Mars) | 0.023459 | 0.723 | 7.5 | 0.00030 |
| Io (Jupiter) | 0.4217 | 5.47 | 1,821.6 | 0.073 |
| Europa (Jupiter) | 0.671034 | 7.56 | 1,560.8 | 0.062 |
| Ganymede (Jupiter) | 1.0704 | 10.49 | 2,634.1 | 0.105 |
| Callisto (Jupiter) | 1.8827 | 15.57 | 2,410.3 | 0.096 |
| Rhea (Saturn) | 0.527108 | 6.39 | 763.8 | 0.031 |
| Titan (Saturn) | 1.22187 | 11.51 | 2,574.7 | 0.103 |
| Titania (Uranus) | 0.43591 | 5.59 | 788.4 | 0.032 |
| Oberon (Uranus) | 0.58352 | 6.86 | 761.4 | 0.030 |
| Triton (Neptune) | 0.354759 | 4.84 (retrograde) | 2,075.5 | 0.083 |

Ordering preserved within every system (Galilean order Io 5.46 < Europa 7.56 < Ganymede 10.49 < Callisto 15.57; Titan 11.50 outside Rhea 6.39; Oberon 6.86 outside Titania 5.59; Deimos 0.724 outside Phobos 0.383). Scale-slider changes recompute all display values once and rebuild orbit-line buffers (§8) — not per frame.

## 5. Astronomical data to encode in `src/constants.js`

### 5.1 Data rules
- “Approximate” everywhere it appears in popups; this is a visualization, not an ephemeris.
- **Self-consistency rule:** never combine two independently quoted values that violate Kepler's third law for the given central body (this is what caught the known-bad pairs Nereid T=11.06 d at a=347,124 km and Europa a=383,300 km with its 3.551-d period). If a lookup disagrees with §4/§5 numbers at build time and cannot be resolved, keep this plan's pair and add a code comment naming the discrepancy.
- Verification anchor: Triton a=354,759 km ⇒ T≈5.87 d by the smoke test — if the method reproduces canonical periods (Triton 5.877; Io 1.769, Europa 3.551, Ganymede 7.155, Callisto 16.69 d), trust the table.

### 5.2 Planets (J2000-ish; values marked *(approx) may be re-verified against a reference at build time — otherwise keep them exactly as listed)
Fields: a(AU), e, i°, Ω°, ϖ° (=Ω+ω, longitude of pericenter), T(days), R(km), spin(hours; negative = retrograde), axialTilt°, textureKey, labelColor hex.

| Body | a | e | i° | Ω° | ϖ° | T d | Spin h | Tilt° |
|---|---|---|---|---|---|---|---|---|
| Mercury | 0.3871 | 0.2056 | 7.00 | 48.3 | 77.5 | 87.969 | +1407.5 | 0.03 |
| Venus | 0.7233 | 0.0068 | 3.39 | 76.7 | 131.6 | 224.701 | −5832.5 | 177.4 |
| Earth | 1.0000 | 0.0167 | 0.00 | 0.0*(approx) | 102.9 | 365.256 | +23.93 | 23.44 |
| Mars | 1.5237 | 0.0934 | 1.85 | 49.6*(approx) | 336.0*(approx) | 686.98 | +24.62 | 25.19 |
| Jupiter | 5.2026 | 0.0484 | 1.30 | 100.5 | 14.7 | 4332.59 | +9.93 | 3.13 |
| Saturn | 9.55 | 0.0555 | 2.49 | 113.7 | 92.6 | 10759 | +10.66 | 26.73 |
| Uranus | 19.189 | 0.0472 | **0.77** | 73.0*(approx) | 172.0*(approx) | 30688 | −17.24 | 97.77 |
| Neptune | 30.07 | 0.0090 | 1.77 | 130.3*(approx) | 249.0*(approx) | 60182 | +16.11 | 28.30 |

Inclination guard: Uranus i° is **0.77** — 7.73° is a 10× typo found in circulating copies and would visibly mis-orbit it; the committed table value stands.

Initial mean longitudes M0 (approx J2000, just for a natural-looking start): Mercury 252.3°, Venus 182.0°, Earth 100.5°, Mars 355.9°, Jupiter 34.4°, Saturn 49.9°, Uranus 313.2°, Neptune 304.8°. (At the small e's involved, Ω/ω/M0 accuracy is visually irrelevant — they only keep orbits from all pointing the same way.)

Sun record: type “G2V yellow dwarf”, display radius slider default 5 u, surface ≈5,500 °C, diameter 1.3927 Mm km (shown as 1,392,700 km), age ≈4.6 Gyr, trivia: contains 99.86% of the system's mass; sunlight takes ~8 m 20 s to reach Earth.

### 5.3 Moons — fields: parent, a(Mmkm), T(d) (must satisfy §5.1 rule), R(km), retrograde? (Triton only), i°(default 0), textureKey, trivia
Moon / Earth · Phobos + Deimos / Mars · Io, Europa, Ganymede, Callisto / Jupiter · Rhea, Titan / Saturn · Titania, Oberon / Uranus · Triton (retrograde) / Neptune — values as in §4 table (Triton a=354,759 km, T=5.877 d). Nereid is deliberately not in the “major” set and omitted: its compressed orbit (≈4.8 u at q=0.7) would nearly coincide with Triton's 4.84 u; if asked for later, add a=347,124 km with T per §5.1 (~5.7 d), never 11.06 d.

### 5.4 Factoid popup strings (committed short-form)
Planet card fields exactly: Name/Type · Diameter km (2×R, comma-formatted) · Distance from Sun (AU + “×Mm km”) · Orbital period (days or years, whichever reads better) · Surface temperature range · Moons (count) · Day length · 1–2 trivia lines.
- Temperatures: Mercury −173…427 °C; Venus ≈+464 °C; Earth record extremes ≈−89…+57 °C; Mars ≈−140…+20 °C; Jupiter ≈−108 °C (1 bar); Saturn ≈−139 °C; Uranus ≈−197 °C (coldest atmosphere); Neptune ≈−200 °C.
- Moon counts shown (approx): 0, 0, 1, 2, “95+”, “146+”, “28+”, “16+”.
- Trivia (one each max 12 words): Mercury solar day 176 d · Venus hottest planet, CO₂/SO₄ clouds · Earth only known life, 71% ocean · Mars Olympus Mons tallest volcano · Jupiter Great Red Spot bigger than Earth · Saturn would float on water; rings are water ice · Uranus spins on its side (98° tilt) · Neptune fastest winds ~2,100 km/h.
- Moon cards: Name/Type “Moon of X” · Parent · Distance from planet (km) · Orbital period · Diameter km · Surface temp (Moon −173…127 °C; Titan ≈−179 °C; others “poorly characterized — see trivia”) · Trivia one line each: Moon receding ~3.8 cm/yr, no atmosphere · Io most volcanic body (tidal) · Europa subsurface ocean · Ganymede largest moon, bigger than Mercury, own magnetic field · Callisto ancient cratered crust · Rhea large regular Saturnian moon · Titan N₂ air, methane lakes/rain · Titania largest Uranian moon · Oberon icy, heavily cratered · Tritron retrograde, N₂ geysers, likely captured KBO · Phobos/Deimos tiny Mars satellites (Phobos slowly spiralling into Mars).

## 6. Module specifications

Every exported function gets a JSDoc block: one-line description + `@param` types + `@returns`. Internal functions too when non-obvious. Human-readable names throughout; loop counters named (e.g. `vertexIndex`). Indent 2, single quotes, semicolons.

**src/math.js** (pure). Column-major Float32Array(16) mat4s; vectors are plain `{x,y,z}` objects.
- `createIdentityMatrix()`
- `multiplyMatrices(left, right)` — result = left×right
- `createPerspectiveMatrix(fieldOfViewYRadians, aspectRatio, nearDistance, farDistance)` (commit near=0.1, far=4000)
- `createLookAtViewMatrix(eyePosition, targetPosition, upVector)` — build world→view directly (no inverse)
- `translationMatrix4(position)`, `rotationAroundX/Y/Z(radians)`, `composeBodyModel(position, tiltRadians, spinRadians, displayRadius)` = T·Rz(tilt)·Ry(spin)·S
- vector helpers: `addVectors3`, `scaleVector3`, `lengthOfVector3`, `normalizeVector` (new-object returns OK at this scale)
- `projectWorldToScreen(worldPosition, viewProjectionMatrix, viewportWidth, viewportHeight)` → `{xPixels, yPixels, isBehindCamera}` — NDC→px, reject w≤0

**src/orbital-mechanics.js** (pure) — see §8 for the math. Exports: `solveKeplerEquation(meanAnomaly, eccentricity)`, `computePlanetPosition(planetRecord, simTimeSeconds)` → scene {x,y,z}, `computeMoonPosition(moonRecord, parentScenePosition, simTimeSeconds)`, `computeSpinAngle(secondsPerRotation, retrograde?, simTimeSeconds)`, `computeOrbitEllipseLocalVertices(elements, segmentsCount)` (XZ-plane loop centered on the focus with pericenter offset c=a·e).

**src/textures.js** — canvas 2D procedural → upload:
- `generateSurfaceCanvas(spec)` → HTMLCanvasElement 256×128. Spec-driven painter: base fill; latitude bands (for gas/ice giants, Jupiter adds Great-Red-Spot blob, Saturn muted); fBm value-noise domain-warped mottling (seeded mulberry32 PRNG per body key); Earth special-case (ocean blue + green/brown continent blobs + white poles); rocky palette speckles + crater circles (Mercury, Moon, Phobos/Deimos); ice palettes (Europa pale, Titan hazy orange-brown? no—Titan hazy: sepia; Rhea/Titania/Oberon gray-pink; Callisto/Io sulfur-sulfur/sulfur → Io sulfur-yellow, Callisto dark-cratered).
- `generateSunCanvas()` — bright yellow-orange mottle.
- `generateRingStripCanvas()` — 256×8: radial band profile inner→outer: C-ring dim, B-bright, Cassini division dark notch, A-ring medium, thin Encke gap, faint outer F edge.
- `uploadCanvasAsTexture(device, canvas, isSrgb=true)` → GPUTexture `bgra8unorm-srgb`, 256×128 (rings 256×8), mip-less: `dimension 2D`, `format`, `usage TEXTURE_BINDING | COPY_DST`. **Verify the exact current importImage / copyExternalImageToTexture call sequence against the reference named in §14 before writing this function; if the adapter advertises an import-external feature, request it (see §14 risk).**

**src/solar-system.js** — scene model:
- `createSolarSystem(textureMap)` → `bodies` array; each record: `{name, kind:'sun'|'planet'|'moon', parentName?, radiusKm, displayRadius, elements? {aAU|aMmkm,e,iRad,omegaRadOmega(Ω),pericenterLongitudeRad(ϖ),meanAnomaly0,periodSeconds}, spin{secondsPerRotation, tiltRadians}, displayOrbitDistance (planets §4; moons incl. 1.8× floor), textureName, isRetrograde?, labelColor}` — also precomputes `occluderIndex` for the analytic list (sun+8 planets, slots 0..9).
- `computeWorldPositions(simTimeSeconds)` → `Map<name,[x,y,z]>` (planets via Kepler; moons = parent pos + moon offset; retrograde via negative mean-motion sign).
- `computeBodyModelMatrices(worldPositions, simTimeSeconds)` → per-body model matrix (§8.3 spin) and per-orbit world matrix (parent T × plane orientation — **no** spin term for orbit lines).
- Scale recompute entry point: `applySceneScale({planetSizeMultiplier, sunDisplayRadius, distancePower})` → mutates display radii/distances, rebuilds orbit-line GPU buffers via a callback into renderer.

**src/camera-controls.js** — `class OrbitCamera`:
- State: `targetPosition`, `yawRadians`, `pitchRadians`, `distance`; `focusBodyName|null`.
- `attachDomElement(canvas)`: pointer events per §9; wheel preventDefault (passive:false).
- `requestFocus(bodyName)` → set `focusBodyName`; distance target = `max(bodyDisplayRadius×6, 1.5)` for moons/planets, `sunDisplayRadius×8` for sun.
- `update(deltaTimeSeconds, worldPositions)`: if focused → track body's live position (auto-follow), lerp `1−exp(−dt×5)`; free mode target lerps to origin.
- `getViewMatrix()`, `getProjectionMatrix(aspect)` (fovY=60°, near 0.1, far 4000), `getDistanceTo(point)` for label LOD/picking.

**src/ui.js** — DOM builders, no rendering math: `createLabelLayer(labelContainerEl, bodies)` with per-body div (accent = labelColor, click→select callback); `updateLabels(worldPositions, camera, simTimeSeconds?)` sets transforms + visibility (moon LOD: show if `camera.getDistanceTo(parentPos) < 45` u or parent is selected; all planets+sun always shown unless behind camera per w≤0 test); `createFactoidPopup(rootEl, onSelectClose)` renders §5.4 card; `createTimeControls(containerEl, stateGetters/Setters)` = slider + chips [1×, 1 day/s, 1 month/s (30 d), 1 year/s, 100 yr/s] + pause toggle + readout; `createJumpToGrid(containerEl, onFocusBodyName)` = ☀ Sun + 8 planets + “Overview”; `createScalePanel(containerEl, onScaleChange)` = 3 sliders + reset (inside `<details>`); `createFpsReadout(el)`; `showUnsupportedOverlay(el, supported)`. Readout formatter: <3600 → “N s/s”; <86400 → “N h/s” (1 decimal if small); <3.15576e7 → “N d/s”; else → “N yr/s”.

**src/renderer.js** — `class SolarSystemRenderer`:
- `async initialize()` per §7; expose `renderFrame(frameContext)` where frameContext = {globalUniformsData, bodyDrawList:[{modelMatrix, bindGroup, selfOccluderIndex}|…], orbitDrawList, ringDraw, coronaDraw, cameraBasis}.
- All GPU creation inside methods named for the artifact (`createSphereGeometry()`, `createOrbitLineGeometry(elements, segmentsCount)`, `createPipelines()`, `buildBindGroups(textureMap)`).
- Error handling: `device.lost` promise → overlay message; validation errors console + overlay.

**src/main.js** — entry. Order: DOM refs → `navigator.gpu` check (else unsupported overlay, stop) → textures (canvases §D, upload after device exists — canvases first, upload in renderer init) → `createSolarSystem` → camera → ui wiring → RAF loop. Loop: `deltaSeconds = clamp(now−last, 0, 0.05)`; if not paused `simTimeSeconds += deltaSeconds × timeScaleMultiplier`; compute positions/matrices (solar-system) → `renderer.renderFrame(...)`; update labels + fps + camera.update(deltaSeconds). Resize handler: track canvas CSS size × devicePixelRatio; on change recreate depth texture (depth32float) and set viewport. Keyboard: Esc = close popup/release focus (bonus, cheap).

## 7. GPU design (commit everything; one render pass per frame)

**Device init:** `navigator.gpu.requestAdapter()` → `requestDevice({requiredFeatures: advertised? ['import-external'] : []})` (only if adapter.features contains it — see §14) → `GPUCanvasContext.configure({device})`. No MSAA (sampleCount 1). Swapchain texture from `canvasContext.getCurrentTexture()`. Depth texture: one reusable `depth32float` at framebuffer size.

**Geometry (all created once, shared):**
- Unit sphere: 64×48 lat-lon grid → 3185 vertices, uint32 indices (~18.4k); attributes `position(3f)`, `normal(3f)`, `uv(2f)`; body size via model matrix only.
- Orbit lines: per-orbit 256-segment loop in local XZ plane (focus-centered ellipse vertices, §8), one buffer per orbit (21 orbits); per-frame cost = 1 mat4 upload each.
- Saturn rings: annulus, 128 radial segments × [inner 1.15, outer 2.3] × body radius; attributes position(3f)+uv(2f); drawn double-sided (`frontFacing()` normal flip).
- Corona: camera-facing quad in vertex shader from passed camRight/camUp/pos/scale (size = sunDisplayRadius×4).
- Background: single fullscreen triangle, `in out ndc`.

**Pipelines (6):** `pBackgroundStars` (no depth test/write), `pOrbitLines` (depth test ON, write OFF; standard alpha, per-orbit color vec4 with alpha 0.55 planets / 0.35 moons), `pSphereLit` (opaque; lighting+analytic shadows, §7.6), `pSunEmissive` (unlit: texture × brightness + rim boost `(1−|N·V|)^2`), `pRings` (alpha blend, double-sided, same shadow code as lit so Saturn casts a real band), `pCoronaBillboard` (additive).

**Uniform layouts (exact):**
- Global buffer, 512 B allocated, written once/frame: `[0..15] vec4 cameraPosition; [16..31] f32 timeSeconds + 3×pad; [32..79] vec3 camForward/camRight/camUp (+pad); [80..95] f32 occluderCount + pad; [96..351] OccluderSlot{vec3 center; f32 radius} ×16` (slots 0..9 = sun+planets, count=10). `LIGHT_POSITION` is a shader const vec3(0,0,0) — the sun never moves.
- Per-body buffer 72 B: `{mat4 model; f32 radius; f32 selfOccluderIndex}` (+pad to 80 B allocation rows).
- Orbit buffer 80 B: `{mat4 model; vec4 colorAlpha; pad vec2}`.
- All sizes multiples of 4 ✓; `queue.writeBuffer` each (fine at this scale).

**Bind groups:** per body: bg[0]=texture, bg[1]=sampler(clamp, linear/linear), bg[2]=own uniform buffer. Layout: texture+sampled buffer, no storage. Rings/sun reuse the same layout pattern with their own textures/buffers. Orbit pipeline: 1 bg (buffer only). Corona/background: global buffer in bg[0] (+ corona quad uniforms folded into global buffer tail if needed — else own tiny buffer).

**Frame sequence (one pass):** 1) stars fullscreen; 2) orbit lines (planets then moons); 3) sun emissive mesh; 4) planets+moons lit spheres; 5) Saturn rings; 6) corona billboard. Pipeline switches explicit, no sorting needed at these depths (rings after Saturn body; depth test handles ring-behind-planet).

**WGSL:** template-string constants `BACKGROUND_STARS_WGSL`, `ORBIT_LINE_WGSL`, `SPHERE_LIT_WGSL`, `SUN_EMISSIVE_WGSL`, `SATURN_RINGS_WGSL`, `CORONA_BILLBOARD_WGSL`; each ≤120 lines, top comment naming every fn; vertex in→out structs shared between stages and matching JS layouts exactly (byte offsets!).

### 7.6 Analytic shadow fragment code (SPHERE_LIT / SATURN_RINGS)
```
dir = normalize(LIGHT_POSITION − worldPos);          // light at origin
toSphere; lit=1.0;
for (occluderIndex in 0..occluderCount) {
  if (occluderIndex == selfOccluderIndex) continue;   // never test own sphere
  toSphere = occluders[occluderIndex].center − worldPos;
  proj = dot(dir, toSphere);                         // >0 only if in front of fragment… toward light
  if (proj <= 0.0) continue;
  perp = length(toSphere − dir * proj);             // closest approach distance
  margin = occluders[occluderIndex].radius * 0.25;   // penumbra softness
  lit *= smoothstep(occluders[occluderIndex].radius, occluders[occluderIndex].radius + margin, perp);
}
diffuse = texColor * (ambient 0.05 + 0.95 * max(dot(N, -dir), 0.0) * lit);
```
(Illumination dir points from fragment to light: `L = normalize(LIGHT_POSITION − worldPos)`; use `max(dot(N, L), 0.0).`) Gives: planet day/night terminators, moons darkening behind planets (eclipse-style), Saturn's shadow band across its own rings, ring shadows on nothing else (correct — no light source is occluded for fragments on the sun). Moons excluded from occluder list (10 slots of majors only).

### 7.7 Sun look: emissive sphere (mottled texture) + corona billboard (additive): fragment = layered radial falloff `pow(1−r, 3)` × 2 noise octaves, warm palette; plus faint blue night-side ambient on lit bodies (0.05) per §7.6.

### 7.8 Starfield: from NDC reconstruct view direction `dir = normalize(camForward + camRight·(ndcX·tanFovX) + camUp·(ndcY·tanFovY))`; grid-hash stars (cell=floor(dir×48), density ~0.12, per-star brightness/twinkle `sin(time×k+phase)`); optional faint Milky-Way band `exp(−dot(dir, bandNormal)²/s)` — include, cheap.

## 8. Orbital mechanics (orbital-mechanics.js)

### 8.1 Kepler
`M(t) = M0 + 2π·t/T` (mod 2π); solve `E − e·sinE = M`: Newton `E ← E − (E − e·sinE − M)/(1 − e·cosE)`, start `E=M`, max 8 iterations, tolerance 1e-7. True position in perifocal frame: `r = a_disp·(1 − e·cosE)`; `ν` from `tan(ν/2)=√((1+e)/(1−e))·tan(E/2)`; `p_perifocal = (r·cosν, r·sinν, 0)` with **a_disp = §4 compressed distance** (shape real, size compressed). Mean motion uses the *real* period T — so at 1 yr/s Jupiter visibly laps while Neptune crawls: correct relative dynamics.

### 8.2 Orientation + scene frame
Work in right-handed heliocentric ecliptic (Z-up): `p_ecl = rotZ(Ω) · rotX(i) · rotZ(ω) · p_perifocal`, `ω = ϖ − Ω` (degrees→radians). Scene mapping (Y-up, right-handed — frame committed in §4): `scenePos = (p_ecl.x, p_ecl.z, −p_ecl.y)`. Moons: same machinery around their parent's **compressed** a (`M·a^q` with floor), i≈0; retrograde bodies (Triton orbit; Venus/Uranus spin) via negative mean-motion/spin sign. Orbit *line* vertices (§6): `x = −c + a_disp·cosθ, z = b_disp·sinθ` in local XZ with `b=a√(1−e²), c=a·e`, wrapped by the §8.2 rotation (no parent translation in local buffer; world matrix adds it).

### 8.3 Body spin (visual)
`spinAngle = 2π·t / secondsPerRotation` (sign from record); model matrix `composeBodyModel(pos, tiltRadians, spinAngle, displayRadius)` per §6 (Rz(tilt) before Ry(spin): Uranus shows its sideways rotation; Venus's retrograde sign in spin hours handles its slow backward drift).

### 8.4 Time control
`timeScaleMultiplier = 10^(t · log10(3.15576e9))`, slider t∈[0,1] → [1, 3.15576e9] s-sim/s-real (100 Julian years). Pause freezes the multiplier only (rendering continues). Known accepted behavior: at max rate Mercury completes many orbits per frame — visible as fast sweep, not smooth; document in README.

## 9. Camera + input

1. Rotate: left-drag `yaw += dx·0.01`, `pitch −= dy·0.01`, pitch clamped ±85°.
2. Zoom: wheel `distance ×= exp(deltaY × 0.001)`, clamped [0.4, 600]; focus-mode keeps tracking target distance separately lerped by §6 rule (requestFocus sets target distance, not instantly).
3. Pan: right-drag OR shift+left-drag: move `targetPosition` along camera right/up scaled by `distance·0.01` per pixel (pan cancels focus → free mode; target = panned point).
4. Focus-follow: while focused, `targetPosition` lerps to the body's live world position each frame (factor `1−exp(−dt×5)`) — moving bodies carry the camera.
5. Picking: on click (no drag), project every body center (§6); candidate if `|click − centerPx| ≤ max(screenRadiusPx·1.4, 12)` where `screenRadiusPx = displayRadius × (viewportHeight/2) / (tan(fovY/2)·distanceToBody)`; pick smallest normalized excess; label clicks go straight to that body. Select → camera.requestFocus + popup; empty click/Esc closes popup, releases focus (target keeps lerping home via free-mode origin lerp).

## 10. UI layout (DOM ids committed)

- `#viewport` canvas fullscreen; `#label-layer` (pointer-events none, children auto) above it.
- Right HUD column: `#title-bar` (“WebGPU Solar System”), `#fps-readout`, control hints line, `#time-controls` (§6: slider + 5 chips + pause + readout), `#jump-to-grid` (☀ Sun, Mercury…Neptune, “Overview” — last one = free mode, target origin, distance 240), `<details> #scale-panel` (Planet size ×S, Sun radius, Distance compression p; reset button).
- `#factoid-popup`: bottom-center card per §5.4 fields + close ✕; appears with select, hides on Esc/close/empty-click.
- Labels: `translate(−50%,−140%)` of projected point, 12 px, body-color border, cursor pointer; hidden when `isBehindCamera` or (moon && LOD fails §6).
- Unsupported overlay `#unsupported-overlay`: full-screen card “WebGPU not available — use latest Chrome/Edge” + note that this is a hard requirement of the task; shown only when `!navigator.gpu`.

## 11. Code + lint conventions

- JSDoc on every function (exported or not): description line + `@param` (name, type) + `@returns`; WGSL gets a per-file header comment listing each fn signature.
- Human-readable names everywhere; **no single-letter variables** (loop vars: `vertexIndex`, `segmentIndex`, `occluderSlot`); 2-space indent; single quotes; semicolons; no minification ever; constants UPPER_SNAKE with units in name where useful (`PLANET_SIZE_MULTIPLIER_DEFAULT`).
- `eslint.config.mjs` (flat):
```js
import js from '@eslint/js';
import globals from 'globals';
export default [
  js.configs.recommended,
  { files: ['src/**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } }, rules: {} },
];
```
- `npm i -D globals` (only new dependency allowed by the task); add script `"test": "node tools/smoke-test.mjs"` to package.json (existing `start`/`lint` untouched).

## 12. Execution order (checkpoints; save each file the moment it is complete)

1. Recon: `ls`, read `package.json` (confirm start/lint), confirm no browser automation exists (don't install one).
2. A: index.html + styles.css → save.
3. B: constants.js (full §4+§5 data, comments on every record group) → save; lint (no JS rules yet — config lands in J; running eslint here is optional, config not present → skip, note it).
4. C: math.js, orbital-mechanics.js, tools/smoke-test.mjs → run `node tools/smoke-test.mjs` green.
5. D: textures.js — **before writing uploadCanvasAsTexture, read the texture-upload reference in §14 and confirm the importImage/copyExternalImageToTexture sequence** → save; lint.
6. E: solar-system.js → lint.
7. F: camera-controls.js → lint.
8. G: ui.js → lint.
9. H: renderer.js (pipelines, buffers, bind groups, renderFrame, device-lost handling) → lint.
10. I: main.js → lint.
11. J: eslint.config.mjs + `npm i -D globals` + README.md (+ package.json test script) → `npm run lint` full green.
12. K: Final pass — re-run smoke test; walk §2 table file-by-file; confirm README matches reality; **stop and ask the user to open the page in Chrome/Edge** (no browser in this environment — never claim visual success beyond static checks).

## 13. Validation plan

- `npm run lint` → 0 errors/warnings treated as failures (eslint.config.mjs has no warn rules; any finding is an error to fix).
- `node tools/smoke-test.mjs` asserts (all on pure modules): 
  - Kepler: `solveKepler(0,e)≈0`; `solveKepler(π,e)≈π`; periodicity: planet position at t and t+T equal within 1e-3·a; radius within [a(1−e), a(1+e)].
  - Period consistency (validates §5.1 rule): Kepler-computed T(a=671,034 km) about Jupiter = 3.551 d ±2% (the known-bad 383,300 km value would fail this), T(a=354,759 km) about Neptune = 5.87 d ±2% (Triton; the known-bad 11.06-d value would fail this), and Io/Ganymede/Callisto table periods each reproduce within 2%.
  - Retrograde: Triton scene z-velocity sign opposite a prograde twin at same t.
  - Matrices: rotations orthonormal (column dot products ≈ 1/0); multiply associative sanity; perspective×view maps a known forward point behind camera correctly (w>0, |ndcZ|<1).
  - Scale table: `applySceneScale` defaults reproduce the §4 committed numbers within 0.01 u.
- Manual browser checklist (hand to user, mirrored in README): page loads, stars visible, sun glowing; all 8 planet labels track orbits; jump-to each body lands framed; select Earth → popup fields + focus follows Moon system; zoom into Jupiter → 4 moon labels appear; Saturn rings lit with shadow band; time slider sweep: at 1× nearly frozen, at 1 yr/s clear motion; pause freezes; scale sliders re-space scene live without glitches; resize OK; Esc closes popup; unsupported overlay appears on a non-WebGPU browser (manual, different browser); FPS readout steady.
- Honest limit statement for the user: WebGPU rendering cannot be executed in this environment; static + logic checks only. If the user reports any visual failure, fix via §14 mitigations, re-run all above.

## 14. Risks & mitigations (pre-mortem)

| Risk | Mitigation |
|---|---|
| WGSL not lintable by eslint — silent shader compile errors | One WGSL const per pipeline; mirror structs in JS comments with byte offsets; keep each shader ≤120 lines; manual re-read of every `createShaderModule` block before finalizing renderer.js |
| Texture upload API drift (`importImage` / `copyExternalImageToTexture` exact form, possible feature gate) | Before step D read a current reference: https://github.com/greggman/webgpu-samples (texture-from-image example) or the spec's `GPUDevice.importImage`/`GPUDeviceQueue.copyExternalImageToTexture`; if adapter advertises an external-image feature, request it in `requestDevice`; keep a second documented fallback path (`createImageBitmap` source) |
| ES modules break under file:// | README + chat message: **always** `npm start` (http-server :8080); never open index.html directly |
| GPU device lost / context configure failure | `device.lost` handler + try/catch around init → friendly overlay, no white page |
| Tiny moons at low S (Phobos/Deimos sub-pixel) | Expected; raise Size slider — README hint; labels remain the primary cue; picking uses 12 px threshold so sub-pixel bodies are still clickable near their orbit |
| Max time-scale aliasing (Mercury multiple laps/frame) | Accepted, documented; slider default lands at 1× so first paint is calm |
| Label clutter when zoomed on gas giants | LOD §6: moon labels only under 45 u from parent or on selection; planets+sun always |
| depth32float precision at far=4000 | Ratio near/far = 4e4 fine in 32-bit float; lines write no depth; spheres are spatially separated (no interpenetration by construction: §4 floors keep moons outside parents) |
| Orbit lines z-fighting against sphere silhouettes | Lines: depth test ON but write OFF, drawn before meshes → occluded correctly, never fight |
| Data uncertainty (§5.2 *(approx) cells) | Self-consistency rule §5.1; visual irrelevance at these e's keeps any error cosmetic |
| Context compaction mid-build losing decisions | This file is the decision ledger; step 1 of every resumption = re-read it |

## 15. Definition of done

All §2 rows green (code side): `npm run lint` green; `node tools/smoke-test.mjs` green; 14 files present per §3; README accurate; final chat message delivers: how to run (`npm start` → http://localhost:8080), browser requirement, what was built, the committed scale defaults, known limitations (no browser-tested visual pass here; max-rate aliasing note), and an explicit request for the user to try it and report any failure. No feature beyond §2 scope was added except three explicitly-listed trivial conveniences (pause toggle, Esc closes popup, “Overview” jump button).
