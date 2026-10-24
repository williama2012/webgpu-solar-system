/* scene.js
 * The WebGPU renderer. Builds every GPU resource once (Scene.build) and then per frame:
 *   Scene.update(tDays)  → re-solves the whole system, writes uniforms
 *   Scene.render(camera) → draws starfield, orbit lines, sun, bodies, rings, clouds, glow
 *   Scene.pick(...)     → ray/sphere picking for click-to-focus
 * Scaling policy (see the notes in index.html): 1 AU = 20 scene units; planet radii to
 * scale; moon radii at 0.55x and moon orbit radii compressed onto a gentle power law so
 * everything stays on screen while preserving relative structure.
 */

const Scene = {
  AU_UNITS: 20,               /* scene units per astronomical unit          */
  SUN_RADIUS: 5.0,            /* the Sun is compressed from 109x Earth (see notes) */
  PLANET_RADIUS_SCALE: 1 / 6371,                 /* Earth radius → exactly 1 unit  */
  MOON_RADIUS_SCALE: 0.55 / 6371,

  canvas: null, context: null, device: null,
  frameBuffer: null, frameArray: new Float32Array(36),
  realSeconds: 0,
  bodies: {},                  /* id → body record                           */
  drawOrder: [],               /* body ids in draw order                     */
  glowQuads: [],               /* corona + halo billboard descriptors        */
  orbitLines: [],              /* { matrix, positions, color, alpha }        */
  pipelines: {},
  starTriangle: null,
  cloudExtra: null,            /* { body, mesh } for Earth                  */
  ringExtra: null,            /* { body, mesh } for Saturn                 */
  sphereMesh: null,            /* shared GPU buffers for every sphere        */
  lastAspect: 1,
  lastTanHalfFov: 0,

  /* ---------------- device + pipeline creation ---------------- */

  async init(canvas) {
    this.canvas = canvas;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { return false; }
    this.device = await adapter.requestDevice({ requiredFeatures: [], requiredLimits: { maxTextureDimension2D: 2048 } });
    this.device.lost.then(() => { document.getElementById('nogl').textContent = 'WebGPU device lost — reload the page.'; });
    this.context = canvas.getContext('webgpu');
    this.context.configure({ device: this.device, format: 'bgra8unorm', alphaMode: 'opaque' });

    this.frameBuffer = this.device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM_RENDER | GPUBufferUsage.COPY_DST });

    /* One shared UV sphere for every body: 96x64 is plenty for close-ups. */
    const meshData = Geometry.createSphere(96, 64);
    this.sphereMesh = {
      positions: this.makeBuffer(meshData.positions, GPUBufferUsage.VERTEX),
      normals: this.makeBuffer(meshData.normals, GPUBufferUsage.VERTEX),
      uvs: this.makeBuffer(meshData.uvs, GPUBufferUsage.VERTEX),
      indices: this.makeBuffer(meshData.indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST),
      vertexCount: meshData.positions.length / 3,
      indexCount: meshData.indices.length
    };

    for (const pipelineName of Object.keys(ShaderSource)) {
      const shader = ShaderSource[pipelineName];
      const bindGroupLayouts = shader.layoutSpec.map((groupSpec, groupIndex) =>
        this.device.createBindGroupLayout({
          entries: groupSpec.map((bindingSpec, bindingIndex) => {
            if (bindingSpec.uniform) {
              return this.device.createBindGroupLayoutEntry({ binding: bindingIndex, visibility: GPUConstantVisibility.FRAGMENT, buffer: { type: 'uniform' } });
            }
            if (bindingSpec.sampler) {
              return this.device.createBindGroupLayoutEntry({ binding: bindingIndex, visibility: GPUConstantVisibility.FRAGMENT, sampler: { type: 'filtering' } });
            }
            return this.device.createBindGroupLayoutEntry({ binding: bindingIndex, visibility: GPUConstantVisibility.FRAGMENT, texture: { sampleType: 'float' } });
          })
        }));

      const pipelineSpec = shader.pipeline || {};
      this.pipelines[pipelineName] = this.device.createPipeline({
        layout: this.device.createRenderPipelineLayout({ bindGroupLayouts }),
        vertex: {
          module: this.device.createShaderModule({ code: shader.vertex }),
          buffers: [pipelineName === 'line' || pipelineName === 'star' ? [{ arrayStride: 8, attributes: [{ format: 'float32x2', offset: 0 }] }]
            : [{ arrayStride: 32, attributes: [{ format: 'float32x3', offset: 0 }, { format: 'float32x3', offset: 12 }, { format: 'float32x2', offset: 24 }] }],
          entryPoint: ''
        },
        fragment: {
          module: this.device.createShaderModule({ code: pipelineName === 'star' ? this.assembleStarFragment() : shader.fragment }),
          targets: [{ format: 'bgra8unorm', blend: this.blendSpec(pipelineSpec) }]
        },
        primitive: {
          topology: pipelineName === 'line' ? 'line-list' : (pipelineName === 'glow' ? 'triangle-strip' : 'triangle-list'),
          cullMode: pipelineSpec.cull ? pipelineSpec.cull : 'none'
        },
        depthStencil: {
          format: 'depth32float',
          depthWriteEnabled: pipelineSpec.depthWrite !== false,
          depthCompare: 'less'
        }
      });

      /* Entry points: WGSL allows empty entryPoint to mean "match by name" only in
         newer versions — be explicit-safe by leaving '' and relying on the
         vs fs naming; if the driver complains, set entryPoint to the first
         '@vertex'/'@fragment' function name from the source. */
    }

    /* Full-screen triangle (starfield) and glow quad vertex buffers. */
    const trianglePositions = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const triangleIndices = new Uint32Array([0, 1, 2]);
    this.starTriangle = {
      positions: this.makeBuffer(trianglePositions, GPUBufferUsage.VERTEX),
      indices: this.makeBuffer(triangleIndices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST)
    };
    this.glowQuad = this.makeBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), GPUBufferUsage.VERTEX);
    this.emptyIndex = this.makeBuffer(new Uint32Array([]), GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);
    return true;
  },

  makeBuffer(array, usage) {
    return this.device.createBuffer({ size: array.byteLength, usage, mappedAtCreation: true }).then ?
      this.device.createBuffer({ size: array.byteLength, usage, mappedAtCreation: true }) : null;
  },

  /* Fill a mappedAtCreation buffer (helper used for static data). */
  uploadStatic(buffer, array) {
    const view = buffer.getMappedRange();
    new Uint8Array(view).set(new Uint8Array(array.buffer));
    buffer.unmap();
    return buffer;
  },

  blendSpec(pipelineSpec) {
    const spec = pipelineSpec.blending;
    if (!spec || spec === 'opaque') { return null; }
    if (spec === 'additive') {
      return { color: ['one', 'one'], alpha: ['one', 'zero'] };
    }
    return { color: ['src-alpha', 'one-minus-src-alpha'], alpha: ['one', 'one-minus-src-alpha'] };
  },

  /* The star fragment is assembled from the noise preamble + the star code. */
  assembleStarFragment() {
    return ShaderSource.noisePreamble + ShaderSource.star.fragment
      .replace('${\'\' /* noise preamble concatenated at build time */}', '');
  },

  /* ---------------- build (textures + body records) ---------------- */

  async build(reportProgress) {
    const allBodies = [SolarData.sun, ...SolarData.planets, ...SolarData.moons];
    let done = 0;
    const step = () => {
      done += 1;
      reportProgress(done / (allBodies.length + 2));
    };

    for (const body of allBodies) {
      if (body.id !== 'sun') {
        const canvas = TextureGen.forBodyId(body.id);
        await this.uploadCanvas(canvas);
      }
      step();
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    }

    const cloudCanvas = TextureGen.generateEarthClouds();
    await this.uploadCanvas(cloudCanvas);
    step();
    const ringCanvas = TextureGen.generateSaturnRing();
    await this.uploadCanvas(ringCanvas);
    step();

    this.buildBodies();
    this.drawOrder = ['sun'].concat(
      SolarData.planets.map((planet) => planet.id).concat(
        SolarData.moons.map((moon) => moon.id)));
  },

  async uploadCanvas(canvas) {
    const texture = this.device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture });
    return texture;
  },

  makeSampler() {
    return this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressU: 'repeat', addressV: 'repeat' });
  },

  /* ---------------- scene-unit sizing ---------------- */

  planetRadiusUnits(planet) { return planet.radiusKm * this.PLANET_RADIUS_SCALE; },
  moonRadiusUnits(moon) { return Math.max(0.12, moon.radiusKm * this.MOON_RADIUS_SCALE); },

  /*
   * Moon orbit radii: real distances (in parent radii) are huge for the Moon (60x) and
   * tiny in absolute terms for Mars's moons, so they are remapped with
   *   orbit = max(2.25 x R_parent, 1.15 x R_parent x (d/6)^0.42)
   * then a minimum gap is enforced per parent, and Rhea is pushed clear of the rings.
   * The *periods* stay 100% real, so relative motion is honest at every time scale.
   */
  computeMoonOrbits() {
    for (const planet of SolarData.planets) {
      const parentRadius = this.planetRadiusUnits(planet);
      const children = SolarData.moons.filter((moon) => moon.parentId === planet.id);
      children.sort((a, b) => a.distanceInPlanetRadii - b.distanceInPlanetRadii);
      let previousOrbit = parentRadius * 2.25;
      for (const moon of children) {
        const raw = Math.max(parentRadius * 2.25, parentRadius * 1.15 * Math.pow(moon.distanceInPlanetRadii / 6, 0.42));
        moon.orbitRadius = Math.max(previousOrbit + 0.4, raw);
        previousOrbit = moon.orbitRadius;
      }
    }
    /* Rhea must clear the outer edge of the ring system. */
    const rhea = SolarData.moons.find((moon) => moon.id === 'rhea');
    const saturn = this.bodies.saturn;
    if (rhea && saturn) { rhea.orbitRadius = Math.max(rhea.orbitRadius, saturn.radius * 1.55 + 1.3); }
  },

  buildBodies() {
    this.computeMoonOrbits();

    for (const body of [SolarData.sun, ...SolarData.planets, ...SolarData.moons]) {
      const isSun = body.id === 'sun';
      const isPlanet = SolarData.planets.includes(body);
      const radius = isSun ? this.SUN_RADIUS : (isPlanet ? this.planetRadiusUnits(body) : this.moonRadiusUnits(body));
      const texture = body.id === 'sun' ? null : this.textures[body.id];
      const record = {
        data: body,
        id: body.id,
        radius,
        position: [0, 0, 0],
        spinAngle: Math.random() * 6.28,
        axialTilt: (body.axialTiltDeg || 0) * Math.PI / 180,
        worldMatrix: new Float32Array(16),
        bodyUniform: null,          /* filled below */
        rimColor: this.rimFor(body),
        specStrength: this.specFor(body),
        labelColor: body.labelColor || '#cfd6ff'
      };
      record.bodyUniform = this.device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM_RENDER | GPUBufferUsage.COPY_DST });
      this.bodies[body.id] = record;
      this.uniformArrays[body.id] = new Float32Array(28);
    }

    /* Orbit lines: planet ellipses (static, world-space) and moon circles
       (pre-tilted circle, translated by the parent every frame). */
    for (const planet of SolarData.planets) {
      const record = this.bodies[planet.id];
      const aUnits = planet.semiMajorAxisAU * this.AU_UNITS;
      const pathPoints = OrbitMech.generateOrbitPath(planet, aUnits, 256);
      const line = {
        bodyId: planet.id,
        positions: this.makeBuffer(pathPoints, GPUBufferUsage.VERTEX),
        vertexCount: pathPoints.length / 3,
        matrix: new Float32Array(16).fill(0),
        color: planet.lineColor || [0.55, 0.62, 0.85],
        alpha: 0.20
      };
      line.matrix[0] = 1; line.matrix[5] = 1; line.matrix[10] = 1; line.matrix[15] = 1;
      this.orbitLines.push(line);
    }
    for (const moon of SolarData.moons) {
      const record = this.bodies[moon.id];
      const parent = this.bodies[moon.parentId];
      const tilt = parent.axialTilt;
      const circles = this.tiltedCircle(moon.orbitRadius, 128, tilt);
      record.orbitLine = {
        bodyId: moon.id,
        positions: this.makeBuffer(circles, GPUBufferUsage.VERTEX),
        vertexCount: circles.length / 3,
        matrix: new Float32Array(16),
        color: [0.75, 0.78, 0.95],
        alpha: 0.14
      };
      this.orbitLines.push(record.orbitLine);
    }

    /* Saturn's ring annulus (inner 1.25 R, outer 1.55 R) hangs off Saturn's matrix. */
    const saturn = this.bodies.saturn;
    const annulus = Geometry.createAnnulus(saturn.radius * 1.25, saturn.radius * 1.55, 128);
    this.ringExtra = {
      body: saturn,
      mesh: {
        positions: this.makeBuffer(annulus.positions, GPUBufferUsage.VERTEX),
        normals: this.makeBuffer(annulus.normals, GPUBufferUsage.VERTEX),
        uvs: this.makeBuffer(annulus.uvs, GPUBufferUsage.VERTEX),
        indices: this.makeBuffer(annulus.indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST),
        vertexCount: annulus.positions.length / 3,
        indexCount: annulus.indices.length
      }
    };

    /* Earth's translucent cloud shell at 1.015 R. */
    const earth = this.bodies.earth;
    const sphere = Geometry.createSphere(96, 64);
    this.cloudExtra = {
      body: earth,
      mesh: {
        positions: this.makeBuffer(sphere.positions.map((x, i) => x * 1.015), GPUBufferUsage.VERTEX),
        normals: this.makeBuffer(sphere.normals, GPUBufferUsage.VERTEX),
        uvs: this.makeBuffer(sphere.uvs, GPUBufferUsage.VERTEX),
        indices: this.makeBuffer(sphere.indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST),
        vertexCount: sphere.positions.length / 3,
        indexCount: sphere.indices.length
      }
    };

    /* Sun glow billboards: tight turbulent corona + wide soft halo. */
    this.glowQuads = [
      { color: [1.0, 0.83, 0.55], scale: this.SUN_RADIUS * 3.1, intensity: 1.0 },
      { color: [1.0, 0.70, 0.38], scale: this.SUN_RADIUS * 6.4, intensity: 0.5 }
    ];
  },

  /* A circle of `segments` points, pre-rotated into the parent's tilted frame. */
  tiltedCircle(radius, segments, tilt) {
    const out = new Float32Array(segments * 3);
    const c = Math.cos(tilt); const s = Math.sin(tilt);
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * OrbitMech.TWO_PI;
      const localX = Math.cos(angle) * radius;
      const localZ = Math.sin(angle) * radius;
      out[segment * 3] = localX;
      out[segment * 3 + 1] = -localZ * s;
      out[segment * 3 + 2] = localZ * c;
    }
    return out;
  },

  rimFor(body) {
    const rims = {
      mercury: [0.62, 0.58, 0.55], venus: [1.0, 0.88, 0.62], earth: [0.32, 0.55, 1.0],
      mars: [1.0, 0.5, 0.32], jupiter: [0.9, 0.8, 0.62], saturn: [0.95, 0.87, 0.66],
      uranus: [0.5, 0.88, 1.0], neptune: [0.38, 0.52, 1.0], moon: [0.7, 0.7, 0.72],
      io: [0.95, 0.8, 0.4], europa: [0.85, 0.88, 1.0], ganymede: [0.75, 0.72, 0.68],
      callisto: [0.7, 0.68, 0.65], phobos: [0.6, 0.55, 0.5], deimos: [0.6, 0.55, 0.5],
      rhea: [0.75, 0.78, 0.85], titan: [1.0, 0.72, 0.42], titania: [0.78, 0.85, 0.9],
      oberon: [0.78, 0.85, 0.9], triton: [0.8, 0.85, 0.95]
    };
    return rims[body.id] || [0.8, 0.8, 0.85];
  },
  specFor(body) {
    return body.id === 'earth' ? 0.95 : (body.id === 'titan' ? 0.12 : (body.id === 'europa' ? 0.3 : 0.15));
  },

  /* ---------------- per-frame update ---------------- */

  update(tDays) {
    for (const planet of SolarData.planets) {
      const record = this.bodies[planet.id];
      const position = OrbitMech.planetWorldPosition(planet, planet.semiMajorAxisAU * this.AU_UNITS, tDays);
      record.position = position;
      /* Visible spin: real periods, but planets rotate ~10-100x slower than the
         camera can track — so we show the *phase* of the spin and note it in the popup. */
      record.spinAngle = (OrbitMech.TWO_PI * tDays / (planet.rotationPeriodDays || 1)) % OrbitMech.TWO_PI;
    }
    for (const moon of SolarData.moons) {
      const record = this.bodies[moon.id];
      const parent = this.bodies[moon.parentId];
      const local = OrbitMech.moonLocalPosition(moon, moon.orbitRadius, tDays);
      const tilt = parent.axialTilt;
      const c = Math.cos(tilt); const s = Math.sin(tilt);
      record.position = [
        parent.position[0] + local[0],
        parent.position[1] - local[2] * s,
        parent.position[2] + local[2] * c
      ];
      record.spinAngle = (OrbitMech.TWO_PI * tDays / (moon.orbitalPeriodDays || 1)) % OrbitMech.TWO_PI;
    }
    this.bodies.sun.spinAngle = (OrbitMech.TWO_PI * tDays / 25.4) % OrbitMech.TWO_PI;

    for (const bodyId of this.drawOrder) {
      this.writeWorldMatrix(this.bodies[bodyId]);
      this.device.queue.writeBuffer(this.bodies[bodyId].bodyUniform, 0, this.uniformArrays[bodyId]);
    }
  },

  writeWorldMatrix(record) {
    const r = record.radius;
    const spin = record.spinAngle;
    const tilt = record.axialTilt;
    const cs = Math.cos(spin), ss = Math.sin(spin);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    /* M = T * Rx(tilt) * Ry(spin) * S — see the derivation comment in camera.js
       (same layout) — first 12 floats carry the rotation, ×r into scale. */
    const m = record.worldMatrix;
    const ryRows = [ [ct, 0, st], [cs + ss * st, cs, -ss * ct], [ss - cs * st, ss, cs * ct] ];
    for (let column = 0; column < 3; column += 1) {
      for (let row = 0; row < 3; row += 1) { m[column * 4 + row] = ryRows[row][column] * r; }
      m[column * 4 + 3] = 0;
    }
    m[12] = record.position[0]; m[13] = record.position[1]; m[14] = record.position[2]; m[15] = 1;

    const u = this.uniformArrays[record.id];
    u.set(record.worldMatrix, 0);
    u[16] = record.position[0]; u[17] = record.position[1]; u[18] = record.position[2];
    u[19] = record.radius;
    u[20] = record.rimColor[0]; u[21] = record.rimColor[1]; u[22] = record.rimColor[2];
    u[23] = 4.5; u[24] = record.specStrength;
  },

  /* ---------------- render ---------------- */

  render(camera) {
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const aspect = canvasWidth / Math.max(1, canvasHeight);
    const tanHalfFov = Math.tan((camera.fovDegrees * Math.PI / 180) / 2);

    /* Frame uniforms (144 B) — layout documented at the top of shaders.js. */
    const f = this.frameArray;
    f.set(camera.viewProjectionMatrix, 0);
    f[16] = camera.position[0]; f[17] = camera.position[1]; f[18] = camera.position[2];
    f[20] = 0; f[21] = 0; f[22] = 0;                              /* sun at origin */
    f[24] = camera.right[0]; f[25] = camera.right[1]; f[26] = camera.right[2];
    f[28] = camera.up[0]; f[29] = camera.up[1]; f[30] = camera.up[2];
    f[32] = this.realSeconds;
    f[34] = aspect; f[35] = tanHalfFov;
    this.device.queue.writeBuffer(this.frameBuffer, 0, f);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachment0: {
        view: this.context.getCurrentTexture().createView(),
        loadValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store'
      },
      depthStencilAttachment: {
        view: this.depthView,
        loadValue: { depth: 1, stencil: 0 },
        storeOp: 'discard'
      }
    });

    /* 1 — procedural starfield (full-screen triangle, no depth). */
    pass.setPipeline(this.pipelines.star);
    const starUniforms = new Float32Array(14);
    starUniforms[0] = camera.right[0] * tanHalfFov * aspect;
    starUniforms[1] = camera.right[1] * tanHalfFov * aspect;
    starUniforms[2] = camera.right[2] * tanHalfFov * aspect;
    starUniforms[3] = camera.up[0] * tanHalfFov; starUniforms[4] = camera.up[1] * tanHalfFov; starUniforms[5] = camera.up[2] * tanHalfFov;
    starUniforms[6] = camera.forward[0]; starUniforms[7] = camera.forward[1]; starUniforms[8] = camera.forward[2];
    starUniforms[10] = this.realSeconds;
    this.device.queue.writeBuffer(this.starUniformBuffer, 0, starUniforms);
    pass.setBindGroup(0, this.starGroup);
    pass.setVertexBuffer(0, this.starTriangle.positions);
    pass.setIndexBuffer(this.starTriangle.indices, 0, 3);
    pass.drawIndexed(3);

    /* 2 — orbit lines first so opaque bodies can occlude them. */
    pass.setPipeline(this.pipelines.line);
    for (const line of this.orbitLines) {
      const uLine = new Float32Array(6);
      uLine[0] = line.color[0]; uLine[1] = line.color[1]; uLine[2] = line.color[2]; uLine[3] = line.alpha;
      this.lineBuffers[line.bodyId].matrix = line.matrix;
      pass.setBindGroup(0, this.lineGroups[line.bodyId].bodies);
      pass.setBindGroup(1, this.frameBindGroup('line'));
      pass.setBindGroup(2, this.lineGroups[line.bodyId].line);
      pass.setVertexBuffer(0, line.positions);
      pass.draw(line.vertexCount);
    }

    /* 3 — Sun. */
    this.drawBodyPass('sun');

    /* 4 — every planet + moon. */
    for (const planet of SolarData.planets) { this.drawBodyPass(planet.id); }
    for (const moon of SolarData.moons) { this.drawBodyPass(moon.id); }

    /* 5 — Saturn's rings (depth-tested against the planet, no depth write). */
    this.drawRingPass();

    /* 6 — Earth's clouds. */
    this.drawCloudPass();

    /* 7 — glow billboards, last. */
    for (const quad of this.glowQuads) { this.drawGlowPass(quad); }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  },

  drawBodyPass(bodyId) {
    const record = this.bodies[bodyId];
    const pipelineName = bodyId === 'sun' ? 'sun' : 'planet';
    this.passSetPipeline(pipelineName);
    this.passSetVertexBuffer(0, this.sphereMesh.positions);
    this.passSetVertexBuffer(1, this.sphereMesh.normals);
    this.passSetVertexBuffer(2, this.sphereMesh.uvs);
    this.passSetIndexBuffer();
    this.passDraw(this.sphereMesh.indexCount);
  },

  drawRingPass() {
    this.passSetPipeline('ring');
    const mesh = this.ringExtra.mesh;
    this.passSetVertexBuffer(0, mesh.positions);
    this.passSetVertexBuffer(1, mesh.normals);
    this.passSetVertexBuffer(2, mesh.uvs);
    this.passSetIndexBuffer();
    this.passDraw(mesh.indexCount);
  },

  drawCloudPass() {
    this.passSetPipeline('cloud');
    const mesh = this.cloudExtra.mesh;
    this.passSetVertexBuffer(0, mesh.positions);
    this.passSetVertexBuffer(1, mesh.normals);
    this.passSetVertexBuffer(2, mesh.uvs);
    this.passSetIndexBuffer();
    this.passDraw(mesh.indexCount);
  },

  drawGlowPass(quad) {
    this.passSetPipeline('glow');
    const uniforms = new Float32Array(11);
    uniforms[0] = 0; uniforms[1] = 0; uniforms[2] = 0;
    uniforms[3] = quad.scale;
    uniforms[6] = quad.color[0]; uniforms[7] = quad.color[1]; uniforms[8] = quad.color[2];
    uniforms[9] = quad.intensity;
    uniforms[10] = this.realSeconds;
    this.passSetVertexBuffer(0, this.glowQuad);
    this.passDraw(4);
  },

  /* (Thin wrappers around the render-pass handles — kept so the draw code above
     reads like a recipe. Replace with direct pass.* calls if you prefer.) */
  passSetPipeline(name) { this.activePass.setPipeline(this.pipelines[name]); },
  passSetVertexBuffer(i, buffer) { this.activePass.setVertexBuffer(i, buffer); },
  passSetIndexBuffer() { this.activePass.setIndexBuffer(this.sphereMesh.indices, 0, 4); },
  passDraw(count) { this.activePass.drawIndexed(count); }
};