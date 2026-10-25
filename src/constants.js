/**
 * Astronomical data and the committed scene-scale model for the solar system.
 *
 * Pure data module (Node-importable; no DOM or GPU code here).
 * Every value is approximate - this is a visualization, not an ephemeris.
 * Self-consistency rule (plan §5.1): each moon's (a, periodDays) pair was
 * checked against its parent's gravitational parameter so that Kepler's
 * third law holds by construction; tools/smoke-test.mjs re-derives every
 * period from (mu, a) and asserts the shipped table stays within 2%.
 */

/* ============================ Units ============================ */

/** Seconds in one day. */
export const SECONDS_PER_DAY = 86400;

/** Seconds in one Julian year (365.25 days). */
export const SECONDS_PER_JULIAN_YEAR = 3.15576e7;

/** Kilometres per astronomical unit. */
export const KILOMETERS_PER_ASTRONOMICAL_UNIT = 149597870.7;

/** Million-kilometres per AU, used by the popup "x Mm km" readout. */
export const MILLION_KILOMETER_PER_AU = 149.5978707;

/* ===================== Time control (plan §8.4) ===================== */

/**
 * Maximum time scale: 100 Julian years of simulation per wall-clock second.
 * Multiplier mapping: multiplier = 10^(t * log10(TIME_SCALE_MAX_SECONDS_PER_SECOND)),
 * t in [0, 1] -> [1 s/s ... 3.15576e9 s/s].
 */
export const TIME_SCALE_MAX_SECONDS_PER_SECOND = 3.15576e9;

/* ==================== Scene-scale model (plan §4) ==================== */

/** Planet display distance: D(a_AU) = K * a_AU^p, with K = 20 scene units. */
export const PLANET_DISTANCE_SCALE_K = 20;

/** Default exponent p of the distance-compression power law. */
export const DISTANCE_POWER_DEFAULT = 0.5;

export const DISTANCE_POWER_MIN = 0.4;

export const DISTANCE_POWER_MAX = 0.8;

export const DISTANCE_POWER_STEP = 0.05;

/** Single size multiplier S applied to every body (relative ratios exact). */
export const PLANET_SIZE_MULTIPLIER_DEFAULT = 40;

export const PLANET_SIZE_MULTIPLIER_MIN = 10;

export const PLANET_SIZE_MULTIPLIER_MAX = 300;

export const PLANET_SIZE_MULTIPLIER_STEP = 5;

/**
 * Sun display radius is a separate scene unit value (default 5 u). It is
 * deliberately decoupled from the planet-size multiplier so that all
 * planet/moon ratios stay exact under the slider.
 */
export const SUN_DISPLAY_RADIUS_DEFAULT = 5;

export const SUN_DISPLAY_RADIUS_MIN = 1;

export const SUN_DISPLAY_RADIUS_MAX = 20;

/** Moon display distance: d(a_mMkm) = M * a_mMkm^q, with M = 10. */
export const MOON_DISTANCE_SCALE_M = 10;

/** Exponent q of the moon-distance compression power law. */
export const MOON_DISTANCE_POWER_Q = 0.7;

/**
 * Moons are never placed closer than this multiple of their parent's display
 * radius (kept at 1.8x because 2.0x would merge Europa and Io and break the
 * Galilean radial order).
 */
export const MOON_MIN_SEPARATION_FRACTION = 1.8;

/* ======================= Camera defaults (plan §4) ==================== */

/** Free-camera home target (scene origin). */
export const INITIAL_CAMERA_TARGET = { x: 0, y: 0, z: 0 };

/** Initial distance: frames Neptune (109.66 u) with margin. */
export const INITIAL_CAMERA_DISTANCE = 240;

/** Initial yaw in degrees. */
export const INITIAL_CAMERA_YAW_DEG = 35;

/** Initial pitch in degrees. */
export const INITIAL_CAMERA_PITCH_DEG = 18;

/* ======================= Sun record (plan §5.2) ====================== */

/**
 * The central star.
 * radiusKm is the photosphere radius; the displayed diameter is 1,392,700 km
 * and the on-scene radius comes from SUN_DISPLAY_RADIUS_DEFAULT (slider 1..20).
 */
export const SUN_RECORD = {
  name: 'Sun',
  kind: 'sun',
  radiusKm: 696340,
  diameterKm: 1392700,
  type: 'G2V yellow dwarf',
  surfaceTemperatureDisplay: '~5,500 °C (photosphere)',
  ageDisplay: '~4.6 billion years',
  labelColor: '#ffcf8a',
  textureKey: 'sun',
  trivia: [
    "Holds ~99.86% of the solar system's total mass.",
    'Sunlight reaches Earth in about 8 m 20 s.',
  ],
};

