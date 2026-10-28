/**
 * WebGPU rendering backend: SolarSystemRenderer (plan §2/§7/§8/§13).
 *
 * One-pass-per-layer, single command encoder per frame (§7.1):
 *   #0 star field fullscreen pass          no depth, opaque
 *   #1 orbit lines                         depth test on / write off, alpha
 *   #2 bodies: Sun → planets → moons, shared 64x48 sphere (3185 vertices)
 *   #3 Saturn rings                     depth test on / write off, alpha
 *   #4 corona billboard                    additive (ONE/ONE), test on
 *
 * Scene units are committed by solar-system.js; this file only turns
 * matrices + texture canvases into pipelines. Per-frame inputs arrive in a
 * frameState object; there is no second source of scene truth here.
 */

import { uploadCanvasAsTexture } from './textures.js';

// Visibility bitmasks for bind-group layout entries (WebIDL enum GPUShaderVisibility):
// vertex = 1, fragment = 2, compute = 4. Numeric values are used directly rather than
// the browser's global `GPUShaderVisibility` object, which is not present in all builds.
const VISIBILITY_VERTEX = 1;
const VISIBILITY_FRAGMENT = 2;
const VISIBILITY_VERTEX_FRAGMENT = VISIBILITY_VERTEX | VISIBILITY_FRAGMENT;

/* ============================ WGSL sources =========================== */


/** pBackgroundStars: fullscreen triangle; ndc → ray via camera basis + tan-fov. */
const GLOBAL_UNIFORMS_WGSL =`
struct Occluder { center: vec3<f32>, radius: f32 };
struct GlobalUniforms {
  cameraPosition: vec4<f32>,    // scene position, w = 1
  timeSeconds: f32,             // animated sim seconds (twinkle / corona drift)
  camForward: vec4<f32>,       // normalized scene axes from getCameraBasis()
  camRight: vec4<f32>,
  camUp: vec4<f32>,
  occluderCount: f32,          // always 10 (slots 0..8 sun+planets, slot 9 pad)
  occluders: array<Occluder, 16>,
  coronaCenter: vec4<f32>,    // xyz scene, w = live Sun displayRadius
  projectionParams: vec4<f32>,// x = tanX, y = tanY (from P), z aspect, w 0
  viewProjection: mat4x4<f32>,   // P·V per frame (floats 96..111)
};

/**
 * §7.3 analytic shadow: {1.0, 0.0} hard umbra. Light sits at scene origin;
 * an occluder blocks only while closer to the body than the light is and
 * inside its angular radius (cos(asin(r/d)) test).
 */
fn analyticShadowFactor(worldPos: vec3<f32>, selfIndex: f32, u: GlobalUniforms) -> f32 {
  let lightDistance = length(worldPos);
  var factor: f32 = 1.0;
  let count = u32(u.occluderCount);
  for (var i: u32 = 0u; i < count; i = i + 1u) {
    if (i == u32(selfIndex)) { continue; }              // body never self-occludes
    let ocl = u.occluders[i];
    let toOcl = ocl.center - worldPos;
    let d = length(toOcl);
    if (d >= lightDistance) { continue; }              // sun itself (==) / past the light
    let toLightDir = normalize(-worldPos);
    let sepCos = dot(toLightDir, normalize(toOcl));
    if (sepCos <= 0.0) { continue; }                  // occluder behind this body
    let s = ocl.radius / max(d, 0.001);
    if (sepCos >= sqrt(max(0.0, 1.0 - s * s))) { factor = 0.0; }
  }
  return factor;
}

fn starHash(c: vec3<f32>) -> f32 { let d = dot(c, vec3<f32>(127.1, 311.7, 74.7)); return fract(sin(d) * 43758.5453); }
`;

const SHADER_BACKGROUND_STARS =`${GLOBAL_UNIFORMS_WGSL}
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) ndcIn: vec2<f32>, };
@group(0) @binding(0) var<uniform> globalU: GlobalUniforms;
@vertex fn vs_main(@location(0) inNdc: vec2<f32>) -> VertexOut { return VertexOut(vec4<f32>(inNdc, 0.0, 1.0), inNdc); }
@fragment fn fs_main(@location(0) ndcIn: vec2<f32>) -> @location(0) vec4<f32> {
  let g = globalU;
  let dir = normalize(g.camForward.xyz + g.camRight.xyz * (ndcIn.x * g.projectionParams.x) + g.camUp.xyz * (ndcIn.y * g.projectionParams.y));
  var color = vec3<f32>(0.010, 0.016, 0.035);                          // deep-space base
  let bandN = normalize(vec3<f32>(0.42, 0.55, 0.72));                  // faint Milky Way band
  let t = abs(dot(dir, bandN));
  let band = exp(-t * t * 9.0) * 0.55 + exp(-t * t * 46.0) * 1.2;     // §7.1 milky-way hint
  color += vec3<f32>(0.055, 0.048, 0.062) * band;
  let cell = floor(dir * 48.0);
  let h = starHash(cell);
  if (h < 0.06) {                                                       // sparse dot field
    let seed = vec3<f32>(fract(h * 57.31), fract(h * 91.73), fract(h * 31.97));
    let anchor = (cell + seed - 0.5) / 48.0;
    let rAng = distance(dir, normalize(anchor));
    let b = smoothstep(0.006, 0.0, rAng);
    let twinkle = 0.55 + 0.45 * sin(g.timeSeconds * (0.6 + seed.x * 1.2) + h * 6.28318);
    let tint = mix(vec3<f32>(0.72, 0.79, 1.0), vec3<f32>(1.0, 0.93, 0.78), fract(h * 17.23));
    color += tint * b * (0.35 + 0.65 * seed.y) * twinkle;
  }
  return vec4<f32>(color, 1.0);
}
`;

