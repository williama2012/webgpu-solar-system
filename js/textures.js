/* textures.js
 * Procedural surface textures. Nothing is fetched from the network: every planet gets a
 * physically-flavoured 2D canvas (equirectangular, 2:1) painted with 3D value noise sampled
 * on the unit sphere, so there is no seam at the wrap. The alpha channel encodes a
 * *specular mask* (oceans / ices) so the planet shader can add a water glint. The Moon
 * and the rocky moons additionally get crater decals.
 */

const TextureGen = {
  /* ---------------- deterministic PRNG + 3D value noise ---------------- */

  mulberry32(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  },

  hash3(i, j, k) {
    const projected = i * 1.0 + j * 51.7 + k * 131.3;
    return Math.abs(projected - Math.floor(projected));
  },

  smooth(t) {
    return t * t * (3 - 2 * t);
  },

  /** Trilinear value noise on the integer lattice, domain-warped input expected. */
  value3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = TextureGen.smooth(x - xi), fy = TextureGen.smooth(y - yi), fz = TextureGen.smooth(z - zi);
    const c000 = TextureGen.hash3(xi, yi, zi),       c100 = TextureGen.hash3(xi + 1, yi, zi);
    const c010 = TextureGen.hash3(xi, yi + 1, zi),   c110 = TextureGen.hash3(xi + 1, yi + 1, zi);
    const c001 = TextureGen.hash3(xi, yi, zi + 1),   c101 = TextureGen.hash3(xi + 1, yi, zi + 1);
    const c011 = TextureGen.hash3(xi, yi + 1, zi + 1), c111 = TextureGen.hash3(xi + 1, yi + 1, zi + 1);
    const x01 = c000 + (c100 - c000) * fx, x11 = c010 + (c110 - c010) * fx;
    const x02 = c001 + (c101 - c001) * fx, x12 = c011 + (c111 - c011) * fx;
    const y01 = x01 + (x11 - x01) * fy, y02 = x02 + (x12 - x02) * fy;
    return y01 + (y02 - y01) * fz;
  },

  fbm3(x, y, z, octaves) {
    let total = 0, amplitude = 1, frequency = 1, norm = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      total += TextureGen.value3(x * frequency, y * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2.02;
    }
    return total / norm;
  },

  /** Maps equirectangular (u,v) to a unit-sphere direction so noise is seamless. */
  sphereDirection(u, v) {
    const latitude = (v - 0.5) * Math.PI;                 /* -90..+90 */
    const longitude = u * Math.PI * 2;
    return [
      Math.cos(latitude) * Math.cos(longitude),
      Math.sin(latitude),
      Math.cos(latitude) * Math.sin(longitude)
    ];
  },

  mix3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  },

  /* ---------------- crater decals ---------------- */

  addCraters(context, width, height, count, maxRadiusFraction, palette, random) {
    for (let crater = 0; crater < count; crater += 1) {
      const u = random();
      const v = 0.12 + random() * 0.76;                        /* keep poles mostly clear */
      const radiusFraction = (0.015 + 0.9 * random() * random()) * maxRadiusFraction;
      const pixelRadius = Math.max(2, radiusFraction * height);
      const x = u * width;
      const y = v * height;
      /* Floor: soft dark disc. */
      const floor = context.createRadialGradient(x, y, pixelRadius * 0.15, x, y, pixelRadius);
      floor.addColorStop(0, `rgba(${palette.floor[0]},${palette.floor[1]},${palette.floor[2]},0.42)`);
      floor.addColorStop(0.72, `rgba(${palette.floor[0]},${palette.floor[1]},${palette.floor[2]},0.18)`);
      floor.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = floor;
      context.beginPath();
      context.arc(x, y, pixelRadius, 0, Math.PI * 2);
      context.fill();
      /* Rim: faint bright annulus slightly above centre (fake relief). */
      const rim = context.createRadialGradient(x, y - pixelRadius * 0.18, pixelRadius * 0.55,
                                              x, y - pixelRadius * 0.18, pixelRadius * 0.98);
      rim.addColorStop(0, 'rgba(255,255,255,0)');
      rim.addColorStop(0.7, `rgba(${palette.rim[0]},${palette.rim[1]},${palette.rim[2]},0.16)`);
      rim.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = rim;
      context.beginPath();
      context.arc(x, y, pixelRadius, 0, Math.PI * 2);
      context.fill();
    }
  },

  /* ---------------- pixel-loop painters ---------------- */

  paintPixels(width, height, pixelFn, random) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const imageData = context.createImageData(width, height);
    const pixels = imageData.data;
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const u = column / width;
        const v = row / height;
        const [red, green, blue, alpha] = pixelFn(u, v, random);
        const index = (row * width + column) * 4;
        pixels[index] = red;
        pixels[index + 1] = green;
        pixels[index + 2] = blue;
        pixels[index + 3] = alpha;
      }
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  },

  /* ---------------- per-body recipes ---------------- */

  rocky(u, v, random, params) {
    const direction = TextureGen.sphereDirection(u, v);
    const rough = TextureGen.fbm3(direction[0] * 3.1 + 7.3, direction[1] * 3.1 + 1.7, direction[2] * 3.1 + 9.2, 4);
    const fine = TextureGen.fbm3(direction[0] * 11.0, direction[1] * 11.0, direction[2] * 11.0, 3);
    let color = TextureGen.mix3(params.dark, params.light, rough * 0.85 + fine * 0.25);
    if (params.spotColor) {
      const spotMask = TextureGen.fbm3(direction[0] * 1.9 + 40.0, direction[1] * 1.9, direction[2] * 1.9, 3);
      if (spotMask > 0.56) { color = TextureGen.mix3(color, params.spotColor, (spotMask - 0.56) * 2.2); }
    }
    return [color[0], color[1], color[2], 255];
  },

  banded(u, v, random, params) {
    /* Horizontal banding driven mostly by latitude, warped by turbulence. */
    const warp = TextureGen.fbm3(u * 5.0, v * 9.0, 3.1, 3);
    const bandSignal = v * params.bands + warp * params.warp;
    const bandPhase = bandSignal - Math.floor(bandSignal);
    const bandIndex = Math.floor(bandSignal) % params.palette.length;
    const smoothBand = TextureGen.smooth(Math.min(Math.abs(bandPhase - 0.5) * 2, 1));
    const baseA = params.palette[bandIndex % params.palette.length];
    const baseB = params.palette[(bandIndex + 1) % params.palette.length];
    let color = TextureGen.mix3(baseA, baseB, 1 - smoothBand);
    /* Latitudinal fade toward the poles keeps the poles calmer. */
    const latitude = Math.abs(v - 0.5) * 2;
    color = TextureGen.mix3(color, params.poleColor ?? baseA, latitude * latitude * (params.poleFade ?? 0.35));
    /* Fine mottling so the surface never looks flat. */
    const mottle = TextureGen.fbm3(u * 14.0, v * 26.0, 8.8, 3);
    color = TextureGen.mix3(color, params.highlight ?? [255, 255, 255], (mottle - 0.5) * params.mottleStrength);
    if (params.spot) {
      const du = Math.min(Math.abs(u - params.spot.u) - 0.5 + 1, 1) - 0.5;   /* wrapped dx */
      const dv = v - params.spot.v;
      const ellipse = (du * du) / (params.spot.rx * params.spot.rx)
                    + (dv * dv) / (params.spot.ry * params.spot.ry);
      if (ellipse < 1) {
        color = TextureGen.mix3(color, params.spot.color, Math.pow(1 - ellipse, 0.7) * 0.92);
      }
    }
    return [color[0], color[1], color[2], 255];
  },

  earthlike(u, v, random) {
    const direction = TextureGen.sphereDirection(u, v);
    const continents = TextureGen.fbm3(direction[0] * 2.6 + 11.4, direction[1] * 2.6 + 3.2, direction[2] * 2.6 + 5.7, 5);
    const detail = TextureGen.fbm3(direction[0] * 9.0, direction[1] * 9.0, direction[2] * 9.0, 4);
    const seaLevel = 0.545;
    const latitude = Math.abs((v - 0.5) * 2);
    let color, alpha;
    if (continents > seaLevel) {
      /* Land: green forest -> dry savanna -> mountain grey by detail + elevation. */
      const elevation = (continents - seaLevel) / (1 - seaLevel);
      let land = TextureGen.mix3([58, 94, 44], [122, 110, 72], detail * 0.8);
      land = TextureGen.mix3(land, [154, 141, 111], elevation * elevation * 0.55);
      /* Tropical band keeps low latitudes greener. */
      land = TextureGen.mix3([42, 92, 48], land, latitude);
      color = land;
      alpha = 34;
    } else {
      const depth = (seaLevel - continents) / seaLevel;
      color = TextureGen.mix3([26, 74, 122], [8, 32, 74], Math.min(depth * 1.7, 1));
      /* Shallow glow right at the coast. */
      const coast = 1 - Math.min((seaLevel - continents) * 26, 1);
      color = TextureGen.mix3(color, [66, 128, 158], coast * 0.55);
      alpha = 214;
    }
    /* Polar ice. */
    const ice = TextureGen.smooth(Math.min(Math.max(latitude - 0.86, 0) / 0.10, 1));
    const iceColor = [226, 238, 244];
    color = TextureGen.mix3(color, iceColor, ice);
    alpha = Math.max(alpha, ice * 190);
    return [color[0], color[1], color[2], alpha];
  },

  /* ---------------- public API ---------------- */

  forBodyId(bodyId) {
    const random = TextureGen.mulberry32(1234 + bodyId.length * 77 + bodyId.charCodeAt(0));
    let width = 512, height = 256;
    if (['earth', 'jupiter', 'saturn', 'uranus', 'neptune', 'venus', 'mars'].includes(bodyId)) {
      width = 1024; height = 512;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    switch (bodyId) {
      case 'mercury':
      case 'moon':
      case 'callisto': {
        const params = bodyId === 'moon'
          ? { dark: [88, 88, 92], light: [168, 168, 172], floor: [46, 46, 50], rim: [210, 210, 214] }
          : bodyId === 'callisto'
            ? { dark: [58, 56, 52], light: [112, 108, 100], floor: [30, 29, 27], rim: [170, 166, 158] }
            : { dark: [92, 86, 80], light: [178, 172, 164], floor: [44, 40, 36], rim: [205, 199, 190] };
        TextureGen.paintPixels(width, height, (u, v) => TextureGen.rocky(u, v, random, params), random);
        const count = bodyId === 'moon' ? 130 : bodyId === 'callisto' ? 90 : 110;
        TextureGen.addCraters(context, width, height, count, 0.055, { floor: params.floor, rim: params.rim }, random);
        break;
      }
      case 'io': {
        TextureGen.paintPixels(width, height, (u, v) => {
          const direction = TextureGen.sphereDirection(u, v);
          const sulphur = TextureGen.fbm3(direction[0] * 4.2 + 21.0, direction[1] * 4.2, direction[2] * 4.2, 4);
          let color = TextureGen.mix3([186, 152, 62], [222, 200, 112], sulphur);
          const volcano = TextureGen.fbm3(direction[0] * 1.6 + 55.0, direction[1] * 1.6, direction[2] * 1.6, 3);
          if (volcano > 0.62) { color = TextureGen.mix3(color, [122, 60, 34], (volcano - 0.62) * 3.4); }
          return [color[0], color[1], color[2], 255];
        }, random);
        break;
      }
      case 'europa': {
        TextureGen.paintPixels(width, height, (u, v) => {
          const direction = TextureGen.sphereDirection(u, v);
          const base = TextureGen.fbm3(direction[0] * 3.4 + 31.0, direction[1] * 3.4, direction[2] * 3.4, 4);
          let color = TextureGen.mix3([196, 188, 172], [226, 220, 208], base);
          /* Lineae: long brown ridges where a low-frequency field crosses zero-ish. */
          const lineae = Math.abs(TextureGen.fbm3(direction[0] * 5.2 + 91.0, direction[1] * 5.2, direction[2] * 5.2, 3) - 0.5);
          if (lineae < 0.035) { color = TextureGen.mix3(color, [122, 78, 46], (0.035 - lineae) * 22); }
          return [color[0], color[1], color[2], 255];
        }, random);
        break;
      }
      case 'ganymede': {
        TextureGen.paintPixels(width, height, (u, v) => {
          const direction = TextureGen.sphereDirection(u, v);
          const split = TextureGen.fbm3(direction[0] * 2.2 + 17.0, direction[1] * 2.2, direction[2] * 2.2, 4);
          const base = TextureGen.mix3([86, 82, 74], [164, 158, 148], split);
          return [base[0], base[1], base[2], 255];
        }, random);
        TextureGen.addCraters(context, width, height, 70, 0.04, { floor: [40, 38, 35], rim: [200, 196, 188] }, random);
        break;
      }
      case 'phobos':
      case 'deimos': {
        TextureGen.paintPixels(width, height, (u, v) => TextureGen.rocky(u, v, random, {
          dark: [96, 84, 72], light: [158, 146, 132], spotColor: [74, 62, 50]
        }), random);
        TextureGen.addCraters(context, width, height, 40, 0.06, { floor: [52, 44, 38], rim: [190, 180, 168] }, random);
        break;
      }
      case 'rhea':
      case 'titania':
      case 'oberon':
      case 'titan': {
        const params = bodyId === 'titan'
          ? { dark: [150, 100, 52], light: [214, 164, 96] }
          : { dark: [130, 124, 116], light: [206, 200, 192] };
        TextureGen.paintPixels(width, height, (u, v) => TextureGen.rocky(u, v, random, params), random);
        TextureGen.addCraters(context, width, height, bodyId === 'titan' ? 18 : 60, 0.045, { floor: [70, 64, 58], rim: [215, 210, 204] }, random);
        break;
      }
      case 'triton': {
        TextureGen.paintPixels(width, height, (u, v) => {
          const direction = TextureGen.sphereDirection(u, v);
          const mottle = TextureGen.fbm3(direction[0] * 4.6 + 47.0, direction[1] * 4.6, direction[2] * 4.6, 4);
          let color = TextureGen.mix3([212, 202, 190], [152, 140, 126], mottle);
          if (mottle > 0.63) { color = TextureGen.mix3(color, [104, 92, 78], (mottle - 0.63) * 3.1); }
          return [color[0], color[1], color[2], 255];
        }, random);
        break;
      }
      case 'venus':
        TextureGen.paintPixels(width, height, (u, v) => TextureGen.banded(u, v, random, {
          bands: 3.4, warp: 0.5, poleFade: 0.30, mottleStrength: 0.16, highlight: [255, 244, 214],
          palette: [[226, 206, 160], [244, 228, 190], [204, 178, 128], [236, 218, 178]]
        }), random);
        break;
      case 'earth':
        TextureGen.paintPixels(width, height, (u, v) => TextureGen.earthlike(u, v, random), random);
        break;
      case 'mars': {
        TextureGen.paintPixels(width, height, (u, v) => {
          const direction = TextureGen.sphereDirection(u, v);
          const dust = TextureGen.fbm3(direction[0] * 3.3 + 23.0, direction[1] * 3.3, direction[2] * 3.3, 5);
          const patches = TextureGen.fbm3(direction[0] * 1.4 + 61.0, direction[1] * 1.4, direction[2] * 1.4, 3);
          let color = TextureGen.mix3([122, 62, 34], [196, 116, 66], dust);
          color = TextureGen.mix3(color, [86, 44, 26], Math.max(0, patches - 0.52) * 1.9);
          /* Polar caps. */
          const latitude = Math.abs(v - 0.5) * 2;
          const cap = TextureGen.smooth(Math.min(Math.max(latitude - 0.90, 0) / 0.08, 1));
          color = TextureGen.mix3(color, [236, 232, 226], cap);
          return [color[0], color[1], color[2], 255];
        }, random);
        break;
      }
      case 'jupiter':
        TextureGen.paintPixels(width, height, (u, v) => TextureGen.banded(u, v, random, {
          bands: 6.5, warp: 0.42, poleFade: 0.5, mottleStrength: 0.10, highlight: [255, 250, 235],
          palette: [[206, 176, 134], [168, 128, 88], [228, 210, 178], [140, 104, 72], [198, 172, 140]],
          spot: { u: 0.68, v: 0.60, rx: 0.055, ry: 0.026, color: [178, 84, 50] }
        }), random);
        break;
      case 'saturn':
        TextureGen.paintPixels(width, height, (u, v) => TextureGen.banded(u, v, random, {
          bands: 5.2, warp: 0.36, poleFade: 0.55, mottleStrength: 0.07, highlight: [255, 250, 238],
          palette: [[224, 203, 162], [210, 184, 138], [240, 226, 190], [198, 172, 130]]
        }), random);
        break;
      case 'uranus':
        TextureGen.paintPixels(width, height, (u, v) => TextureGen.banded(u, v, random, {
          bands: 2.4, warp: 0.2, poleFade: 0.12, mottleStrength: 0.05, highlight: [235, 250, 252],
          palette: [[198, 226, 232], [186, 214, 222], [208, 232, 238]]
        }), random);
        break;
      case 'neptune':
        TextureGen.paintPixels(width, height, (u, v) => TextureGen.banded(u, v, random, {
          bands: 3.1, warp: 0.3, poleFade: 0.18, mottleStrength: 0.08, highlight: [210, 224, 255],
          palette: [[52, 88, 200], [40, 70, 176], [74, 112, 216]],
          spot: { u: 0.40, v: 0.58, rx: 0.03, ry: 0.02, color: [18, 30, 92] }
        }), random);
        break;
      default:
        throw new Error('No texture recipe for body: ' + bodyId);
    }
    return canvas;
  },

  /** Translucent swirling cloud layer for Earth (alpha only, white colour). */
  generateEarthClouds() {
    const random = TextureGen.mulberry32(90210);
    const width = 1024, height = 512;
    return TextureGen.paintPixels(width, height, (u, v) => {
      const direction = TextureGen.sphereDirection(u, v);
      const swirl = TextureGen.fbm3(direction[0] * 3.8 + 2.2, direction[1] * 3.8, direction[2] * 3.8, 3);
      const clump = TextureGen.fbm3(direction[0] * 7.5 + 14.0, direction[1] * 7.5, direction[2] * 7.5, 4);
      const mask = TextureGen.smooth(Math.min(Math.max(clump - 0.52, 0) * 2.6, 1)) * (0.55 + 0.45 * swirl);
      const alpha = Math.min(255, mask * 235);
      return [255, 255, 255, alpha];
    }, random);
  },

  /**
   * Saturn ring: 1024x2 canvas sampled at (r/1, 0.5) by the ring shader.
   * Real-ish structure: C, B, A rings, the Cassini division and a narrow F ring;
   * alpha is the ring opacity.
   */
  generateSaturnRing() {
    const width = 1024, height = 2;
    const random = TextureGen.mulberry32(77777);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const imageData = context.createImageData(width, height);
    const pixels = imageData.data;
    const gauss = (center, spread, peak) => peak * Math.exp(-Math.pow((width01 - center) / spread, 2));
    for (let column = 0; column < width; column += 1) {
      const r = column / (width - 1);
      const noise = TextureGen.fbm3(r * 24.0, 0.37, 7.7, 3);
      let alpha =
        gauss(0.28, 0.10, 0.42) + gauss(0.52, 0.11, 0.85) + gauss(0.78, 0.062, 0.92)
        + gauss(0.655, 0.014, 0.30) + gauss(0.905, 0.011, 0.42);
      alpha *= 0.55 + 0.45 * noise;
      /* Cassini division: a deep, sharp gap. */
      const gap = TextureGen.smooth(Math.min(Math.max((r - 0.415) / 0.022, 0) * 1, 1))
        * (1 - TextureGen.smooth(Math.min(Math.max((r - 0.500) / 0.028, 0) * 1, 1)));
      alpha *= 1 - gap * 0.93;
      const innerFade = TextureGen.smooth(Math.min(r / 0.05, 1));
      const outerFade = 1 - TextureGen.smooth(Math.min(Math.max((r - 0.965) / 0.03, 0), 1));
      const brightness = 0.78 + 0.22 * noise;
      const red = Math.min(255, 238 * brightness * innerFade * outerFade + 12);
      const green = Math.min(255, 228 * brightness * innerFade * outerFade + 10);
      const blue = Math.min(255, 208 * brightness * innerFade * outerFade + 8);
      for (let row = 0; row < height; row += 1) {
        const index = (row * width + column) * 4;
        pixels[index] = red;
        pixels[index + 1] = green;
        pixels[index + 2] = blue;
        pixels[index + 3] = Math.min(255, alpha * 235 * innerFade * outerFade);
      }
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  }
};
