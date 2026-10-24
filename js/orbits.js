/* orbits.js
 * Small orbital-mechanics toolkit.
 *  - solveKepler(meanAnomaly, e)  : Newton iteration on E - e*sin(E) = M
 *  - orbitPosition(body, tDays)   : sun-centred position (pre-tilt) for a planet
 *  - generateOrbitPath(body, segments) : ellipse polyline for the orbit line mesh
 *  - moonPosition(moon, parentPos, tDays) : parent-centred circular moon position
 *
 * Everything is driven by ONE shared simulation clock (tDays), so every planet, moon and
 * spin keeps its *exact* real ratio to every other body — that is what makes the
 * time-scale slider honest: at 1 day/second Earth turns once per second and the Moon
 * takes 27.32 seconds, at 1000 days/second Neptune still takes ~0.168 s per orbit.
 */

const OrbitMech = {
  TWO_PI: Math.PI * 2,

  /** Solves Kepler's equation M = E - e*sin(E) for the eccentric anomaly E. */
  solveKepler(meanAnomaly, eccentricity) {
    /* A good starting guess for the first Newton step. */
    let eccentricAnomaly = meanAnomaly + eccentricity * Math.sin(meanAnomaly);
    for (let step = 0; step < 7; step += 1) {
      const delta =
        (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly)
        / (1 - eccentricity * Math.cos(eccentricAnomaly));
      eccentricAnomaly -= delta;
      if (Math.abs(delta) < 1e-7) { break; }
    }
    return eccentricAnomaly;
  },

  /**
   * Returns the planet position for a given elapsed simulation time, in *orbital-plane*
   * coordinates (x forward, z lateral). The Sun sits at one focus of the ellipse.
   * `aUnits` is the already-scaled semi-major axis in scene units.
   */
  planetPlanePosition(body, aUnits, tDays) {
    const meanAnomaly = body.startAnomalyDeg * (Math.PI / 180)
      + (OrbitMech.TWO_PI * tDays) / body.orbitalPeriodDays;
    const e = body.eccentricity;
    const E = OrbitMech.solveKepler(meanAnomaly, e);
    /* Focus-at-sun ellipse in the plane (perihelion along +x). */
    let localX = aUnits * (Math.cos(E) - e);
    let localZ = aUnits * Math.sqrt(1 - e * e) * Math.sin(E);
    /* Rotate the ellipse in-plane by its periapsis longitude. */
    const rotation = body.periapsisRotationDeg * (Math.PI / 180);
    return [
      localX * Math.cos(rotation) - localZ * Math.sin(rotation),
      localX * Math.sin(rotation) + localZ * Math.cos(rotation)
    ];
  },

  /**
   * Full sun-centred world position for a planet: elliptical motion, then the small
   * orbital inclination tilt of the whole plane around X.
   */
  planetWorldPosition(body, aUnits, tDays) {
    const [planeX, planeZ] = OrbitMech.planetPlanePosition(body, aUnits, tDays);
    const tilt = body.inclinationDeg * (Math.PI / 180);
    return [
      planeX,
      -planeZ * Math.sin(tilt),   /* plane tilts so part of +z dips below the ecliptic */
      planeZ * Math.cos(tilt)
    ];
  },

  /**
   * Samples the full ellipse (uniform in eccentric anomaly) for the orbit-line mesh.
   * Returns Float32Array of xyz triples — a flat strip the renderer feeds to LINE pairs.
   */
  generateOrbitPath(body, aUnits, segments) {
    const points = new Float32Array(segments * 3);
    const e = body.eccentricity;
    const rotation = body.periapsisRotationDeg * (Math.PI / 180);
    const tilt = body.inclinationDeg * (Math.PI / 180);
    for (let segment = 0; segment < segments; segment += 1) {
      const E = (OrbitMech.TWO_PI * segment) / segments;
      let localX = aUnits * (Math.cos(E) - e);
      let localZ = aUnits * Math.sqrt(1 - e * e) * Math.sin(E);
      const x = localX * Math.cos(rotation) - localZ * Math.sin(rotation);
      const z = localX * Math.sin(rotation) + localZ * Math.cos(rotation);
      points[segment * 3] = x;
      points[segment * 3 + 1] = -z * Math.sin(tilt);
      points[segment * 3 + 2] = z * Math.cos(tilt);
    }
    return points;
  },

  /**
   * Circular moon orbit in the parent's equatorial plane (the plane is tilted with the
   * parent's axial tilt further down the model-matrix chain). Retrograde bodies get a
   * negative rate from `orbitSign`.
   */
  moonLocalPosition(moon, orbitRadius, tDays) {
    const rate = (OrbitMech.TWO_PI * tDays * moon.orbitSign) / moon.orbitalPeriodDays;
    return [
      Math.cos(rate) * orbitRadius,
      0,
      -Math.sin(rate) * orbitRadius
    ];
  }
};