/** pOrbitLines: line strip, uniform = {model mat4x4, color vec4}. */
const SHADER_ORBIT_LINES =`${GLOBAL_UNIFORMS_WGSL}
struct OrbitLineUniforms { model: mat4x4<f32>, color: vec4<f32>, };
@group(0) @binding(0) var<uniform> orbitU: OrbitLineUniforms;
@group(0) @binding(1) var<uniform> globalU: GlobalUniforms;
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32>, };
@vertex fn vs_main(@location(0) position: vec3<f32>) -> VertexOut {
  let world = orbitU.model * vec4<f32>(position.xyz, 1.0);
  return VertexOut(globalU.viewProjection * world, orbitU.color);
}
@fragment fn fs_main(in: VertexOut) -> @location(0) vec4<f32> { return in.color; }
`;

/** pSphereLit: Lambert + analytic umbra; ambient 0.05 blue per §7.7. */
const SHADER_SPHERE_LIT =`${GLOBAL_UNIFORMS_WGSL}
struct BodyUniforms { model: mat4x4<f32>, radius: f32, selfOccluderIndex: f32, };
@group(0) @binding(0) var<texture_2d<f32>> baseColorSampler;
@group(0) @binding(1) var<sampler> samplerBase;
@group(0) @binding(2) var<uniform> bodyU: BodyUniforms;
@group(0) @binding(3) var<uniform> globalU: GlobalUniforms;
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) worldPos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>, };
@vertex fn vs_main(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>) -> VertexOut {
  let worldPos = (bodyU.model * vec4<f32>(position, 1.0)).xyz;
  let nWorld = normalize((bodyU.model * vec4<f32>(normal, 0.0)).xyz);
  return VertexOut(globalU.viewProjection * vec4<f32>(worldPos, 1.0), worldPos, nWorld, uv);
}
@fragment fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let base = textureSample(baseColorSampler, samplerBase, in.uv);
  let n = normalize(in.normal);
  let lightDir = normalize(-in.worldPos);                        // light at scene origin (§7.7)
  let ndl = max(dot(n, lightDir), 0.0);
  let lit = analyticShadowFactor(in.worldPos, bodyU.selfOccluderIndex, globalU);
  let ambient = 0.05 * vec3<f32>(0.45, 0.52, 0.70);               // faint night side (§7.7)
  return vec4<f32>(base.rgb * (ambient + 0.95 * ndl * lit), 1.0);
}
`;

/** pSunEmissive: no shadow pass; rim boost per §7.4/§7.5 spec. */
const SHADER_SUN_EMISSIVE =`${GLOBAL_UNIFORMS_WGSL}
struct BodyUniforms { model: mat4x4<f32>, radius: f32, selfOccluderIndex: f32, };
@group(0) @binding(0) var<texture_2d<f32>> baseColorSampler;
@group(0) @binding(1) var<sampler> samplerBase;
@group(0) @binding(2) var<uniform> bodyU: BodyUniforms;
@group(0) @binding(3) var<uniform> globalU: GlobalUniforms;
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) worldPos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>, };
@vertex fn vs_main(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>) -> VertexOut {
  let worldPos = (bodyU.model * vec4<f32>(position, 1.0)).xyz;
  let nWorld = normalize((bodyU.model * vec4<f32>(normal, 0.0)).xyz);
  return VertexOut(globalU.viewProjection * vec4<f32>(worldPos, 1.0), worldPos, nWorld, uv);
}
@fragment fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let base = textureSample(baseColorSampler, samplerBase, in.uv);
  let n = normalize(in.normal);
  let vDir = normalize(globalU.cameraPosition.xyz - in.worldPos);
  let rim = pow(1.0 - abs(dot(n, vDir)), 2.0);
  return vec4<f32>(base.rgb * 1.5 + vec3<f32>(1.0, 0.82, 0.45) * rim * 1.05, 1.0);   // §7.4/§7.5
}
`;

/** pRings: two-sided (frontFacing flip), radial strip uv, alpha from canvas profile. */
const SHADER_RINGS =`${GLOBAL_UNIFORMS_WGSL}
struct BodyUniforms { model: mat4x4<f32>, radius: f32, selfOccluderIndex: f32, };
@group(0) @binding(0) var<texture_2d<f32>> baseColorSampler;
@group(0) @binding(1) var<sampler> samplerBase;
@group(0) @binding(2) var<uniform> bodyU: BodyUniforms;
@group(0) @binding(3) var<uniform> globalU: GlobalUniforms;
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) worldPos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>, };
@vertex fn vs_main(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>) -> VertexOut {
  let worldPos = (bodyU.model * vec4<f32>(position, 1.0)).xyz;
  let nWorld = normalize((bodyU.model * vec4<f32>(normal, 0.0)).xyz);
  return VertexOut(globalU.viewProjection * vec4<f32>(worldPos, 1.0), worldPos, nWorld, uv);
}
@fragment fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  var n = normalize(in.normal);
  if (!frontFacing()) { n = -n; }                    // two-sided (§7)
  let lit = analyticShadowFactor(in.worldPos, bodyU.selfOccluderIndex, globalU);
  let ndl = max(dot(n, normalize(-in.worldPos)), 0.0);
  let ring = textureSample(baseColorSampler, samplerBase, in.uv);   // radial strip profile
  let ambient = 0.10 * vec3<f32>(0.45, 0.52, 0.70);                 // faint night side (§7.7)
  return vec4<f32>(ring.rgb * (ambient + 0.95 * ndl * lit), ring.a);
}
`;

