/**
 * WebGPU rendering backend: SolarSystemRenderer (plan §2/§7/§8/§13).
 *
 * One-pass-per-layer, single command encoder per frame (§7.1):
 *   #0 star field fullscreen pass          no depth, opaque
 *   #1 orbit lines                         depth test on / write off, alpha
 *   #2 bodies: Sun → planets (+ rings) → moons, indexed 32x18-ish spheres
 *   #3 corona billboard                    additive (ONE/ONE), test on
 *
 * Scene units are committed by solar-system.js; this file only turns
 * matrices + texture canvases into pipelines. Per-frame inputs arrive in a
 * frameState object; there is no second source of scene truth here.
 */

/* ============================ WGSL sources =========================== */

/** Shared uniform layout preamble (JS writes a 128-float buffer; see renderFrame). */
const GLOBAL_UNIFORMS_WGSL = `
struct Occluder { center: vec3<f32>; radius: f32 };
struct GlobalUniforms {
  cameraPosition: vec4<f32>;    // scene position, w = 1
  timeSeconds: f32;             // animated sim seconds (twinkle / corona drift)
  camForward: vec4<f32>;       // normalized scene axes from getCameraBasis()
  camRight: vec4<f32>;
  camUp: vec4<f32>;
  occluderCount: f32;          // always 10 (slots 0..8 sun+planets, slot 9 pad)
  occluders: array<Occluder, 16>;
  coronaCenter: vec4<f32>;    // xyz scene, w = live Sun displayRadius
  projectionParams: vec4<f32>;// x = tanX, y = tanY (from P), z aspect, w 0
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
    if (i == u32(selfIndex)) continue;              // body never self-occludes
    let ocl = u.occluders[i];
    let toOcl = ocl.center - worldPos;
    let d = length(toOcl);
    if (d >= lightDistance) continue;              // sun itself (==) / past the light
    let toLightDir = normalize(-worldPos);
    let sepCos = dot(toLightDir, normalize(toOcl));
    if (sepCos <= 0.0) continue;                  // occluder behind this body
    let s = ocl.radius / max(d, 0.001);
    if (sepCos >= sqrt(max(0.0, 1.0 - s * s))) { factor = 0.0; }
  }
  return factor;
}

fn starHash(c: vec3<f32>) -> f32 { let d = dot(c, vec3<f32>(127.1, 311.7, 74.7)); return fract(sin(d) * 43758.5453); }
`;

