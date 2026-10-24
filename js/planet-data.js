/* planet-data.js
 * Real astronomical data for the Sun, the eight planets and the major moons we simulate.
 * All numbers are real values (km, AU, days, degrees); the *display* scaling that turns
 * them into scene units lives in scene.js so the raw data here stays physical.
 */

const SolarData = {
  /* The Sun is its own entry so the Jump-To list and fact popup treat it uniformly. */
  sun: {
    id: 'sun',
    name: 'Sun',
    kind: 'G2V main-sequence star',
    radiusKm: 695700,
    rotationPeriodDays: 25.4,          /* equatorial photospheric rotation */
    temperatureText: '5,505 °C surface · 15.7 M°C core',
    ageText: '4.6 billion years',
    massFractionText: '99.86% of the solar system',
    blurb: 'A G-type main-sequence star whose gravity holds every body in this scene. '
      + 'Its light takes about 8 minutes 20 seconds to reach Earth.'
  },

  /* ------------------------------------------------------------------ */
  /* PLANETS — orbital elements are J2000-ish mean elements:              */
  /*   semiMajorAxisAU  a (AU)                                            */
  /*   eccentricity     e (Mercury's 0.206 is the largest, others small)  */
  /*   orbitalPeriodDays P                                               */
  /*   inclinationDeg     plane tilt vs. the ecliptic (visual)             */
  /*   periapsisRotationDeg in-plane rotation of the ellipse (ϖ)          */
  /*   startAnomalyDeg    initial mean anomaly (epoch offset)              */
  /* ------------------------------------------------------------------ */
  planets: [
    {
      id: 'mercury', name: 'Mercury', kind: 'Terrestrial planet',
      radiusKm: 2440, diameterKm: 4879,
      semiMajorAxisAU: 0.387, eccentricity: 0.2056, orbitalPeriodDays: 87.97,
      inclinationDeg: 7.00, periapsisRotationDeg: 77, startAnomalyDeg: 174,
      axialTiltDeg: 0.03, rotationPeriodDays: 58.65,
      distanceText: '0.387 AU (57.9 Mm)', periodText: '87.97 days',
      spinText: '58.65 days (slow, tidally locked-ish)', tiltText: '0.03°',
      temperatureText: '−173 °C to 427 °C', moonsCount: 0, moonListText: 'None',
      blurb: 'The smallest planet and the closest to the Sun. With almost no atmosphere, '
        + 'it swings from frozen night to furnace day, and its surface is the most '
        + 'heavily cratered of any planet.'
    },
    {
      id: 'venus', name: 'Venus', kind: 'Terrestrial planet',
      radiusKm: 6052, diameterKm: 12104,
      semiMajorAxisAU: 0.723, eccentricity: 0.0068, orbitalPeriodDays: 224.70,
      inclinationDeg: 3.39, periapsisRotationDeg: 131, startAnomalyDeg: 49,
      axialTiltDeg: 177.4, rotationPeriodDays: -243.02,   /* negative = retrograde */
      distanceText: '0.723 AU (108.2 Mm)', periodText: '224.7 days',
      spinText: '243 days, retrograde (spins backwards)', tiltText: '177° (effectively upside down)',
      temperatureText: '~465 °C (greenhouse)', moonsCount: 0, moonListText: 'None',
      blurb: 'A runaway greenhouse world: CO₂ clouds sit above a surface hot enough to melt lead. '
        + 'It spins backwards, so the Sun rises in the west — slowly, once every 117 Earth days.'
    },
    {
      id: 'earth', name: 'Earth', kind: 'Terrestrial planet',
      radiusKm: 6371, diameterKm: 12742,
      semiMajorAxisAU: 1.000, eccentricity: 0.0167, orbitalPeriodDays: 365.256,
      inclinationDeg: 0.0, periapsisRotationDeg: 103, startAnomalyDeg: 358,
      axialTiltDeg: 23.44, rotationPeriodDays: 0.9973,
      distanceText: '1.000 AU (149.6 Mm)', periodText: '365.25 days',
      spinText: '23.93 hours', tiltText: '23.44°',
      temperatureText: '−88 °C to 56.7 °C (avg 15 °C)', moonsCount: 1, moonListText: 'Moon',
      blurb: 'The only known world with liquid surface water, an oxygen-rich air and life. '
        + 'Its axial tilt gives us the seasons; its magnetic field shields the atmosphere from the solar wind.'
    },
    {
      id: 'mars', name: 'Mars', kind: 'Terrestrial planet',
      radiusKm: 3390, diameterKm: 6779,
      semiMajorAxisAU: 1.524, eccentricity: 0.0934, orbitalPeriodDays: 686.98,
      inclinationDeg: 1.85, periapsisRotationDeg: 336, startAnomalyDeg: 19,
      axialTiltDeg: 25.19, rotationPeriodDays: 1.026,
      distanceText: '1.524 AU (227.9 Mm)', periodText: '687 days (1.88 yr)',
      spinText: '24.6 hours', tiltText: '25.19°',
      temperatureText: '−140 °C to 20 °C (avg −63 °C)', moonsCount: 2, moonListText: 'Phobos, Deimos',
      blurb: 'The rusty desert world, home to the tallest volcano (Olympus Mons, 22 km) and a 4,000 km-wide '
        + 'canyon (Valles Marineris). Thin CO₂ air, polar ice caps and the best target for crewed missions.'
    },
    {
      id: 'jupiter', name: 'Jupiter', kind: 'Gas giant',
      radiusKm: 69911, diameterKm: 139820,
      semiMajorAxisAU: 5.203, eccentricity: 0.0484, orbitalPeriodDays: 4332.59,
      inclinationDeg: 1.30, periapsisRotationDeg: 14, startAnomalyDeg: 20,
      axialTiltDeg: 3.13, rotationPeriodDays: 0.4135,
      distanceText: '5.203 AU (778.5 Mm)', periodText: '11.86 years',
      spinText: '9.9 hours (fastest spin in the system)', tiltText: '3.13°',
      temperatureText: '−145 °C to −103 °C (cloud tops)', moonsCount: 95, moonListText: '79+ known — Io, Europa, Ganymede, Callisto…',
      blurb: 'More than twice the mass of all other planets combined. The Great Red Spot is a centuries-old '
        + 'storm wider than Earth; its radiation belts are lethal and its moons form a private solar system.'
    },
    {
      id: 'saturn', name: 'Saturn', kind: 'Gas giant',
      radiusKm: 58232, diameterKm: 116460,
      semiMajorAxisAU: 9.537, eccentricity: 0.0538, orbitalPeriodDays: 10759.2,
      inclinationDeg: 2.49, periapsisRotationDeg: 93, startAnomalyDeg: 317,
      axialTiltDeg: 26.73, rotationPeriodDays: 0.444,
      distanceText: '9.537 AU (1.43 Bm)', periodText: '29.45 years',
      spinText: '10.7 hours', tiltText: '26.73°',
      temperatureText: '~−139 °C', moonsCount: 274, moonListText: 'Titan, Rhea, Enceladus, 140+ more…',
      blurb: 'The ringed planet. Its rings span 280,000 km yet are only tens of metres thick. '
        + 'Saturn is the least dense body in the system — less dense than water.'
    },
    {
      id: 'uranus', name: 'Uranus', kind: 'Ice giant',
      radiusKm: 25362, diameterKm: 50724,
      semiMajorAxisAU: 19.19, eccentricity: 0.0472, orbitalPeriodDays: 30688.5,
      inclinationDeg: 0.77, periapsisRotationDeg: 70, startAnomalyDeg: 142,
      axialTiltDeg: 97.77, rotationPeriodDays: -0.718,          /* retrograde */
      distanceText: '19.19 AU (2.87 Bm)', periodText: '84.0 years',
      spinText: '17.2 hours, retrograde', tiltText: '97.77° (rolls on its side)',
      temperatureText: '~−195 °C', moonsCount: 28, moonListText: 'Titania, Oberon, Miranda, 24 more…',
      blurb: 'An ice giant tipped over on its side: each pole takes 42 years to complete one season. '
        + 'Methane in its haze tints the world pale cyan and hides any surface detail.'
    },
    {
      id: 'neptune', name: 'Neptune', kind: 'Ice giant',
      radiusKm: 24622, diameterKm: 49528,
      semiMajorAxisAU: 30.07, eccentricity: 0.0086, orbitalPeriodDays: 60182,
      inclinationDeg: 1.77, periapsisRotationDeg: 283, startAnomalyDeg: 259,
      axialTiltDeg: 28.3, rotationPeriodDays: 0.671,
      distanceText: '30.07 AU (4.49 Bm)', periodText: '164.8 years',
      spinText: '16.1 hours', tiltText: '28.3°',
      temperatureText: '~−200 °C (supergusts to −218 °C)', moonsCount: 16, moonListText: 'Triton, Nereid, 14 more…',
      blurb: 'The windiest world: supersonic gusts top 2,100 km/h. Discovered by mathematics in 1846, '
        + 'it has never been visited — the Voyager 2 flyby in 1989 is its only close look.'
    }
  ],

  /* ------------------------------------------------------------------ */
  /* MAJOR MOONS — distanceInPlanetRadii is the real semi-major axis       */
  /* measured in parent radii; sign 1 = prograde, -1 = retrograde orbit.   */
  /* ------------------------------------------------------------------ */
  moons: [
    {
      id: 'moon', name: 'Moon', parentId: 'earth', kind: 'Natural satellite',
      radiusKm: 1737, diameterKm: 3475, distanceInPlanetRadii: 60.4,
      orbitalPeriodDays: 27.32, orbitSign: 1,
      temperatureText: '−173 °C to 140 °C', spinText: '27.32 d (tidally locked)',
      distanceFromParentText: '384,400 km (60.4 Earth radii)',
      blurb: 'Earth\'s companion, big enough to matter: it steadies the planetary tilt, drives the tides '
        + 'and slows Earth\'s day. Formed, the leading theory says, from a giant impact 4.5 Gyr ago.'
    },
    {
      id: 'phobos', name: 'Phobos', parentId: 'mars', kind: 'Natural satellite',
      radiusKm: 11, diameterKm: 22.5, distanceInPlanetRadii: 2.77,
      orbitalPeriodDays: 0.3189, orbitSign: -1,                 /* orbits backwards, spiralling in */
      temperatureText: '~−30 °C', spinText: '7 h 39 m, retrograde',
      distanceFromParentText: '9,378 km (2.8 Mars radii)',
      blurb: 'Mars\'s inner moon, captured from an asteroid. It orbits *backwards* and loses 1.8 km per '
        + 'century — it will crash into Mars in ~50 M years.'
    },
    {
      id: 'deimos', name: 'Deimos', parentId: 'mars', kind: 'Natural satellite',
      radiusKm: 7.5, diameterKm: 15, distanceInPlanetRadii: 6.92,
      orbitalPeriodDays: 1.263, orbitSign: 1,
      temperatureText: '~−30 °C', spinText: '30 h 18 m',
      distanceFromParentText: '23,463 km (6.9 Mars radii)',
      blurb: 'Mars\'s small outer moon. It is so dim that Mars can be photographed showing it in its shadow.'
    },
    {
      id: 'io', name: 'Io', parentId: 'jupiter', kind: 'Natural satellite',
      radiusKm: 1822, diameterKm: 3642, distanceInPlanetRadii: 6.03,
      orbitalPeriodDays: 1.769, orbitSign: 1,
      temperatureText: '~−110 °C (volcanoes melt)', spinText: '1.77 d (tidally locked)',
      distanceFromParentText: '421,700 km (6.0 Jupiter radii)',
      blurb: 'The most volcanically active body in the solar system — sulphur seas, 400+ active volcanoes, '
        + 'plumes kilometres high. Tidal shredding by Jupiter powers it.'
    },
    {
      id: 'europa', name: 'Europa', parentId: 'jupiter', kind: 'Natural satellite',
      radiusKm: 1561, diameterKm: 3122, distanceInPlanetRadii: 9.60,
      orbitalPeriodDays: 3.551, orbitSign: 1,
      temperatureText: '~−160 °C', spinText: '3.55 d (tidally locked)',
      distanceFromParentText: '671,100 km (9.6 Jupiter radii)',
      blurb: 'An ice ball with a global salty ocean 100 km deep under the crust — '
        + 'the prime target in the search for a second biosphere. The Europa Clipper is on its way.'
    },
    {
      id: 'ganymede', name: 'Ganymede', parentId: 'jupiter', kind: 'Natural satellite',
      radiusKm: 2634, diameterKm: 5268, distanceInPlanetRadii: 15.31,
      orbitalPeriodDays: 7.155, orbitSign: 1,
      temperatureText: '~−160 °C', spinText: '7.16 d (tidally locked)',
      distanceFromParentText: '1.07 Mm (15.3 Jupiter radii)',
      blurb: 'The largest moon in the solar system — bigger than Mercury, with its own magnetic field '
        + 'and a buried ocean. Its surface is a patchwork of dark ancient ice and bright young ridges.'
    },
    {
      id: 'callisto', name: 'Callisto', parentId: 'jupiter', kind: 'Natural satellite',
      radiusKm: 2410, diameterKm: 4821, distanceInPlanetRadii: 26.93,
      orbitalPeriodDays: 16.689, orbitSign: 1,
      temperatureText: '~−150 °C', spinText: '16.69 d (tidally locked)',
      distanceFromParentText: '1.88 Mm (26.9 Jupiter radii)',
      blurb: 'The outer Galilean moon: a battered, crater-covered world of water ice and rock, '
        + 'the oldest large moon surface in the system.'
    },
    {
      id: 'rhea', name: 'Rhea', parentId: 'saturn', kind: 'Natural satellite',
      radiusKm: 764, diameterKm: 1527, distanceInPlanetRadii: 9.05,
      orbitalPeriodDays: 4.518, orbitSign: 1,
      temperatureText: '~−180 °C', spinText: '4.52 d (nearly locked)',
      distanceFromParentText: '527,100 km (9.1 Saturn radii)',
      blurb: 'Saturn\'s second moon, a heavily cratered ice ball. It orbits outside the main ring plane '
        + 'and is often caught in the rings\' shadow.'
    },
    {
      id: 'titan', name: 'Titan', parentId: 'saturn', kind: 'Natural satellite',
      radiusKm: 2575, diameterKm: 5150, distanceInPlanetRadii: 20.98,
      orbitalPeriodDays: 15.945, orbitSign: 1,
      temperatureText: '~−139 °C (42 K)', spinText: '15.9 d (nearly locked)',
      distanceFromParentText: '1.22 Mm (21.0 Saturn radii)',
      blurb: 'The only moon with a thick atmosphere — orange smog over methane seas. '
        + 'Its surface liquid rain, rivers and lakes are the only stable surface fluids known beyond Earth.'
    },
    {
      id: 'titania', name: 'Titania', parentId: 'uranus', kind: 'Natural satellite',
      radiusKm: 789, diameterKm: 1579, distanceInPlanetRadii: 17.19,
      orbitalPeriodDays: 8.706, orbitSign: 1,
      temperatureText: '~−200 °C', spinText: '8.71 d (tidally locked)',
      distanceFromParentText: '435,910 km (17.2 Uranus radii)',
      blurb: 'The largest Uranian moon, a smooth ice world with towering rift valleys '
        + '(Rayno Fossae). Like its siblings it orbits in Uranus\' equatorial plane — which is why '
        + 'here it circles almost vertically.'
    },
    {
      id: 'oberon', name: 'Oberon', parentId: 'uranus', kind: 'Natural satellite',
      radiusKm: 761, diameterKm: 1523, distanceInPlanetRadii: 23.01,
      orbitalPeriodDays: 13.459, orbitSign: 1,
      temperatureText: '~−200 °C', spinText: '13.46 d (tidally locked)',
      distanceFromParentText: '583,520 km (23.0 Uranus radii)',
      blurb: 'The outermost major Uranian moon: an ancient, cratered ice world with bright equatorial cliffs.'
    },
    {
      id: 'triton', name: 'Triton', parentId: 'neptune', kind: 'Natural satellite',
      radiusKm: 1353, diameterKm: 2707, distanceInPlanetRadii: 14.41,
      orbitalPeriodDays: 5.877, orbitSign: -1,                  /* famously retrograde */
      temperatureText: '~−235 °C (coldest surface in the system)', spinText: '5.88 d, retrograde',
      distanceFromParentText: '354,759 km (14.4 Neptune radii)',
      blurb: 'A captured Kuiper-belt world orbiting *backwards*. Nitrogen geysers spout 28 km above the '
        + 'pole; its frosts make it the coldest solid surface known.'
    }
  ]
};
