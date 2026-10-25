
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
  viewProjection: mat4x4<f32>;   // P·V per frame (floats 96..111)
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
