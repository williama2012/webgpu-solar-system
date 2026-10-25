/**
 * Procedural texture generation: canvas 2D painters, then WebGPU upload.
 *
 * Every surface is painted onto an offscreen 256x128 equirectangular canvas
 * and uploaded once after device creation (plan §6). Saturn's rings use a
 * separate 256x8 strip texture sampled radially by the ring shader (plan §7).
 *
 * Each body's `textureKey` (src/constants.js) selects an entry in
 * TEXTURE_SPECS; painter mode + palette live here so constants stays pure
 * astronomy. All randomness flows from mulberry32 seeded with the key,
 * which makes every run pixel-identical (plan §6).
 */

/** Texture canvas width in pixels (all surfaces). */
export const SURFACE_WIDTH = 256;

/** Texture canvas height in pixels (equirectangular, 2:1). */
export const SURFACE_HEIGHT = 128;

/** Ring strip texture size; x axis is radial inner→outer, y is unused. */
export const RING_STRIP_WIDTH = 256;

/** Ring strip texture height (8 px keeps radial precision without waste). */
export const RING_STRIP_HEIGHT = 8;

/* ====================== Seeded PRNG + noise ====================== */

/**
 * 32-bit FNV-1a hash of a string to an unsigned int.
 * @param {string} key Text to hash (always the textureKey).
 * @returns {number} Deterministic uint32 seed.
 */
function hashKeyToSeed(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 PRNG (plan §6: one stream per body key).
 * @param {number} seed Unsigned 32-bit start value.
 * @returns {() => number} Generator yielding floats in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 2D value noise on a fixed lattice, smoothstep-bilerped.
 * Inputs are normalized [0,1] texture coordinates.
 */
class ValueNoise2D {
  /**
   * @param {() => number} rng Seeded generator; consumed for the lattice.
   * @param {number} [cells=8] Lattice resolution (cells per axis).
   */
  constructor(rng, cells = 8) {
    this.size = cells + 1;
    this.values = new Float32Array(cells * cells);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rng();
  }

  /**
   * Sample noise at normalized coordinates.
   * @param {number} x U in [0,1].
   * @param {number} y V in [0,1].
   * @returns {number} Value in [0,1].
   */
  sample(x, y) {
    const n = this.size - 1;
    const gx = x * n;
    const gy = y * n;
    const xi = Math.min(n - 1, Math.floor(gx));
    const yi = Math.min(n - 1, Math.floor(gy));
    const fx = gx - xi;
    const fy = gy - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (px, py) => this.values[py * this.size + px];
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }
}

/**
 * Fractal Brownian motion over a ValueNoise2D.
 * @param {ValueNoise2D} noise Lattice to sample.
 * @param {number} x U in [0,1].
 * @param {number} y V in [0,1].
 * @param {number} [octaves=5] Octaves.
 * @param {number} [lacunarity=2] Frequency multiplier per octave.
 * @param {number} [persistence=0.5] Amplitude decay per octave.
 * @returns {number} Value around 0.5 in [0,1].
 */
function fbm(noise, x, y, octaves = 5, lacunarity = 2, persistence = 0.5) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    value += noise.sample(x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / norm;
}

/**
 * Domain-warp offset for fBm: warps (x,y) by two low-frequency fields.
 * @param {ValueNoise2D} warpField Field driving the warp.
 * @param {number} x U in [0,1].
 * @param {number} y V in [0,1].
 * @param {number} [amp=0.15] Warp magnitude (fraction of the plane).
 * @returns {[number, number]} Warped coordinates.
 */
function domainWarp(warpField, x, y, amp = 0.15) {
  const wx = fbm(warpField, x + 7.31, y + 2.17, 3);
  const wy = fbm(warpField, x + 3.94, y + 8.82, 3);
  return [x + amp * (wx - 0.5) * 2, y + amp * (wy - 0.5) * 2];
}

/* ====================== Color helpers ====================== */

/**
 * Parse '#rrggbb' into an [r,g,b] triple in 0-255.
 * @param {string} hex Hex color string.
 * @returns {[number, number, number]} Channel triple.
 */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Mix two colors in sRGB space and format for canvas fillStyle.
 * @param {[number,number,number]} a First color.
 * @param {[number,number,number]} b Second color.
 * @param {number} t Weight of b, clamped to [0,1].
 * @returns {string} 'rgb(r,g,b)'.
 */
function mixRgb(a, b, t) {
  const c = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * c);
  const g = Math.round(a[1] + (b[1] - a[1]) * c);
  const bl = Math.round(a[2] + (b[2] - a[2]) * c);
  return `rgb(${r},${g},${bl})`;
}