/** pCoronaBillboard: camera quad, §7.7 size = displayRadius × 4; warm two-octave falloff. */
const SHADER_CORONA =`${GLOBAL_UNIFORMS_WGSL}
struct CoronaUniforms { viewProjection: mat4x4<f32>, };
@group(0) @binding(0) var<uniform> globalU: GlobalUniforms;
@group(0) @binding(1) var<uniform> coronaU: CoronaUniforms;
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) corner: vec2<f32>, };
@vertex fn vs_main(@location(0) cornerIn: vec2<f32>) -> VertexOut {
  let scale = globalU.coronaCenter.w * 2.0;                        // half-extent = 2 × displayRadius
  let worldPos = globalU.coronaCenter.xyz + globalU.camRight.xyz * (cornerIn.x * scale) + globalU.camUp.xyz * (cornerIn.y * scale);
  return VertexOut(coronaU.viewProjection * vec4<f32>(worldPos, 1.0), cornerIn);
}
@fragment fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let r = length(in.corner);
  let fall = pow(clamp(1.0 - r, 0.0, 1.0), 3.0);                   // layered radial falloff (§7.7)
  let octaveA = starHash(vec3<f32>(in.corner * 9.0, globalU.timeSeconds * 0.25));
  let octaveB = starHash(vec3<f32>(in.corner * 4.0, 7.0 + globalU.timeSeconds * 0.11));
  let noise = mix(octaveA, octaveB, 0.5);                          // two drifting octaves
  let warm = vec3<f32>(1.0, 0.72, 0.38) + 0.25 * vec3<f32>(0.2, 0.09, 0.0) * (1.0 - fall);
  return vec4<f32>(warm * fall * noise * 2.2, 1.0);                // additive ONE/ONE
}
`;

/* ======================= Global uniform layout (§7) ======================= */

/** Float offsets into the 128-float global buffer (first 90 used). */
const GLOBAL_FLOAT_OFFSETS = Object.freeze({
  cameraPosition: 0, timeSeconds: 4, camForward: 8, camRight: 12, camUp: 16,
  occluderCount: 20, occluders: 24, coronaCenter: 88, projectionParams: 92, viewProjection: 96, totalFloats: 128,
});

/* ======================= SolarSystemRenderer ======================= */

const GLOBAL_BUFFER_FLOATS = 128;          // 512 B allocation (§7)
const BODY_UNIFORM_FLOATS = 18;            // {model mat4, radius, selfOccluderIndex} → 72 B rows
const ORBIT_UNIFORM_FLOATS = 20;           // {model mat4, color vec4, pad vec2} → 80 B
const SPHERE_LATITUDE_SEGMENTS = 48;       // 65x49 grid → 3185 vertices, 18432 uint32 indices (§7)
const SPHERE_LONGITUDE_SEGMENTS = 64;
const RING_RADIAL_SEGMENTS = 128;          // annulus [1.15, 2.3] × body radius, no index
const RING_INNER_RADIUS = 1.15;
const RING_OUTER_RADIUS = 2.3;
const ORBIT_ALPHA_PLANET = 0.55;           // §7 committed alphas (planet / moon)
const ORBIT_ALPHA_MOON = 0.35;
const RING_BODY_NAME = 'Saturn';
const TAU = Math.PI * 2;

/**
 * Convert a '#rrggbb' label color (constants.js) to [r, g, b] floats in 0..1.
 *
 * @param {string} hexColor - 6-digit hex, no alpha channel.
 * @returns {[number, number, number]} normalized rgb.
 */