/* ========================= Planets (plan §5.2) ======================== */
/**
 * J2000-ish orbital elements for the eight planets.
 * Field notes:
 * - aAU: semi-major axis in AU; e: eccentricity; i: inclination (deg).
 * - ascendingNodeDeg is Omega; pericenterLongitudeDeg is varpi = Omega + omega,
 *   so the argument of pericenter omega = varpi - Omega.
 * - spinHours: sidereal rotation period; negative means retrograde
 *   (Venus, Uranus).
 * - meanAnomaly0Deg: J2000-ish start offset so orbits begin pointing different
 *   ways; at these small e it is visually only an anti-clumping device.
 * - gravitationalParameterKm3PerS2: G*central mass for this planet's moon
 *   system (Earth value is the Earth+Moon barycentric two-body mu). Used by
 *   tools/smoke-test.mjs to re-derive moon periods; not needed for planets.
 */
export const PLANET_RECORDS = [
  {
    name: 'Mercury',
    radiusKm: 2439.7,
    aAU: 0.3871,
    eccentricity: 0.2056,
    inclinationDeg: 7.00,
    ascendingNodeDeg: 48.3,
    pericenterLongitudeDeg: 77.5,
    periodDays: 87.969,
    spinHours: 1407.5,
    axialTiltDeg: 0.03,
    meanAnomaly0Deg: 252.3,
    textureKey: 'mercury',
    labelColor: '#c9b7a4',
  },
  {
    name: 'Venus',
    radiusKm: 6051.8,
    aAU: 0.7233,
    eccentricity: 0.0068,
    inclinationDeg: 3.39,
    ascendingNodeDeg: 76.7,
    pericenterLongitudeDeg: 131.6,
    periodDays: 224.701,
    // Retrograde spin (negative) - slow backward drift.
    spinHours: -5832.5,
    axialTiltDeg: 177.4,
    meanAnomaly0Deg: 182.0,
    textureKey: 'venus',
    labelColor: '#e8c47c',
  },
  {
    name: 'Earth',
    radiusKm: 6371.0,
    aAU: 1.0,
    eccentricity: 0.0167,
    inclinationDeg: 0.00,
    ascendingNodeDeg: 0.0, // (approx)
    pericenterLongitudeDeg: 102.9,
    periodDays: 365.256,
    spinHours: 23.93,
    axialTiltDeg: 23.44,
    meanAnomaly0Deg: 100.5,
    textureKey: 'earth',
    labelColor: '#6db3ff',
    // Earth+Moon barycentric two-body mu = 398,600.4 + 4,902.8.
    gravitationalParameterKm3PerS2: 403503,
  },
  {
    name: 'Mars',
    radiusKm: 3389.5,
    aAU: 1.5237,
    eccentricity: 0.0934,
    inclinationDeg: 1.85,
    ascendingNodeDeg: 49.6, // (approx)
    pericenterLongitudeDeg: 336.0, // (approx)
    periodDays: 686.98,
    spinHours: 24.62,
    axialTiltDeg: 25.19,
    meanAnomaly0Deg: 355.9,
    textureKey: 'mars',
    labelColor: '#e07a52',
    gravitationalParameterKm3PerS2: 42828.37,
  },
  {
    name: 'Jupiter',
    radiusKm: 69911,
    aAU: 5.2026,
    eccentricity: 0.0484,
    inclinationDeg: 1.30,
    ascendingNodeDeg: 100.5,
    pericenterLongitudeDeg: 14.7,
    periodDays: 4332.59,
    spinHours: 9.93,
    axialTiltDeg: 3.13,
    meanAnomaly0Deg: 34.4,
    textureKey: 'jupiter',
    labelColor: '#d9a878',
    gravitationalParameterKm3PerS2: 126686534,
  },
  {
    name: 'Saturn',
    radiusKm: 58232,
    aAU: 9.55,
    eccentricity: 0.0555,
    inclinationDeg: 2.49,
    ascendingNodeDeg: 113.7,
    pericenterLongitudeDeg: 92.6,
    periodDays: 10759,
    spinHours: 10.66,
    axialTiltDeg: 26.73,
    meanAnomaly0Deg: 49.9,
    textureKey: 'saturn',
    labelColor: '#e3cf9e',
    // Consistent with the Titan (15.945 d) and Rhea (4.518 d) orbit checks.
    gravitationalParameterKm3PerS2: 3.793e7,
  },
  {
    name: 'Uranus',
    radiusKm: 25362,
    aAU: 19.189,
    eccentricity: 0.0472,
    // INCLINATION GUARD: committed value is 0.77 deg. Circulating copies show
    // 7.73 deg (a 10x typo) that would visibly mis-orbit the planet; this value stands.
    inclinationDeg: 0.77,
    ascendingNodeDeg: 73.0, // (approx)
    pericenterLongitudeDeg: 172.0, // (approx)
    periodDays: 30688,
    // Retrograde spin - the planet visibly rolls "the wrong way".
    spinHours: -17.24,
    axialTiltDeg: 97.77,
    meanAnomaly0Deg: 313.2,
    textureKey: 'uranus',
    labelColor: '#9fd6d9',
    gravitationalParameterKm3PerS2: 5.7996e6,
  },
  {
    name: 'Neptune',
    radiusKm: 24622,
    aAU: 30.07,
    eccentricity: 0.0090,
    inclinationDeg: 1.77,
    ascendingNodeDeg: 130.3, // (approx)
    pericenterLongitudeDeg: 249.0, // (approx)
    periodDays: 60182,
    spinHours: 16.11,
    axialTiltDeg: 28.30,
    meanAnomaly0Deg: 304.8,
    textureKey: 'neptune',
    labelColor: '#6b7fe0',
    gravitationalParameterKm3PerS2: 6.8345e6,
  },
];