/**
 * Per-pixel painter loop helper: fills a row-by-row pass with a color fn.
 * @param {CanvasRenderingContext2D} ctx Target context (256x128).
 * @param {(u: number, v: number) => [number,number,number]} colorFn
 *   Per-pixel RGB triple (floats; clamped here).
 */
function paintImage(ctx, colorFn) {
  const img = ctx.createImageData(SURFACE_WIDTH, SURFACE_HEIGHT);
  for (let py = 0; py < SURFACE_HEIGHT; py++) {
    for (let px = 0; px < SURFACE_WIDTH; px++) {
      const [r, g, b] = colorFn(px / SURFACE_WIDTH, py / SURFACE_HEIGHT);
      const i = (py * SURFACE_WIDTH + px) * 4;
      img.data[i] = clampByte(r);
      img.data[i + 1] = clampByte(g);
      img.data[i + 2] = clampByte(b);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Clamp a channel value to [0,255] and round for ImageData.
 * @param {number} v Raw channel value.
 * @returns {number} Byte value.
 */
function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/* ====================== Painter registry ====================== */

/**
 * textureKey → painter spec. `painter` selects the mode; palette + knobs are
 * all the §6 commitments (Jupiter spot, Saturn toned down, rocky crater
 * lists, ice-moon palettes). Keys cover every non-sun body in constants.
 */
export const TEXTURE_SPECS = {
  jupiter: { painter: 'bands', base: '#d8b49a', light: '#ecd9bd', dark: '#96714e', bandFreq: 6, contrast: 0.75, mottleAmp: 0.18,
    spot: { x: 0.56, y: 0.63, rx: 13, ry: 7 } },
  saturn: { painter: 'bands', base: '#ddc49b', light: '#ead9b5', dark: '#c2a273', bandFreq: 8, contrast: 0.35, mottleAmp: 0.12 },
  uranus: { painter: 'bands', base: '#bfd6d2', light: '#d3e8e4', dark: '#9cc2bb', bandFreq: 4, contrast: 0.15, mottleAmp: 0.1, scale: 2 },
  neptune: { painter: 'bands', base: '#3a569b', light: '#7d9fd8', dark: '#1f356b', bandFreq: 5, contrast: 0.45, mottleAmp: 0.18,
    spot: { x: 0.35, y: 0.58, rx: 8, ry: 4.5, outer: '#16295c', mid: '#20356a', inner: '#4f6fb0' } },
  venus: { painter: 'bands', base: '#e2cfa0', light: '#f0e3c0', dark: '#cbab72', bandFreq: 3, contrast: 0.1, mottleAmp: 0.3, scale: 1.6 },
  earth: { painter: 'earth' },
  mars: { painter: 'plain', base: '#b06a43', mottleAmp: 0.5, scale: 2.4, poles: true },
  mercury: { painter: 'rocky', base: '#8f887e', craters: 22, speckles: 30, mottleAmp: 0.3 },
  moon: { painter: 'rocky', base: '#9b968c', craters: 18, speckles: 24, mottleAmp: 0.3 },
  phobos: { painter: 'rocky', base: '#6f6358', craters: 6, speckles: 10, mottleAmp: 0.3 },
  deimos: { painter: 'rocky', base: '#756a5e', craters: 5, speckles: 8, mottleAmp: 0.3 },
  callisto: { painter: 'rocky', base: '#4b4a47', craters: 16, speckles: 26, speckleTone: '#9c9a92', mottleAmp: 0.25 },
  europa: { painter: 'plain', base: '#d9d0c2', mottleAmp: 0.18, scale: 2.2 },
  titan: { painter: 'plain', base: '#b57a3e', mottleAmp: 0.14, scale: 1.6 },
  rhea: { painter: 'plain', base: '#a3948e', mottleAmp: 0.15, scale: 2 },
  titania: { painter: 'plain', base: '#97877d', mottleAmp: 0.15, scale: 2 },
  oberon: { painter: 'plain', base: '#8b7f76', mottleAmp: 0.15, scale: 2 },
  triton: { painter: 'plain', base: '#bcc7c3', mottleAmp: 0.22, scale: 2 },
  io: { painter: 'plain', base: '#cdb43c', mottleAmp: 0.55, scale: 3, vents: 10, ventColor: '#5d4a1f' },
  ganymede: { painter: 'plain', base: '#8e8172', mottleAmp: 0.4, scale: 2.2 }
};

/**
 * Resolve a spec by textureKey.
 * @param {string} textureKey Key from a scene record.
 * @returns {object} Spec object; generic rocky fallback for unknown keys.
 */
function resolveSpec(textureKey) {
  return TEXTURE_SPECS[textureKey] || {
    painter: 'rocky', base: '#8a8a8a', craters: 12, speckles: 20, mottleAmp: 0.3
  };
}

/**
 * Paint one surface (256x128) per its spec.
 * @param {object} spec Painter spec (see TEXTURE_SPECS).
 * @returns {HTMLCanvasElement} Painted canvas, equirectangular.
 */
export function generateSurfaceCanvas(spec) {
  const canvas = document.createElement('canvas');
  canvas.width = SURFACE_WIDTH;
  canvas.height = SURFACE_HEIGHT;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(hashKeyToSeed(specKeyFor(spec)));
  const noise = new ValueNoise2D(rng, 8);
  const warpField = new ValueNoise2D(rng, 6);
  const base = hexToRgb(spec.base || '#888888');

  if (spec.painter === 'earth') {
    paintEarth(ctx, noise, warpField, rng);
  } else {
    paintImage(ctx, (u, v) => bandOrMottleColor(spec, base, noise, warpField, u, v));
  }
  if (spec.spot) drawSpot(ctx, spec.spot);
  if (spec.painter === 'rocky') drawCratersAndSpeckles(ctx, spec, base, rng);
  return canvas;
}

/**
 * Painters receive no name; the seed must match the body's key. The caller
 * stashes the key on the spec object (done in generateAllCanvases).
 * @param {object} spec Spec with its `seedKey` attached by the caller.
 * @returns {string} Key to hash for the PRNG.
 */
function specKeyFor(spec) {
  return spec.seedKey || 'generic';
}

/**
 * Per-pixel color for bands/plain/mottle painters.
 * @param {object} spec Spec (light/dark/bandFreq/contrast/mottleAmp/scale).
 * @param {[number,number,number]} base Parsed base color.
 * @param {ValueNoise2D} noise Field for mottling.
 * @param {ValueNoise2D} warpField Field driving the domain warp.
 * @param {number} u U coordinate in [0,1].
 * @param {number} v V coordinate in [0,1].
 * @returns {[number,number,number]} RGB triple for this pixel.
 */
function bandOrMottleColor(spec, base, noise, warpField, u, v) {
  const scale = spec.scale || 3;
  const [wx, wy] = domainWarp(warpField, u, v, 0.2 / Math.max(1, scale));
  let color = base;
  if (spec.bandFreq) {
    const bandPhase = v * spec.bandFreq * Math.PI + (fbm(noise, wx, wy, 3) - 0.5) * 1.4;
    const t = 0.5 + 0.5 * Math.sin(bandPhase);
    color = mixRgbArr(hexToRgb(spec.light), hexToRgb(spec.dark), t);
  }
  // Mottling mixes toward the spec's light/dark anchors; plain and rocky
  // specs get synthesized variants of their base so all modes share this.
  const mottle = (fbm(noise, wx * scale, wy * scale) - 0.5) * 2;
  if (spec.mottleAmp) {
    const light = spec.light ? hexToRgb(spec.light) : scaleColor(base, 1.3);
    const dark = spec.dark ? hexToRgb(spec.dark) : scaleColor(base, 0.65);
    color = mottle > 0
      ? mixRgbArr(color, light, mottle * spec.mottleAmp)
      : mixRgbArr(color, dark, -mottle * spec.mottleAmp);
  }
  return color;
}

/**
 * Scale a channel triple toward or away from black (no clamp; callers do).
 * @param {[number,number,number]} c Channel triple.
 * @param {number} f Multiplicative factor.
 * @returns {[number,number,number]} Scaled triple.
 */
function scaleColor(c, f) {
  return [c[0] * f, c[1] * f, c[2] * f];
}

/**
 * @param {[number,number,number]} a First color.
 * @param {[number,number,number]} b Second color.
 * @param {number} t Weight of b in [0,1].
 * @returns {[number,number,number]} Mixed triple (not formatted).
 */
function mixRgbArr(a, b, t) {
  const c = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * c,
    a[1] + (b[1] - a[1]) * c,
    a[2] + (b[2] - a[2]) * c
  ];
}

/**
 * Paint Earth: ocean base, fBm continents, white poles, thin cloud pass.
 * @param {CanvasRenderingContext2D} ctx Target context.
 * @param {ValueNoise2D} noise Field for land mask and clouds.
 * @param {ValueNoise2D} warpField Warp field for the coastlines.
 * @param {() => number} rng Seeded generator (continents are its order).
 */
function paintEarth(ctx, noise, warpField, rng) {
  const ocean = [18, 60, 124];
  const landGreen = [93, 132, 66];
  const landTan = [150, 128, 84];
  const cloudNoise = new ValueNoise2D(rng, 12);
  paintImage(ctx, (u, v) => {
    const [wx, wy] = domainWarp(warpField, u, v, 0.3);
    const mask = fbm(noise, wx * 2.2, wy * 2.2, 5);
    let color;
    if (mask > 0.55) {
      const landMix = fbm(noise, wx * 4 + 11, wy * 4 + 7, 3);
      color = mixRgbArr(landGreen, landTan, landMix);
    } else {
      color = ocean;
    }
    // Polar caps with ragged fBm edges (v=0 is the north pole).
    const edge = Math.max(0, Math.min(1, Math.abs(v - 0.5) * 2));
    const capStart = 0.86 - 0.08 * fbm(cloudNoise, u * 3, 0.02, 2);
    if (edge > capStart) {
      const capT = Math.min(1, (edge - capStart) / 0.14);
      color = mixRgbArr(color, [235, 240, 245], capT);
    }
    // Thin cloud pass: soft white mottling at ~18% alpha feel.
    const cloud = fbm(cloudNoise, u * 5 + 3.1, v * 7 + 9.4, 4);
    if (cloud > 0.62) {
      color = mixRgbArr(color, [245, 245, 250], (cloud - 0.62) * 2.2);
    }
    return color;
  });
}

/**
 * Draw the Great Red Spot style vortex onto a bands canvas.
 * @param {object} s Spot spec: normalized center + radii in px.
 */
function drawSpot(ctx, s) {
  const cx = s.x * SURFACE_WIDTH;
  const cy = s.y * SURFACE_HEIGHT;
  const outer = s.outer || '#a8461f';
  const mid = s.mid || '#b3552f';
  const inner = s.inner || '#e6d7bd';
  const layer = (rx, ry, css, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = css;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  layer(s.rx * 1.45, s.ry * 1.5, outer, 0.35);
  layer(s.rx, s.ry, mid, 0.9);
  layer(s.rx * 0.45, s.ry * 0.5, inner, 0.8);
  ctx.globalAlpha = 1;
}

/**
 * Rocky bodies: darker speckles + rimmed craters (Mercury/Moon/Callisto/
 * Phobos/Deimos per §6; Callisto also gets bright fresh-impact specks).
 * @param {CanvasRenderingContext2D} ctx Target context.
 * @param {object} spec Spec (craters, speckles, optional speckleTone).
 * @param {[number,number,number]} base Parsed base color.
 * @param {() => number} rng Seeded generator (continues the noise stream).
 */
function drawCratersAndSpeckles(ctx, spec, base, rng) {
  const dark = [Math.round(base[0] * 0.55), Math.round(base[1] * 0.55), Math.round(base[2] * 0.55)];
  const speckleCount = spec.speckles || 0;
  for (let i = 0; i < speckleCount; i++) {
    const sx = rng() * SURFACE_WIDTH;
    const sy = rng() * SURFACE_HEIGHT;
    ctx.fillStyle = mixRgb(dark, [255, 255, 255], (spec.speckleTone ? hexToRgb(spec.speckleTone)[0] / 255 : 0) * 0.6);
    const sr = 0.6 + rng() * 1.4;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < (spec.craters || 0); i++) {
    const cx = rng() * SURFACE_WIDTH;
    const cy = 8 + rng() * (SURFACE_HEIGHT - 16);
    const cr = 1.5 + Math.pow(rng(), 2) * 4.5;
    ctx.fillStyle = mixRgb(dark, [0, 0, 0], 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
    // Rim highlight offset toward the (fake) light.
    ctx.fillStyle = mixRgb(base, [255, 255, 255], 0.35);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(cx - cr * 0.25, cy - cr * 0.25, cr * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/**
 * Paint the Sun surface: bright yellow-orange cell mottle (no bands).
 * The corona itself is drawn by the renderer (plan §7.7); this is the
 * emissive sphere texture.
 * @returns {HTMLCanvasElement} 256x128 painted canvas.
 */
export function generateSunCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = SURFACE_WIDTH;
  canvas.height = SURFACE_HEIGHT;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(hashKeyToSeed('sun'));
  const noise = new ValueNoise2D(rng, 8);
  const warpField = new ValueNoise2D(rng, 6);
  paintImage(ctx, (u, v) => {
    const [wx, wy] = domainWarp(warpField, u, v, 0.25);
    const grain = fbm(noise, wx * 4, wy * 4, 5);
    const cell = fbm(noise, wx * 1.6 + 5, wy * 1.6 + 2, 3);
    let color = mixRgbArr(hexToRgb('#ffb63d'), hexToRgb('#ffe9a8'), grain);
    color = mixRgbArr(color, hexToRgb('#ff8c1f'), Math.max(0, cell - 0.5) * 1.4);
    return color;
  });
  return canvas;
}

/**
 * Paint Saturn's ring strip: 256x8, x axis radial inner→outer.
 * Profile per §6: C faint, B bright, Cassini dark notch, A medium,
 * thin Encke gap, faint F-ring outer edge. y rows are uniform (y unused).
 * @returns {HTMLCanvasElement} 256x8 painted canvas.
 */
export function generateRingStripCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = RING_STRIP_WIDTH;
  canvas.height = RING_STRIP_HEIGHT;
  const ctx = canvas.getContext('2d');
  const profile = (t) => {
    // t in [0,1] inner→outer.
    let alpha = 0;
    if (t > 0.18 && t < 0.34) alpha = 0.25 + 0.1 * Math.sin(t * 90);            // C ring, faint
    if (t >= 0.36 && t < 0.62) alpha = 0.85 + 0.1 * Math.sin(t * 140);         // B ring, bright
    if (t >= 0.62 && t < 0.66) alpha = 0.08;                                   // Cassini division
    if (t >= 0.68 && t < 0.9) {                                              // A ring, medium
      alpha = 0.55 + 0.08 * Math.sin(t * 200);
      if (Math.abs(t - 0.78) < 0.006) alpha = 0.05;                          // Encke gap
    }
    if (t >= 0.93 && t < 0.97) alpha = 0.12;                                  // F ring, faint
    return alpha;
  };
  for (let x = 0; x < RING_STRIP_WIDTH; x++) {
    const a = profile(x / (RING_STRIP_WIDTH - 1));
    ctx.fillStyle = `rgba(226,212,184,${a.toFixed(3)})`;
    ctx.fillRect(x, 0, 1, RING_STRIP_HEIGHT);
  }
  return canvas;
}

/**
 * Generate every surface the renderer needs.
 * @param {Array<{textureKey: string}>} bodies Scene records (any iterable
 *   of objects carrying `textureKey`); 'sun' routes to the sun painter.
 * @returns {{ byTextureKey: Map<string, HTMLCanvasElement>, saturnRing: HTMLCanvasElement }}
 *   Map keyed by textureKey plus the ring strip canvas under its own key.
 */
export function generateAllCanvases(bodies) {
  const byTextureKey = new Map();
  for (const record of bodies) {
    if (record.textureKey === 'sun') {
      byTextureKey.set('sun', generateSunCanvas());
    } else {
      const spec = resolveSpec(record.textureKey);
      spec.seedKey = record.textureKey;
      byTextureKey.set(record.textureKey, generateSurfaceCanvas(spec));
    }
  }
  return { byTextureKey, saturnRing: generateRingStripCanvas() };
}

/**
 * Upload a painted canvas as an sRGB (or linear) GPUTexture.
 *
 * API sequence per plan §14 (verified against the gpuweb external-import
 * reference before this module was written): the device MUST have been
 * requested with `requiredFeatures: ['external-import-capability']`
 * (handled in renderer init, which checks
 * `adapter.hasFeature('external-import-capability')`). If the direct
 * canvas import throws, retry with a `createImageBitmap` source (§14
 * committed fallback) before giving up.
 *
 * @param {GPUDevice} device GPU device (feature already requested).
 * @param {HTMLCanvasElement} canvas Painted canvas (any size; texture matches it).
 * @param {boolean} [isSrgb=true] Whether the data is sRGB-encoded.
 * @returns {Promise<GPUTexture>} Mip-less 2D TEXTURE_BINDING|COPY_DST texture
 *   in bgra8unorm-srgb (or bgra8unorm when isSrgb is false).
 */
export async function uploadCanvasAsTexture(device, canvas, isSrgb = true) {
  const descriptor = {
    format: isSrgb ? 'bgra8unorm-srgb' : 'bgra8unorm',
    dimension: '2d',
    width: canvas.width,
    height: canvas.height,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  };
  let source = canvas;
  try {
    const imported = device.importExternalImage(source, { flipYFromGreen: true });
    return device.importCanvasAsTexture(imported, descriptor);
  } catch {
    // §14 fallback: some implementations only accept a bitmap source.
    source = await createImageBitmap(canvas);
    const imported = device.importExternalImage(source, { flipYFromGreen: true });
    return device.importCanvasAsTexture(imported, descriptor);
  }
}
