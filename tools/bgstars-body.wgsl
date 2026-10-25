
struct VertexOut { @builtin(position) position: vec2<f32>; @location(0) ndcIn: vec2<f32>; };
@group(0) @binding(0) var<uniform> globalU: GlobalUniforms;
@vertex fn vs_main(@location(0) inNdc: vec2<f32>) -> VertexOut { return VertexOut(inNdc, inNdc); }
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