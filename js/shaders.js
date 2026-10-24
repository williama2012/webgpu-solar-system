/* shaders.js
 * All WGSL sources plus plain (device-independent) pipeline layout specs.
 * Uniform layouts (in floats, WebGPU's 8/16-byte alignment rules respected):
 *   FrameUniforms  (144 B): viewProjection[0..15] camPos[16..18] sunPos[20..22]
 *                            camRight[24..26] camUp[28..30] time[32] aspect[34] tanHalfFov[35]
 *   BodyUniforms   (112 B): worldMatrix[0..15] bodyPos[16..18] bodyRadius[19]
 *                            rimColor[20..22] rimPower[23] specStrength[24]
 *   GlowUniforms   ( 48 B): worldPos[0..2] scale[3] color[6..8] intensity[9] time[10]
 *   LineUniforms   ( 24 B): color[0..2] alpha[3]
 *   StarUniforms   ( 56 B): rightScaled[0..2] upScaled[3..5] forward[8..10] time[13]
 */

const ShaderSource = {
  /** Hash / value-noise / fbm, shared by the starfield, sun and corona shaders. */
  noisePreamble: `
    fn starHash(p : vec3<f32>) -> f32 {
      return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
    }

    fn valueNoise3(p : vec3<f32>) -> f32 {
      let lattice = vec3<f32>(floor(p));
      let weight = p - lattice;
      weight = weight * weight * (3.0 - 2.0 * weight);
      let c000 = starHash(lattice);
      let c100 = starHash(lattice + vec3<f32>(1.0, 0.0, 0.0));
      let c010 = starHash(lattice + vec3<f32>(0.0, 1.0, 0.0));
      let c110 = starHash(lattice + vec3<f32>(1.0, 1.0, 0.0));
      let c001 = starHash(lattice + vec3<f32>(0.0, 0.0, 1.0));
      let c101 = starHash(lattice + vec3<f32>(1.0, 0.0, 1.0));
      let c011 = starHash(lattice + vec3<f32>(0.0, 1.0, 1.0));
      let c111 = starHash(lattice + vec3<f32>(1.0, 1.0, 1.0));
      let x01 = mix(c000, c100, weight.x);
      let x11 = mix(c010, c110, weight.x);
      let x02 = mix(c001, c101, weight.x);
      let x12 = mix(c011, c111, weight.x);
      let y01 = mix(x01, x11, weight.y);
      let y02 = mix(x02, x12, weight.y);
      return mix(y01, y02, weight.z);
    }

    fn fbm3(p : vec3<f32>) -> f32 {
      var total = 0.0;
      var amplitude = 0.5;
      var signal = p;
      for (var octave = 0; octave < 4; octave = octave + 1) {
        total += valueNoise3(signal) * amplitude;
        signal = signal * 2.03;
        amplitude *= 0.5;
      }
      return total;
    }
  `,

  /* ---------------- full-screen procedural starfield ---------------- */

  star: {
    vertex: `
      struct StarVertex { @location(0) corner : vec2<f32>; }
      struct StarVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) nearNdc : vec2<f32>;
      }
      @vertex
      fn vsStar(inputs : StarVertex) -> StarVaryings {
        var out : StarVaryings;
        out.clip = vec4<f32>(inputs.corner, 0.0, 1.0);
        out.nearNdc = vec2<f32>(inputs.corner.x, -inputs.corner.y);
        return out;
      }
    `,
    fragment: `
      ${'' /* noise preamble concatenated at build time */}
      struct StarUniforms {
        rightScaled : vec3<f32>,
        upScaled : vec3<f32>,
        forward : vec3<f32>,
        time : f32,
      }
      @group(0) @binding(0) var<uniform> uStar : StarUniforms;

      /* One cellular hash layer of stars; returns 0 when the cell is empty. */
      fn starLayer(direction : vec3<f32>, scale : f32, threshold : f32, size : f32) -> vec4<f32> {
        let cell = direction * scale;
        let lattice = floor(cell);
        let local = cell - lattice;
        let h = starHash(vec3<f32>(lattice));
        if (h < threshold) {
          let center = vec3<f32>(fract(h * 7.13), fract(h * 3.77), fract(h * 5.91)) * 0.6 + 0.2;
          let distance = length(local - center);
          let twinkle = 0.85 + 0.15 * sin(uStar.time * (1.2 + h * 2.4) + h * 17.0);
          let brightness = exp(-distance * distance * size) * (0.30 + 0.70 * fract(h * 13.7)) * twinkle;
          let tint = mix(vec3<f32>(1.0, 0.92, 0.80), vec3<f32>(0.72, 0.84, 1.0), fract(h * 5.31));
          return vec4<f32>(tint * brightness, brightness);
        }
        return vec4<f32>(0.0);
      }

      @fragment
      fn fsStar(input : StarVaryings) -> @location(0) vec4<f32> {
        let direction = normalize(uStar.forward
          + uStar.rightScaled * input.nearNdc.x
          + uStar.upScaled * input.nearNdc.y);
        /* Faint deep-space floor plus a milky-way dust band. */
        let bandAxis = normalize(vec3<f32>(0.35, 0.62, 0.71));
        let band = exp(-pow(dot(direction, bandAxis) * 3.4, 2.0));
        let dust = fbm3(direction * 5.0 + vec3<f32>(7.3, 2.1, 4.4));
        let milky = band * (0.30 + 0.70 * dust);
        var color = mix(vec3<f32>(0.010, 0.014, 0.028), vec3<f32>(0.09, 0.10, 0.14), milky * 0.55);
        /* Three density layers keep the sky busy without banding. */
        color = color + starLayer(direction, 24.0, 0.985, 9.0).rgb;
        color = color + starLayer(direction, 42.0, 0.982, 13.0).rgb;
        color = color + starLayer(direction, 74.0, 0.976, 18.0).rgb;
        return vec4<f32>(color, 1.0);
      }
    `,
    layoutSpec: [[{ uniform: 'star' }]],
    pipeline: { depthTest: false, depthWrite: false, cull: 'none', blending: 'opaque' }
  },

  /* ---------------- planets, moons and the cloud layer ---------------- */

  planet: {
    vertex: `
      struct SphereVertex {
        @location(0) position : vec3<f32>;
        @location(1) normal : vec3<f32>;
        @location(2) uv : vec2<f32>;
      }
      struct BodyUniforms {
        worldMatrix : mat4x4<f32>,
        bodyPosition : vec3<f32>,
        bodyRadius : f32,
        rimColor : vec3<f32>,
        rimPower : f32,
        specStrength : f32,
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      struct PlanetVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) worldPosition : vec3<f32>;
        @location(1) worldNormal : vec3<f32>;
        @location(2) uv : vec2<f32>;
      }
      @group(0) @binding(0) var<uniform> uBody : BodyUniforms;
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @vertex
      fn vsPlanet(inputs : SphereVertex) -> PlanetVaryings {
        var out : PlanetVaryings;
        var world = vec4<f32>(inputs.position, 1.0);
        out.worldPosition = (uBody.worldMatrix * world).xyz;
        out.worldNormal = mat3x3<f32>(uBody.worldMatrix) * inputs.normal;
        out.uv = inputs.uv;
        out.clip = uFrame.viewProjection * world;
        return out;
      }
    `,
    fragment: `
      struct PlanetVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) worldPosition : vec3<f32>;
        @location(1) worldNormal : vec3<f32>;
        @location(2) uv : vec2<f32>;
      }
      struct BodyUniforms {
        worldMatrix : mat4x4<f32>,
        bodyPosition : vec3<f32>,
        bodyRadius : f32,
        rimColor : vec3<f32>,
        rimPower : f32,
        specStrength : f32,
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      @group(0) @binding(0) var<uniform> uBody : BodyUniforms;
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @group(0) @binding(1) var uSampler : sampler;
      @group(0) @binding(2) var uSurface : texture_2d<f32>;
      @fragment
      fn fsPlanet(input : PlanetVaryings) -> @location(0) vec4<f32> {
        let worldNormal = normalize(input.worldNormal);
        let viewDirection = normalize(uFrame.cameraPosition - input.worldPosition);
        let lightDirection = normalize(uFrame.sunPosition - input.worldPosition);
        let surface = textureSample(uSurface, uSampler, input.uv);
        let dayLight = clamp(dot(worldNormal, lightDirection), 0.0, 1.0);
        var color = surface.rgb * (0.045 + 1.12 * dayLight);
        /* Water / ice glint: texture alpha is the specular mask. */
        let specular = pow(clamp(dot(reflect(-lightDirection, worldNormal), viewDirection), 0.0, 1.0), 26.0)
          * surface.a * uBody.specStrength;
        color = color + vec3<f32>(1.0, 0.96, 0.85) * specular * dayLight;
        /* Thin atmosphere rim, brighter on the lit side. */
        let rim = pow(1.0 - clamp(dot(worldNormal, viewDirection), 0.0, 1.0), uBody.rimPower);
        color = color + uBody.rimColor * rim * (0.22 + 0.78 * dayLight);
        return vec4<f32>(color, 1.0);
      }
    `,
    layoutSpec: [[{ uniform: 'body' }, { sampler: true }, { texture: true }], [{ uniform: 'frame' }]],
    pipeline: { depthTest: true, depthWrite: true, cull: 'back', blending: 'opaque' }
  },

  cloud: {
    vertex: `
      struct SphereVertex {
        @location(0) position : vec3<f32>;
        @location(1) normal : vec3<f32>;
        @location(2) uv : vec2<f32>;
      }
      struct BodyUniforms {
        worldMatrix : mat4x4<f32>,
        bodyPosition : vec3<f32>,
        bodyRadius : f32,
        rimColor : vec3<f32>,
        rimPower : f32,
        specStrength : f32,
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      struct PlanetVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) worldPosition : vec3<f32>;
        @location(1) worldNormal : vec3<f32>;
        @location(2) uv : vec2<f32>;
      }
      @group(0) @binding(0) var<uniform> uBody : BodyUniforms;
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @vertex
      fn vsCloud(inputs : SphereVertex) -> PlanetVaryings {
        var out : PlanetVaryings;
        var world = vec4<f32>(inputs.position, 1.0);
        out.worldPosition = (uBody.worldMatrix * world).xyz;
        out.worldNormal = mat3x3<f32>(uBody.worldMatrix) * inputs.normal;
        out.uv = inputs.uv;
        out.clip = uFrame.viewProjection * world;
        return out;
      }
    `,
    fragment: `
      struct PlanetVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) worldPosition : vec3<f32>;
        @location(1) worldNormal : vec3<f32>;
        @location(2) uv : vec2<f32>;
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      @group(0) @binding(0) var uSampler : sampler;
      @group(0) @binding(1) var uClouds : texture_2d<f32>;
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @fragment
      fn fsCloud(input : PlanetVaryings) -> @location(0) vec4<f32> {
        let worldNormal = normalize(input.worldNormal);
        let lightDirection = normalize(uFrame.sunPosition - input.worldPosition);
        let dayLight = clamp(dot(worldNormal, lightDirection), 0.0, 1.0);
        let cloud = textureSample(uClouds, uSampler, input.uv);
        let alpha = cloud.a * (0.10 + 0.90 * dayLight);
        return vec4<f32>(vec3<f32>(1.0), alpha);
      }
    `,
    layoutSpec: [[{ sampler: true }, { texture: true }], [{ uniform: 'frame' }]],
    pipeline: {
      depthTest: true, depthWrite: false, cull: 'back',
      blending: { color: ['src-alpha', 'one-minus-src-alpha'], alpha: ['one', 'one-minus-src-alpha'] }
    }
  },

  /* ---------------- the Sun sphere ---------------- */

  sun: {
    vertex: `
      struct SphereVertex {
        @location(0) position : vec3<f32>;
        @location(1) normal : vec3<f32>;
        @location(2) uv : vec2<f32>;
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      struct SunVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) worldPosition : vec3<f32>;
        @location(1) worldNormal : vec3<f32>;
      }
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @vertex
      fn vsSun(inputs : SphereVertex) -> SunVaryings {
        var out : SunVaryings;
        let world = vec4<f32>(inputs.position, 1.0);
        out.worldPosition = world.xyz;                 /* Sun is at the origin, unit mesh scaled by body uniform unused here */
        out.worldNormal = inputs.normal;
        out.clip = uFrame.viewProjection * world;
        return out;
      }
    `,
    fragment: `
      ${'' /* noise */}
      struct SunVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) worldPosition : vec3<f32>;
        @location(1) worldNormal : vec3<f32>;
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @fragment
      fn fsSun(input : SunVaryings) -> @location(0) vec4<f32> {
        let viewDirection = normalize(uFrame.cameraPosition - input.worldPosition);
        let facing = clamp(dot(normalize(input.worldNormal), viewDirection), 0.0, 1.0);
        /* Granulation: two scrolling fbm layers. */
        let grain = fbm3(normalize(input.worldNormal) * 9.0 + vec3<f32>(0.0, 0.0, uFrame.time * 0.035));
        let grainFine = fbm3(normalize(input.worldNormal) * 26.0 - vec3<f32>(0.0, uFrame.time * 0.06, 0.0));
        let base = mix(vec3<f32>(1.0, 0.98, 0.90), vec3<f32>(1.0, 0.68, 0.30), pow(1.0 - facing, 1.35));
        let surge = 0.80 + 0.30 * (grain - 0.5) * 2.0 + 0.18 * (grainFine - 0.5) * 2.0;
        let color = base * clamp(surge, 0.55, 1.45) + vec3<f32>(1.0, 0.85, 0.55) * pow(1.0 - facing, 3.0) * 0.55;
        return vec4<f32>(color, 1.0);
      }
    `,
    layoutSpec: [[], [{ uniform: 'frame' }]],
    pipeline: { depthTest: true, depthWrite: true, cull: 'back', blending: 'opaque' }
  },

  /* ---------------- corona / halo billboards (additive) ---------------- */

  glow: {
    vertex: `
      struct CornerVertex { @location(0) corner : vec2<f32>; }
      struct GlowUniforms {
        worldPosition : vec3<f32>,
        scale : f32,
        color : vec3<f32>,
        intensity : f32,
        time : f32,
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      struct GlowVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) corner : vec2<f32>;
      }
      @group(0) @binding(0) var<uniform> uGlow : GlowUniforms;
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @vertex
      fn vsGlow(inputs : CornerVertex) -> GlowVaryings {
        var out : GlowVaryings;
        /* Camera-facing billboard centred on the Sun. */
        let center = uGlow.worldPosition;
        let offset = uFrame.cameraRight * (inputs.corner.x * uGlow.scale)
                   + uFrame.cameraUp * (inputs.corner.y * uGlow.scale);
        out.clip = uFrame.viewProjection * vec4<f32>(center + offset, 1.0);
        out.corner = inputs.corner;
        return out;
      }
    `,
    fragment: `
      ${'' /* noise */}
      struct GlowVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) corner : vec2<f32>;
      }
      struct GlowUniforms {
        worldPosition : vec3<f32>,
        scale : f32,
        color : vec3<f32>,
        intensity : f32,
        time : f32,
      }
      @group(0) @binding(0) var<uniform> uGlow : GlowUniforms;
      @fragment
      fn fsGlow(input : GlowVaryings) -> @location(0) vec4<f32> {
        let r = length(input.corner);
        /* Turbulent corona: fbm along a stretched UV, drifting slowly. */
        let turbulence = fbm3(vec3<f32>(input.corner * 2.6, uGlow.time * 0.045));
        let core = exp(-4.1 * r * r);
        let outer = 0.20 * exp(-1.45 * r);
        let fadeEdge = 1.0 - smoothstep(0.86, 1.0, r);
        let brightness = (core + outer) * (0.80 + 0.42 * turbulence) * uGlow.intensity * fadeEdge;
        return vec4<f32>(uGlow.color * brightness, brightness);
      }
    `,
    layoutSpec: [[{ uniform: 'glow' }], [{ uniform: 'frame' }]],
    pipeline: {
      depthTest: true, depthWrite: false, cull: 'none',
      blending: { color: ['one', 'one'], alpha: ['one', 'zero'] }
    }
  },

  /* ---------------- Saturn's rings ---------------- */

  ring: {
    vertex: `
      struct SphereVertex {
        @location(0) position : vec3<f32>;
        @location(1) normal : vec3<f32>;
        @location(2) uv : vec2<f32>;
      }
      struct BodyUniforms {
        worldMatrix : mat4x4<f32>,
        bodyPosition : vec3<f32>,
        bodyRadius : f32,
        rimColor : vec3<f32>,
        rimPower : f32,
        specStrength : f32,
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      struct RingVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) worldPosition : vec3<f32>;
        @location(1) worldNormal : vec3<f32>;
        @location(2) radialUv : f32;
      }
      @group(0) @binding(0) var<uniform> uBody : BodyUniforms;
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @vertex
      fn vsRing(inputs : SphereVertex) -> RingVaryings {
        var out : RingVaryings;
        let world = vec4<f32>(inputs.position, 1.0);
        out.worldPosition = (uBody.worldMatrix * world).xyz;
        out.worldNormal = mat3x3<f32>(uBody.worldMatrix) * inputs.normal;
        out.radialUv = inputs.uv.x;
        out.clip = uFrame.viewProjection * world;
        return out;
      }
    `,
    fragment: `
      struct RingVaryings {
        @builtin(position) clip : vec4<f32>;
        @location(0) worldPosition : vec3<f32>;
        @location(1) worldNormal : vec3<f32>;
        @location(2) radialUv : f32;
      }
      struct BodyUniforms {
        worldMatrix : mat4x4<f32>,
        bodyPosition : vec3<f32>,
        bodyRadius : f32,
        rimColor : vec3<f32>,
        rimPower : f32,
        specStrength : f32,
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      @group(0) @binding(0) var<uniform> uBody : BodyUniforms;
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @group(0) @binding(1) var uSampler : sampler;
      @group(0) @binding(2) var uRing : texture_2d<f32>;
      @fragment
      fn fsRing(input : RingVaryings) -> @location(0) vec4<f32> {
        let worldNormal = normalize(input.worldNormal);
        let toSun = uFrame.sunPosition - input.worldPosition;
        let sunUnit = normalize(toSun);
        let facingLight = abs(dot(worldNormal, sunUnit));
        /* The planet's shadow: a soft cylinder behind the planet. */
        let toPlanet = uBody.bodyPosition - input.worldPosition;
        let planetUnit = normalize(toPlanet);
        let onShadowSide = smoothstep(0.0, 0.35, dot(planetUnit, sunUnit));
        let perpendicular = length(cross(sunUnit, planetUnit)) * length(toPlanet);
        let shadow = (1.0 - smoothstep(uBody.bodyRadius * 0.90, uBody.bodyRadius * 1.10, perpendicular)) * onShadowSide;
        let texel = textureSample(uRing, uSampler, vec2<f32>(input.radialUv, 0.5));
        let brightness = (0.16 + 0.95 * facingLight) * (1.0 - 0.88 * shadow);
        return vec4<f32>(texel.rgb * brightness, texel.a);
      }
    `,
    layoutSpec: [[{ uniform: 'body' }, { sampler: true }, { texture: true }], [{ uniform: 'frame' }]],
    pipeline: {
      depthTest: true, depthWrite: false, cull: 'none',
      blending: { color: ['src-alpha', 'one-minus-src-alpha'], alpha: ['one', 'one-minus-src-alpha'] }
    }
  },

  /* ---------------- orbital path lines ---------------- */

  line: {
    vertex: `
      struct LineVertex { @location(0) position : vec3<f32>; }
      struct BodyUniforms {
        worldMatrix : mat4x4<f32>,
        bodyPosition : vec3<f32>,
        bodyRadius : f32,
        rimColor : vec3<f32>,
        rimPower : f32,
        specStrength : f32,
      }
      struct FrameUniforms {
        viewProjection : mat4x4<f32>,
        cameraPosition : vec3<f32>,
        sunPosition : vec3<f32>,
        cameraRight : vec3<f32>,
        cameraUp : vec3<f32>,
        time : f32,
        aspect : f32,
        tanHalfFov : f32,
      }
      @group(0) @binding(0) var<uniform> uBody : BodyUniforms;
      @group(1) @binding(0) var<uniform> uFrame : FrameUniforms;
      @vertex
      fn vsLine(inputs : LineVertex) -> @builtin(position) vec4<f32> {
        return uFrame.viewProjection * uBody.worldMatrix * vec4<f32>(inputs.position, 1.0);
      }
    `,
    fragment: `
      struct LineUniforms { color : vec3<f32>, alpha : f32 }
      @group(2) @binding(0) var<uniform> uLine : LineUniforms;
      @fragment
      fn fsLine() -> @location(0) vec4<f32> {
        return vec4<f32>(uLine.color, uLine.alpha);
      }
    `,
    layoutSpec: [[{ uniform: 'body' }], [{ uniform: 'frame' }], [{ uniform: 'line' }]],
    pipeline: {
      depthTest: true, depthWrite: false, cull: 'none',
      blending: { color: ['one', 'one'], alpha: ['one', 'zero'] }
    }
  }
};