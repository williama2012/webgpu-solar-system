/* geometry.js
 * Pure mesh generators. Everything returns plain typed arrays that webgpu-setup.js
 * uploads; nothing in here knows about the GPU.
 *  - createSphere: UV sphere (unit radius), positions + normals + uvs + indices.
 *  - createAnnulus: flat ring in the XZ plane (Saturn's rings), uv.x = radial 0..1.
 *  - createFullScreenTriangle: one big triangle for the procedural starfield pass.
 *  - createOrbitPath: line-list polyline for an orbital path.
 */

const Geometry = {
  /**
   * UV sphere of unit radius. u goes around the equator (0..1), v goes pole to pole (0..1).
   */
  createSphere(widthSegments, heightSegments) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let row = 0; row <= heightSegments; row += 1) {
      const v = row / heightSegments;                          /* 0 at north pole */
      const phi = v * Math.PI;                                 /* 0..PI */
      for (let column = 0; column <= widthSegments; column += 1) {
        const u = column / widthSegments;
        const theta = u * Math.PI * 2;
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(theta);
        positions.push(x, y, z);
        normals.push(x, y, z);                                 /* unit sphere: normal == position */
        uvs.push(u, v);
      }
    }
    for (let row = 0; row < heightSegments; row += 1) {
      for (let column = 0; column < widthSegments; column += 1) {
        const first = row * (widthSegments + 1) + column;
        const second = first + widthSegments + 1;
        indices.push(first, first + 1, second);
        indices.push(second, first + 1, second + 1);
      }
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices)
    };
  },

  /**
   * Annulus in the XZ plane. uv.x = radial coordinate (0 inner, 1 outer), uv.y = 0.5.
   * Normal points +Y; the shader uses abs(dot(N, L)) so both faces light up.
   */
  createAnnulus(innerRadius, outerRadius, radialSegments) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let ring = 0; ring <= 1; ring += 1) {
      const radius = innerRadius + (outerRadius - innerRadius) * ring;
      for (let segment = 0; segment <= radialSegments; segment += 1) {
        const theta = (segment / radialSegments) * Math.PI * 2;
        positions.push(Math.cos(theta) * radius, 0, Math.sin(theta) * radius);
        normals.push(0, 1, 0);
        uvs.push(ring, 0.5);
      }
    }
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const first = segment;
      const second = segment + 1 + radialSegments;
      indices.push(first, first + 1, second);
      indices.push(second, first + 1, second + 1);
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices)
    };
  },

  /** One oversized triangle; the vertex shader derives NDC from vertexIndex. */
  createFullScreenTriangle() {
    return new Float32Array([-1, -1, 3, -1, -1, 3]);
  },

  /** Line list (pairs of points) for an orbital path; the mesh is unit-scaled per body. */
  createOrbitPath(worldPoints, segments) {
    const positions = new Float32Array(worldPoints.length * 2);
    for (let segment = 0; segment < segments; segment += 1) {
      const fromIndex = segment * 3;
      const toIndex = ((segment + 1) % worldPoints.length) * 3;
      positions[segment * 6] = worldPoints[fromIndex];
      positions[segment * 6 + 1] = worldPoints[fromIndex + 1];
      positions[segment * 6 + 2] = worldPoints[fromIndex + 2];
      positions[segment * 6 + 3] = worldPoints[toIndex];
      positions[segment * 6 + 4] = worldPoints[toIndex + 1];
      positions[segment * 6 + 5] = worldPoints[toIndex + 2];
    }
    return positions;
  }
};