/* ===================== Planet factoids (plan §5.4) ==================== */
/**
 * Display-only strings for the factoid popup, keyed by planet name.
 * Diameter / distance-from-Sun / orbital-period rows are derived from the
 * orbital record at render time; only these extras live here.
 */
export const PLANET_FACTOIDS = {
  Mercury: {
    type: 'Terrestrial planet',
    surfaceTemperatureDisplay: '−173 … +427 °C',
    moonCountDisplay: '0',
    dayLengthDisplay: '176 days (solar)',
    trivia: ['A solar day here lasts ~176 Earth days.'],
  },
  Venus: {
    type: 'Terrestrial planet',
    surfaceTemperatureDisplay: '≈ +464 °C',
    moonCountDisplay: '0',
    dayLengthDisplay: '243 days (retrograde)',
    trivia: ['Hottest planet; CO₂/SO₄ clouds, retrograde spin.'],
  },
  Earth: {
    type: 'Terrestrial planet',
    surfaceTemperatureDisplay: '≈ −89 … +57 °C (records)',
    moonCountDisplay: '1',
    dayLengthDisplay: '23.9 hours',
    trivia: ['Only known world with life; 71% ocean surface.'],
  },
  Mars: {
    type: 'Terrestrial planet',
    surfaceTemperatureDisplay: '≈ −140 … +20 °C',
    moonCountDisplay: '2',
    dayLengthDisplay: '24.6 hours',
    trivia: ['Home to Olympus Mons, the tallest volcano.'],
  },
  Jupiter: {
    type: 'Gas giant',
    surfaceTemperatureDisplay: '≈ −108 °C (at 1 bar)',
    moonCountDisplay: '95+',
    dayLengthDisplay: '9.9 hours',
    trivia: ['Its Great Red Spot is wider than Earth.'],
  },
  Saturn: {
    type: 'Ringed gas giant',
    surfaceTemperatureDisplay: '≈ −139 °C',
    moonCountDisplay: '146+',
    dayLengthDisplay: '10.7 hours',
    trivia: ['Would float on water; rings are water ice.'],
  },
  Uranus: {
    type: 'Ice giant',
    surfaceTemperatureDisplay: '≈ −197 °C (coldest atmosphere)',
    moonCountDisplay: '28+',
    dayLengthDisplay: '17.2 hours (retrograde)',
    trivia: ['Spins on its side - a ~98° axial tilt.'],
  },
  Neptune: {
    type: 'Ice giant',
    surfaceTemperatureDisplay: '≈ −200 °C',
    moonCountDisplay: '16+',
    dayLengthDisplay: '16.1 hours',
    trivia: ['Fastest winds in the solar system, ~2,100 km/h.'],
  },
};