/** pBackgroundStars: fullscreen triangle; ndc → ray via camera basis + tan-fov. */
const SHADER_BACKGROUND_STARS = `${GLOBAL_UNIFORMS_WGSL}
struct VertexOut { @builtin(position) position: vec2<f32>; @location(0) ndcIn: vec2<f32>; };
@group(0) @binding(0) var<uniform> globalU: GlobalUniforms;
@vertex fn vs_main(inNdc: vec2<f32>) -> VertexOut { return VertexOut(inNdc, inNdc); }
@fragment fn fs_main(@location(0) ndcIn: vec2<f32>) -> @location(0) vec4<f32> {
  let g = globalU;
  let dir = normalize(g.camForward + g.camRight * (ndcIn.x * g.projectionParams.x) + g.camUp * (ndcIn.y * g.projectionParams.y));
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
const SHADER_ORBIT_LINES = `
struct OrbitLineUniforms { model: mat4x4<f32>; color: vec4<f32>; };
@group(0) @binding(0) var<uniform> orbitU: OrbitLineUniforms;
struct VertexOut { @builtin(position) position: vec4<f32>; @location(0) color: vec4<f32>; };
@vertex fn vs_main(@location(0) position: vec3<f32>) -> VertexOut { return VertexOut(orbitU.model * vec4<f32>(position, 1.0), orbitU.color); }
@fragment fn fs_main(in: VertexOut) -> @location(0) vec4<f32> { return in.color; }
`;

/** pSphereLit: Lambert + analytic umbra; ambient 0.05 blue per §7.7. */
const SHADER_SPHERE_LIT = `${GLOBAL_UNIFORMS_WGSL}
struct BodyUniforms {{ model: mat4x4<f32>; radius: f32; selfOccluderIndex: f32; }};
@group(0) @binding(0) var<uniform> baseColorSampler: texture_2d<f32>;
@group(0) @binding(1) var samplerBase: sampler;
@group(0) @binding(2) var<uniform> bodyU: BodyUniforms;
@group(0) @binding(3) var<uniform> globalU: GlobalUniforms;
struct VertexOut {{ @builtin(position) position: vec4<f32>; @location(0) worldPos: vec3<f32>; @location(1) normal: vec3<f32>; @location(2) uv: vec2<f32>; }};
@vertex fn vs_main(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>) -> VertexOut {{
  let clip = bodyU.model * vec4<f32>(position, 1.0);
  return VertexOut(clip, (bodyU.model * vec4<f32>(position, 1.0)).xyz, normal, uv);
}}
@fragment fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {{
  let base = textureSample(baseColorSampler, samplerBase, in.uv);
  let n = normalize(in.normal);
  let lightDir = normalize(-in.worldPos);                        // light at scene origin (§7.7)
  let ndl = max(dot(n, lightDir), 0.0);
  let lit = analyticShadowFactor(in.worldPos, bodyU.selfOccluderIndex, globalU);
  let ambient = 0.05 * vec3<f32>(0.45, 0.52, 0.70);               // faint night side (§7.7)
  return vec4<f32>(base.rgb * (ambient + 0.95 * ndl * lit), 1.0);
}}
`;

/** pSunEmissive: no shadow pass; rim boost per §7.4/§7.5 spec. */
const SHADER_SUN_EMISSIVE = `${GLOBAL_UNIFORMS_WGSL}
struct BodyUniforms {{ model: mat4x4<f32>; radius: f32; selfOccluderIndex: f32; }};
@group(0) @binding(0) var<uniform> baseColorSampler: texture_2d<f32>;
@group(0) @binding(1) var samplerBase: sampler;
@group(0) @binding(2) var<uniform> bodyU: BodyUniforms;
@group(0) @binding(3) var<uniform> globalU: GlobalUniforms;
struct VertexOut {{ @builtin(position) position: vec4<f32>; @location(0) worldPos: vec3<f32>; @location(1) normal: vec3<f32>; @location(2) uv: vec2<f32>; }};
@vertex fn vs_main(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>) -> VertexOut {{
  let clip = bodyU.model * vec4<f32>(position, 1.0);
  return VertexOut(clip, (bodyU.model * vec4<f32>(position, 1.0)).xyz, normal, uv);
}}
@fragment fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {{
  let base = textureSample(baseColorSampler, samplerBase, in.uv);
  let n = normalize(in.normal);
  let vDir = normalize(globalU.cameraPosition.xyz - in.worldPos);
  let rim = pow(1.0 - abs(dot(n, vDir)), 2.0);
  return vec4<f32>(base.rgb * 1.5 + vec3<f32>(1.0, 0.82, 0.45) * rim * 1.05, 1.0);   // §7.4/§7.5
}}
`;

/** pRings: two-sided (frontFacing flip), radial strip uv, alpha from canvas profile. */
const SHADER_RINGS = `${GLOBAL_UNIFORMS_WGSL}
struct BodyUniforms {{ model: mat4x4<f32>; radius: f32; selfOccluderIndex: f32; }};
@group(0) @binding(0) var<uniform> baseColorSampler: texture_2d<f32>;
@group(0) @binding(1) var samplerBase: sampler;
@group(0) @binding(2) var<uniform> bodyU: BodyUniforms;
@group(0) @binding(3) var<uniform> globalU: GlobalUniforms;
struct VertexOut {{ @builtin(position) position: vec4<f32>; @location(0) worldPos: vec3<f32>; @location(1) normal: vec3<f32>; @location(2) uv: vec2<f32>; }};
@vertex fn vs_main(@location(0) position: vec3<f32>, @location(1) normal: v