function hexToRgbFloats(hexColor) {
  const value = parseInt(hexColor.slice(1), 16);
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

/** Write the four diagonal 1.0 floats of a column-major identity mat4.
 *
 * @param {Float32Array} target - Float32Array with at least 16 floats.
 * @returns {void}
 */
function setIdentityMat4(target) {
  target[0] = 1; target[5] = 1; target[10] = 1; target[15] = 1;
}

/**
 * WebGPU renderer for the committed scene (plan §6/§7): device, pipelines,
 * buffers, bind groups and the one-per-frame command pass.
 *
 * Scene truth lives in main.js/solar-system.js; this class turns a
 * frameContext into draws. Wiring order (main.js):
 *   1. `await renderer.initialize({ canvases, orbitDefinitions, onFatalError })`
 *      — device + texture uploads from the painted canvases (plan §6).
 *   2. `createSolarSystem(renderer.textureMap, (u) => renderer.writeOrbitVertices(u))`.
 *   3. `renderer.registerBodies(bodies)` — per-body buffers + bind groups.
 *   4. Every frame: `renderer.renderFrame(frameContext)` where
 *      frameContext = {globalUniformsData, bodyDrawList:[{modelMatrix, bindGroup,
 *      selfOccluderIndex}], orbitDrawList:[{modelMatrix, bindGroup}],
 *      ringDraw:{modelMatrix} | null, coronaDraw, cameraBasis}. `cameraBasis` and
 *      `coronaDraw` are accepted per §6 for completeness; the renderer reads
 *      occluders/camera from globalUniformsData and always draws the corona.
 */
export class SolarSystemRenderer {
  /**
   * @param {HTMLCanvasElement} canvasElement - presentation target for the scene.
   */
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.device = null;
    /** textureKey → GPUTexture; filled by initialize(), pass to createSolarSystem. */
    this.textureMap = Object.create(null);
    /** body name → GPUBindGroup (sphere pipeline); filled by registerBodies(). */
    this.bodyBindGroups = new Map();
    /** orbit/line name → GPUBindGroup; filled as vertex updates arrive. */
    this.orbitBindGroups = new Map();
    this._canvasContext = null;
    this._depthTexture = null;
    this._depthWidth = 0;
    this._depthHeight = 0;
    this._fatalErrorReported = false;
    this._orbitColorDefinitions = new Map(); // name → Float32Array [r,g,b,a]
    this._stateByBindGroup = new Map();      // bindGroup → {uniformBuffer, pipeline?, geometryBuffer?, vertexCount?}
    this._orbitStateByName = new Map();
    this._ringState = null;
  }

  /**
   * Create adapter/device, upload the painted canvases and build geometry,
   * buffers, pipelines and static bind groups (plan §7).
   *
   * @param {{
   *   canvases: {byTextureKey: Map<string, HTMLCanvasElement>, saturnRing: HTMLCanvasElement},
   *   orbitDefinitions: Array<{name: string, kind: 'planet'|'moon', color: string}>,
   *   onFatalError?: function(string)
   * }} options - canvases from textures.generateAllCanvases; one orbitDefinition
   *   per orbit line (color = labelColor hex; kind drives the §7 alpha);
   *   onFatalError takes a message for device-lost/validation overlays.
   * @returns {Promise<void>}
   */
  async initialize({ canvases, orbitDefinitions = [], onFatalError } = {}) {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      const message = 'No GPU adapter — WebGPU is unavailable on this machine.';
      console.error(message);
      if (onFatalError) onFatalError(message);
      throw new Error(message);
    }
    // No required features — the upload path is core-spec only (see textures.js).
    this.device = await adapter.requestDevice();

    this._fatalErrorReported = false;
    this.device.lost.then((reason) => {
      console.error('GPU device lost:', reason);
      if (onFatalError) onFatalError('GPU device lost — please reload the page.');
    });
    this.device.onSubmittedError = (error) => {
      if (!this._fatalErrorReported) {
        this._fatalErrorReported = true;
        console.error('WebGPU validation error:', error);
        if (onFatalError) onFatalError('A WebGPU validation error occurred — see the console.');
      }
    };

    const context = this.canvas.getContext('webgpu');
    if (!context) {
      const message = 'Could not create a WebGPU canvas context — please open in the latest Chrome or Edge.';
      console.error(message);
      if (onFatalError) onFatalError(message);
      throw new Error(message);
    }

    // Present-format discovery depends on the engine's spec level: newer engines
    // expose getPreferredCanvasFormat() (on the GPU object and/or adapter) while
    // older ones expose GPUCanvasContext.preferredFormats — probe the query first.
    let presentFormat = null;
    for (const owner of [navigator.gpu, adapter]) {
      if (!owner || typeof owner.getPreferredCanvasFormat !== 'function') continue;
      const picked = owner.getPreferredCanvasFormat();
      presentFormat = Array.isArray(picked) ? picked[0] : picked;
      break;
    }
    if (!presentFormat && Array.isArray(context.preferredFormats)) {
      for (const candidate of ['bgra8unorm', 'rgba8unorm']) {
        if (context.preferredFormats.includes(candidate)) { presentFormat = candidate; break; }
      }
    }
    if (!presentFormat) {
      const message = 'No compatible WebGPU canvas format found — please open in the latest Chrome or Edge.';
      console.error(message);
      if (onFatalError) onFatalError(message);
      throw new Error(message);
    }
    this._presentFormat = presentFormat;
    this._canvasContext = context;
    this._canvasContext.configure({ device: this.device, format: presentFormat });

    // Texture uploads (plan §6: canvases first, upload after the device exists).
    for (const [textureKey, paintedCanvas] of canvases.byTextureKey) {
      this.textureMap[textureKey] = await uploadCanvasAsTexture(this.device, paintedCanvas);
    }
    this._ringTexture = await uploadCanvasAsTexture(this.device, canvases.saturnRing);

    // §7: sampler(clamp, linear/linear), shared by every textured pipeline.
    this._sampler = this.device.createSampler({
      addressU: 'clamp-to-edge', addressV: 'clamp-to-edge', addressW: 'clamp-to-edge',
      magFilter: 'linear', minFilter: 'linear',
    });

    for (const definition of orbitDefinitions) {
      const [red, green, blue] = hexToRgbFloats(definition.color);
      const alpha = definition.kind === 'planet' ? ORBIT_ALPHA_PLANET : ORBIT_ALPHA_MOON;
      this._orbitColorDefinitions.set(definition.name, new Float32Array([red, green, blue, alpha]));
    }

    this.createGlobalBuffers();
    this.createSphereGeometry();
    this.createRingGeometry();
    this.createBillboardQuads();
    this.createPipelines();
    this.buildBindGroups(this.textureMap);
  }

  /** Allocate the 512 B global uniform buffer, corona micro-buffer and shared layouts. */
  createGlobalBuffers() {
    const device = this.device;
    this.globalUniformBuffer = device.createBuffer({
      size: GLOBAL_BUFFER_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Corona quad vertex stage reads its own tiny mat4 (§7: own tiny buffer allowed).
    this._coronaUniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this._globalBindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: VISIBILITY_VERTEX_FRAGMENT, buffer: { minBindingSize: GLOBAL_BUFFER_FLOATS * 4 } }],
    });
    this._coronaBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: VISIBILITY_VERTEX_FRAGMENT, buffer: { minBindingSize: GLOBAL_BUFFER_FLOATS * 4 } },
        { binding: 1, visibility: VISIBILITY_VERTEX, buffer: { minBindingSize: 64 } },
      ],
    });
  }

  /** Shared unit sphere: 65x49 interleaved pos/normal/uv vertices + uint32 index. */
  createSphereGeometry() {
    const device = this.device;
    const latitudeRows = SPHERE_LATITUDE_SEGMENTS + 1; // 49 rows
    const longitudeCols = SPHERE_LONGITUDE_SEGMENTS + 1; // 65 columns (seam repeats)
    const vertices = new Float32Array(latitudeRows * longitudeCols * 8);
    let cursor = 0;
    for (let row = 0; row < latitudeRows; row += 1) {
      const latitudeAngle = -Math.PI / 2 + row * (Math.PI / SPHERE_LATITUDE_SEGMENTS); // pole at +Y
      for (let col = 0; col < longitudeCols; col += 1) {
        const longitudeAngle = col * (TAU / SPHERE_LONGITUDE_SEGMENTS);
        vertices[cursor] = Math.cos(latitudeAngle) * Math.cos(longitudeAngle);       // x
        vertices[cursor + 1] = Math.sin(latitudeAngle);                              // y
        vertices[cursor + 2] = Math.cos(latitudeAngle) * Math.sin(longitudeAngle);   // z
        vertices[cursor + 3] = vertices[cursor];                                    // normal == position
        vertices[cursor + 4] = vertices[cursor + 1];
        vertices[cursor + 5] = vertices[cursor + 2];
        vertices[cursor + 6] = col / SPHERE_LONGITUDE_SEGMENTS;                    // u
        vertices[cursor + 7] = row / SPHERE_LATITUDE_SEGMENTS;                     // v (top tex = north)
        cursor += 8;
      }
    }
    this._sphereVertexBuffer = device.createBuffer({
      size: latitudeRows * longitudeCols * 32,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._sphereVertexBuffer, 0, vertices);

    this._sphereIndexCount = SPHERE_LATITUDE_SEGMENTS * SPHERE_LONGITUDE_SEGMENTS * 2 * 3; // 18432
    const indices = new Uint32Array(this._sphereIndexCount);
    let indexCursor = 0;
    for (let indexRow = 0; indexRow < SPHERE_LATITUDE_SEGMENTS; indexRow += 1) {
      for (let indexCol = 0; indexCol < SPHERE_LONGITUDE_SEGMENTS; indexCol += 1) {
        const topLeft = indexRow * longitudeCols + indexCol;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + longitudeCols;
        indices[indexCursor] = topLeft;
        indices[indexCursor + 1] = bottomLeft;
        indices[indexCursor + 2] = topRight;
        indices[indexCursor + 3] = bottomLeft;
        indices[indexCursor + 4] = topRight;
        indices[indexCursor + 5] = bottomLeft + 1;
        indexCursor += 6;
      }
    }
    this._sphereIndexBuffer = device.createBuffer({ size: this._sphereIndexCount * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this._sphereIndexBuffer, 0, indices);
  }

  /**
   * Saturn's rings as an indexed-free flat annulus in the body XZ plane
   * (§7): 128 radial segments, inner/outer radius [1.15, 2.3], uv.x = radial
   * fraction so the 256x8 strip texture samples by radius. Interleaved pos3+uv2.
   */
  createRingGeometry() {
    const device = this.device;
    const vertexCount = RING_RADIAL_SEGMENTS * 2 * 3; // two triangles per segment
    const vertices = new Float32Array(vertexCount * 5);
    let cursor = 0;
    for (let segment = 0; segment < RING_RADIAL_SEGMENTS; segment += 1) {
      const angleA = segment * (TAU / RING_RADIAL_SEGMENTS);
      const angleB = (segment + 1) * (TAU / RING_RADIAL_SEGMENTS);
      const cosA = Math.cos(angleA); const sinA = Math.sin(angleA);
      const cosB = Math.cos(angleB); const sinB = Math.sin(angleB);
      // Triangle A: innerA → outerA → innerB (ccw in XZ, culling off anyway).
      const writeVertex = (x, z, u) => {
        vertices[cursor] = x; vertices[cursor + 1] = 0; vertices[cursor + 2] = z;
        vertices[cursor + 3] = u; vertices[cursor + 4] = 0.5;
        cursor += 5;
      };
      writeVertex(cosA * RING_INNER_RADIUS, sinA * RING_INNER_RADIUS, 0);
      writeVertex(cosA * RING_OUTER_RADIUS, sinA * RING_OUTER_RADIUS, 1);
      writeVertex(cosB * RING_INNER_RADIUS, sinB * RING_INNER_RADIUS, 0);
      // Triangle B: outerA → outerB → innerB.
      writeVertex(cosA * RING_OUTER_RADIUS, sinA * RING_OUTER_RADIUS, 1);
      writeVertex(cosB * RING_OUTER_RADIUS, sinB * RING_OUTER_RADIUS, 1);
      writeVertex(cosB * RING_INNER_RADIUS, sinB * RING_INNER_RADIUS, 0);
    }
    this._ringVertexBuffer = device.createBuffer({
      size: vertexCount * 20,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._ringVertexBuffer, 0, vertices);
    this._ringVertexCount = vertexCount;
  }

  /** Corona quad (strip 4) + star-field fullscreen triangle, both in NDC space. */
  createBillboardQuads() {
    const device = this.device;
    const coronaCorners = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this._coronaVertexBuffer = device.createBuffer({ size: coronaCorners.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this._coronaVertexBuffer, 0, coronaCorners);
    // Three-vertex triangle covering the whole NDC plane (no overdraw).
    const backgroundTriangle = new Float32Array([-1, -1, 3, -1, -1, 3]);
    this._backgroundVertexBuffer = device.createBuffer({ size: backgroundTriangle.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this._backgroundVertexBuffer, 0, backgroundTriangle);
  }

  /** All six pipelines (plan §7): stars, orbit lines, sphere, sun, rings, corona. */
  createPipelines() {
    const device = this.device;
    const alphaBlend = { color: { src: 'src-alpha', dst: 'one-minus-src-alpha' }, alpha: { src: 'one', dst: 'one-minus-src-alpha' } };
    const sphereLayout = [{ arrayStride: 32, attributes: [
      { shaderLocation: 0, format: 'float32x3', offset: 0 }, { shaderLocation: 1, format: 'float32x3', offset: 12 }, { shaderLocation: 2, format: 'float32x2', offset: 24 },
    ] }];
    const orbitLayout = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, format: 'float32x3', offset: 0 }] }];
    const ringLayout = [{ arrayStride: 20, attributes: [
      { shaderLocation: 0, format: 'float32x3', offset: 0 }, { shaderLocation: 1, format: 'float32x2', offset: 12 },
    ] }];
    const quadLayout = [{ arrayStride: 8, attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }] }];
    const module = (label, code) => device.createShaderModule({ label, code });

    this._pipelines = {
      pBackgroundStars: device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: module('pBackgroundStars', SHADER_BACKGROUND_STARS), buffers: quadLayout, entryPoint: 'vs_main' },
        fragment: { module: module('pBackgroundStars', SHADER_BACKGROUND_STARS), entryPoint: 'fs_main', targets: [{ format: this._presentFormat }] },
      }),
      pOrbitLines: device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: module('pOrbitLines', SHADER_ORBIT_LINES), buffers: orbitLayout, entryPoint: 'vs_main' },
        fragment: { module: module('pOrbitLines', SHADER_ORBIT_LINES), entryPoint: 'fs_main', targets: [{ format: this._presentFormat, blend: alphaBlend }] },
        primitive: { topology: 'line-list' },
        depthStencil: { format: 'depth32float', comparison: 'less', depthWriteEnabled: false },
      }),
      pSphereLit: device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: module('pSphereLit', SHADER_SPHERE_LIT), buffers: sphereLayout, entryPoint: 'vs_main' },
        fragment: { module: module('pSphereLit', SHADER_SPHERE_LIT), entryPoint: 'fs_main', targets: [{ format: this._presentFormat }] },
        depthStencil: { format: 'depth32float', comparison: 'less', depthWriteEnabled: true },
      }),
      pSunEmissive: device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: module('pSunEmissive', SHADER_SUN_EMISSIVE), buffers: sphereLayout, entryPoint: 'vs_main' },
        fragment: { module: module('pSunEmissive', SHADER_SUN_EMISSIVE), entryPoint: 'fs_main', targets: [{ format: this._presentFormat }] },
        depthStencil: { format: 'depth32float', comparison: 'less', depthWriteEnabled: true },
      }),
      pRings: device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: module('pRings', SHADER_RINGS), buffers: ringLayout, entryPoint: 'vs_main' },
        fragment: { module: module('pRings', SHADER_RINGS), entryPoint: 'fs_main', targets: [{ format: this._presentFormat, blend: alphaBlend }] },
        depthStencil: { format: 'depth32float', comparison: 'less', depthWriteEnabled: false },
      }),
      pCoronaBillboard: device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: module('pCoronaBillboard', SHADER_CORONA), buffers: quadLayout, entryPoint: 'vs_main' },
        fragment: {
          module: module('pCoronaBillboard', SHADER_CORONA),
          entryPoint: 'fs_main',
          targets: [{ format: this._presentFormat, blend: {
            color: { src: 'one', dst: 'one' }, alpha: { src: 'one', dst: 'one' },
          } }],
        },
        depthStencil: { format: 'depth32float', comparison: 'less', depthWriteEnabled: false },
      }),
    };
  }

  /**
   * Shared bind-group layouts + the static singletons (background, corona).
   * Per-body/per-orbit groups are built in registerBodies/writeOrbitVertices.
   *
   * @param {Record<string, GPUTexture>} textureMap - validated to be non-empty.
   * @returns {void}
   */
  buildBindGroups(textureMap) {
    const device = this.device;
    if (Object.keys(textureMap).length === 0) throw new Error('buildBindGroups: no uploaded textures.');
    // texture+sampler+bodyU+globalU — shared by pSphereLit, pSunEmissive and pRings.
    this._texturedBindGroupLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: VISIBILITY_FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 1, visibility: VISIBILITY_FRAGMENT, sampler: { bindingType: 'filtering' } },
      { binding: 2, visibility: VISIBILITY_VERTEX_FRAGMENT, buffer: { minBindingSize: BODY_UNIFORM_FLOATS * 4 } },
      { binding: 3, visibility: VISIBILITY_VERTEX_FRAGMENT, buffer: { minBindingSize: GLOBAL_BUFFER_FLOATS * 4 } },
    ] });
    this._orbitBindGroupLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: VISIBILITY_VERTEX, buffer: { minBindingSize: ORBIT_UNIFORM_FLOATS * 4 } },
      { binding: 1, visibility: VISIBILITY_VERTEX_FRAGMENT, buffer: { minBindingSize: GLOBAL_BUFFER_FLOATS * 4 } },
    ] });
    this._globalBindGroup = device.createBindGroup({
      layout: this._globalBindGroupLayout,
      entries: [{ binding: 0, buffer: this.globalUniformBuffer }],
    });
    // viewProjection (floats 96..111) copied into the corona's own tiny mat4 buffer.
    this._coronaBindGroup = device.createBindGroup({
      layout: this._coronaBindGroupLayout,
      entries: [{ binding: 0, buffer: this.globalUniformBuffer }, { binding: 1, buffer: this._coronaUniformBuffer }],
    });
  }

  /**
   * Target of solar-system.js's onOrbitRebuild (plan §6): rebuild the GPU orbit
   * buffers from precomputed local vertices. Safe no-op before initialize().
   *
   * @param {Array<{name: string, vertices: Float32Array}>} orbitLineUpdates -
   *   one entry per orbit line; vertices = packed xyz triplets (closed loop).
   * @returns {void}
   */
  writeOrbitVertices(orbitLineUpdates) {
    if (!this.device || !Array.isArray(orbitLineUpdates)) return;
    const device = this.device;
    for (const update of orbitLineUpdates) {
      const color = this._orbitColorDefinitions.get(update.name);
      const uniforms = new Float32Array(ORBIT_UNIFORM_FLOATS);
      setIdentityMat4(uniforms);
      if (color) uniforms.set(color, 16); // floats 16..19 = orbitU.color
      const uniformBuffer = device.createBuffer({ size: ORBIT_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniformBuffer, 0, uniforms);
      const geometryBuffer = device.createBuffer({ size: update.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(geometryBuffer, 0, update.vertices);
      const bindGroup = device.createBindGroup({ layout: this._orbitBindGroupLayout, entries: [
        { binding: 0, buffer: uniformBuffer }, { binding: 1, buffer: this.globalUniformBuffer },
      ] });
      const previousState = this._orbitStateByName.get(update.name);
      if (previousState) { // scale rebuild (plan §4): free the replaced buffers
        previousState.geometryBuffer.destroy();
        previousState.uniformBuffer.destroy();
        this._stateByBindGroup.delete(previousState.bindGroup);
      }
      const state = { geometryBuffer, uniformBuffer, bindGroup, vertexCount: update.vertices.length / 3 };
      this._orbitStateByName.set(update.name, state);
      this.orbitBindGroups.set(update.name, bindGroup);
      this._stateByBindGroup.set(bindGroup, state);
    }
  }

  /**
   * Per-body uniform buffers + bind groups for every scene body; builds the
   * Saturn ring state when a body named 'Saturn' exists. Call once after
   * createSolarSystem (plan §6 wiring order).
   *
   * @param {Array<object>} bodies - solar-system.js bodies array.
   * @returns {void}
   */
  registerBodies(bodies) {
    if (!this.device) throw new Error('registerBodies before initialize.');
    const device = this.device;
    for (const body of bodies) {
      const texture = this.textureMap[body.textureName];
      if (!texture) throw new Error(`No uploaded texture for key '${body.textureName}'.`);
      const uniforms = new Float32Array(BODY_UNIFORM_FLOATS);
      setIdentityMat4(uniforms);
      uniforms[16] = body.displayRadius;       // radius
      uniforms[17] = body.occluderIndex;       // selfOccluderIndex
      const uniformBuffer = device.createBuffer({ size: BODY_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniformBuffer, 0, uniforms);
      const bindGroup = device.createBindGroup({ layout: this._texturedBindGroupLayout, entries: [
        { binding: 0, texture: { sampler: this._sampler, baseTexture: texture } },
        { binding: 1, sampler: this._sampler },
        { binding: 2, buffer: uniformBuffer },
        { binding: 3, buffer: this.globalUniformBuffer },
      ] });
      const pipeline = body.kind === 'sun' ? this._pipelines.pSunEmissive : this._pipelines.pSphereLit;
      this._stateByBindGroup.set(bindGroup, { uniformBuffer, pipeline });
      this.bodyBindGroups.set(body.name, bindGroup);
    }
    // Saturn ring: same textured layout, ring texture + its own model buffer.
    const saturnBody = bodies.find((body) => body.name === RING_BODY_NAME);
    if (saturnBody && this._ringTexture) {
      const uniforms = new Float32Array(BODY_UNIFORM_FLOATS);
      setIdentityMat4(uniforms);
      uniforms[16] = saturnBody.displayRadius;
      uniforms[17] = saturnBody.occluderIndex;
      const uniformBuffer = device.createBuffer({ size: BODY_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniformBuffer, 0, uniforms);
      const bindGroup = device.createBindGroup({ layout: this._texturedBindGroupLayout, entries: [
        { binding: 0, texture: { sampler: this._sampler, baseTexture: this._ringTexture } },
        { binding: 1, sampler: this._sampler },
        { binding: 2, buffer: uniformBuffer },
        { binding: 3, buffer: this.globalUniformBuffer },
      ] });
      this._ringState = { uniformBuffer, bindGroup };
    }
  }

  /**
   * One command encoder + one render pass per frame (plan §7): star field →
   * orbit lines → bodies (main orders Sun → planets → moons) → Saturn ring →
   * corona billboard. Per-frame cost: 128-float global write + one mat4 upload
   * per drawn orbit/body/ring.
   *
   * @param {object} frameContext - see class doc for the full shape.
   * @returns {void}
   */
  renderFrame(frameContext) {
    const device = this.device;
    if (!device || !this._canvasContext) throw new Error('renderFrame before initialize.');
    const currentTexture = this._canvasContext.getCurrentTexture();
    const width = currentTexture.width;
    const height = currentTexture.height;
    if (this._depthTexture && (width !== this._depthWidth || height !== this._depthHeight)) {
      this._depthTexture.destroy(); // canvas/swapchain size changed (§7)
      this._depthTexture = null;
    }
    if (!this._depthTexture) {
      this._depthTexture = device.createTexture({
        format: 'depth32float', dimension: '2d', size: [width, height],
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this._depthWidth = width;
      this._depthHeight = height;
    }

    const globalUniformsData = frameContext.globalUniformsData;
    const orbitDrawList = frameContext.orbitDrawList || [];
    const bodyDrawList = frameContext.bodyDrawList || [];
    device.queue.writeBuffer(this.globalUniformBuffer, 0, globalUniformsData);
    for (const entry of orbitDrawList) {
      const state = this._stateByBindGroup.get(entry.bindGroup);
      if (!state) throw new Error('orbitDrawList bindGroup was never built — check writeOrbitVertices wiring.');
      device.queue.writeBuffer(state.uniformBuffer, 0, entry.modelMatrix); // first 64 B: model
    }
    for (const entry of bodyDrawList) {
      const state = this._stateByBindGroup.get(entry.bindGroup);
      if (!state) throw new Error('bodyDrawList bindGroup was never built — check registerBodies wiring.');
      device.queue.writeBuffer(state.uniformBuffer, 0, entry.modelMatrix); // radius/selfIdx stay at 64..72
    }
    if (frameContext.ringDraw && this._ringState) {
      device.queue.writeBuffer(this._ringState.uniformBuffer, 0, frameContext.ringDraw.modelMatrix);
    }
    // viewProjection (floats 96..111) into the corona's tiny mat4 buffer.
    const viewProjectionFloats = globalUniformsData.subarray(GLOBAL_FLOAT_OFFSETS.viewProjection, GLOBAL_FLOAT_OFFSETS.viewProjection + 16);
    device.queue.writeBuffer(this._coronaUniformBuffer, 0, viewProjectionFloats);

    const commandBuffer = device.createCommandEncoder({});
    const pass = commandBuffer.beginRenderPass({
      colorAttachments: [{ view: currentTexture.view, loadAction: 'clear', clearValue: [0, 0, 0, 1], storeAction: 'store' }],
      depthAttachment: { view: this._depthTexture.view, loadAction: 'clear', clearValue: 1, storeAction: 'discard' },
    });
    pass.setViewport([0, 0, width, height]);

    // #0 star field: opaque, no depth test (first layer of the frame).
    pass.setPipeline(this._pipelines.pBackgroundStars);
    pass.setBindGroup(0, this._globalBindGroup);
    pass.setVertexBuffer(0, this._backgroundVertexBuffer);
    pass.draw(3);

    // #1 orbit lines (planets → moons per main's list order).
    pass.setPipeline(this._pipelines.pOrbitLines);
    for (const entry of orbitDrawList) {
      const state = this._stateByBindGroup.get(entry.bindGroup);
      pass.setBindGroup(0, entry.bindGroup);
      pass.setVertexBuffer(0, state.geometryBuffer);
      pass.draw(state.vertexCount); // line-list: segments+1 loop vertices
    }

    // #2 bodies: main orders Sun → planets → moons; shared sphere mesh.
    for (const entry of bodyDrawList) {
      const state = this._stateByBindGroup.get(entry.bindGroup);
      pass.setPipeline(state.pipeline);
      pass.setBindGroup(0, entry.bindGroup);
      pass.setVertexBuffer(0, this._sphereVertexBuffer);
      pass.setIndexBuffer(this._sphereIndexBuffer, 'uint32');
      pass.drawIndexed(this._sphereIndexCount);
    }

    // #3 Saturn ring (alpha blend, depth test on / write off).
    if (frameContext.ringDraw && this._ringState) {
      pass.setPipeline(this._pipelines.pRings);
      pass.setBindGroup(0, this._ringState.bindGroup);
      pass.setVertexBuffer(0, this._ringVertexBuffer);
      pass.draw(this._ringVertexCount);
    }

    // #4 corona billboard (additive ONE/ONE; visibility via globalU.coronaCenter).
    pass.setPipeline(this._pipelines.pCoronaBillboard);
    pass.setBindGroup(0, this._coronaBindGroup);
    pass.setVertexBuffer(0, this._coronaVertexBuffer);
    pass.draw(4); // triangle-strip default topology

    pass.end();
    device.submit([commandBuffer]);
  }
}