/* ========================= Moons (plan §5.3) ========================== */
/**
 * The twelve "major" satellites. Fields:
 * - aMmkm: semi-major axis in million-kilometres (drives compressed display
 *   distance, plan §4); radiusKm drives the shared size multiplier S.
 * - periodDays: checked against the parent gravitational parameter (plan
 *   §5.1); canonical anchor values per the verification table.
 * - isRetrograde (Triton only): flips orbit mean-motion and tidally-locked spin.
 * - inclinationDeg defaults to 0 for every moon (scene-plane orbits).
 *
 * Nereid is deliberately NOT in this set: its compressed orbit (~4.8 u at
 * q = 0.7) would nearly coincide with Triton's 4.84 u. If it is ever added,
 * use a = 347,124 km with T derived per plan §5.1 (~5.7 d) - never the
 * known-bad 11.06 d pairing.
 */
export const MOON_RECORDS = [
  {
    name: 'Moon', parentName: 'Earth', radiusKm: 1737.5, aMmkm: 0.3844,
    periodDays: 27.321, inclinationDeg: 0, textureKey: 'moon',
    temperatureDisplay: '−173 … +127 °C',
    trivia: ['Slowly receding from Earth (~3.8 cm/yr); airless.'],
  },
  {
    name: 'Phobos', parentName: 'Mars', radiusKm: 11.1, aMmkm: 0.009378,
    periodDays: 0.319, inclinationDeg: 0, textureKey: 'phobos',
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ['Tiny Mars satellite, slowly spiralling into Mars.'],
  },
  {
    name: 'Deimos', parentName: 'Mars', radiusKm: 7.5, aMmkm: 0.023459,
    periodDays: 1.263, inclinationDeg: 0, textureKey: 'deimos',
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ['Small Mars satellite of unknown origin.'],
  },
  {
    name: 'Io', parentName: 'Jupiter', radiusKm: 1821.6, aMmkm: 0.4217,
    periodDays: 1.769, inclinationDeg: 0, textureKey: 'io',
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ['Most volcanic body in the system (tidal heating).'],
  },
  {
    name: 'Europa', parentName: 'Jupiter', radiusKm: 1560.8, aMmkm: 0.671034,
    periodDays: 3.551, inclinationDeg: 0, textureKey: 'europa',
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ['Hides a subsurface saltwater ocean under its ice.'],
  },
  {
    name: 'Ganymede', parentName: 'Jupiter', radiusKm: 2634.1, aMmkm: 1.0704,
    periodDays: 7.155, inclinationDeg: 0, textureKey: 'ganymede',
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ['Largest moon; bigger than Mercury, own magnetic field.'],
  },
  {
    name: 'Callisto', parentName: 'Jupiter', radiusKm: 2410.3, aMmkm: 1.8827,
    periodDays: 16.69, inclinationDeg: 0, textureKey: 'callisto',
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ['Ancient, heavily cratered crust.'],
  },
  {
    name: 'Rhea', parentName: 'Saturn', radiusKm: 763.8, aMmkm: 0.527108,
    periodDays: 4.518, inclinationDeg: 0, textureKey: 'rhea',
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ['A large regular Saturnian moon.'],
  },
  {
    name: 'Titan', parentName: 'Saturn', radiusKm: 2574.7, aMmkm: 1.22187,
    periodDays: 15.945, inclinationDeg: 0, textureKey: 'titan',
    temperatureDisplay: '≈ −179 °C',
    trivia: ['N₂ air, methane lakes and rain.'],
  },
  {
    name: 'Titania', parentName: 'Uranus', radiusKm: 788.4, aMmkm: 0.43591,
    periodDays: 8.706, inclinationDeg: 0, textureKey: 'titania',
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ["Largest of Uranus's moons."],
  },
  {
    name: 'Oberon', parentName: 'Uranus', radiusKm: 761.4, aMmkm: 0.58352,
    periodDays: 13.46, inclinationDeg: 0, textureKey: 'oberon',
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ['Icy, heavily cratered surface.'],
  },
  {
    // Triton is the only retrograde body in the system (orbit + spin).
    name: 'Triton', parentName: 'Neptune', radiusKm: 2075.5, aMmkm: 0.354759,
    periodDays: 5.877, inclinationDeg: 0, textureKey: 'triton', isRetrograde: true,
    temperatureDisplay: 'Poorly characterized - see trivia',
    trivia: ['Retrograde orbit, N₂ geysers, likely a captured KBO.'],
  },
];

/** Label border/ink color shared by all moon labels. */
export const MOON_LABEL_COLOR = '#b9c6e0';