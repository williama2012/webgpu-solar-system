/**
 * Real-world astronomical data for the Sun, the eight planets and their
 * major satellites, plus the visual scaling rules used to keep the whole
 * system on one screen.
 */

const EARTH_RADIUS_KM = 6371;
const LUNAR_RADIUS_KM = 1737.4;

/**
 * Real orbits span 0.39 AU (Mercury) to 30 AU (Neptune), i.e. a 78:1 ratio,
 * and real radii span 1,392,700 km (Sun) to 4,879 km (Mercury). Linear
 * real-scale rendering makes the planets invisible, so both are compressed:
 * orbit radius uses sqrt(AU) and body radius uses sqrt(km), which preserves
 * relative ordering and spacing while keeping everything visible.
 */
const ORBIT_SCALE_PER_SQRT_AU = 72;
const PLANET_SIZE_SCALE = 2.2;
const MOON_MIN_RADIUS_UNITS = 0.42;
const MOON_SIZE_SCALE = 0.85;
/** The Sun is drawn at a fixed size: a true scale would swallow Mercury. */
export const SUN_RADIUS_UNITS = 12;

function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

function planetRadiusUnits(radiusKm) {
    return PLANET_SIZE_SCALE * Math.sqrt(radiusKm / EARTH_RADIUS_KM);
}

function moonRadiusUnits(radiusKm) {
    return Math.max(MOON_MIN_RADIUS_UNITS, MOON_SIZE_SCALE * Math.sqrt(radiusKm / LUNAR_RADIUS_KM));
}

function orbitRadiusUnits(astronomicalUnits) {
    return ORBIT_SCALE_PER_SQRT_AU * Math.sqrt(astronomicalUnits);
}

function spinAxialTiltRadians(axialTiltDeg) {
    // Venus (177°) and Uranus (98°) are effectively "upside down"; mirroring
    // tilts above 90° keeps the texture axis upright for visual clarity.
    return toRadians(axialTiltDeg > 90 ? 180 - axialTiltDeg : axialTiltDeg);
}

const PLANET_RECORDS = [
    {
        id: 'mercury', name: 'Mercury', radiusKm: 2439.7, distanceAu: 0.387,
        orbitalPeriodDays: 87.969, rotationPeriodDays: 58.646, axialTiltDeg: 0.034,
        inclinationDeg: 7.005, nodeDeg: 48.3, phaseDeg: 40,
        temperature: '−173 to 427 °C', moonCount: 0, textureKind: 'mercury', fill: '#948d84',
        fact: 'The smallest planet. With almost no atmosphere, its surface swings more than 600 °C between day and night.',
    },
    {
        id: 'venus', name: 'Venus', radiusKm: 6051.8, distanceAu: 0.723,
        orbitalPeriodDays: 224.701, rotationPeriodDays: -243.025, axialTiltDeg: 177.4,
        inclinationDeg: 3.39, nodeDeg: 76.7, phaseDeg: 160,
        temperature: '~462 °C (constant)', moonCount: 0, textureKind: 'venus', fill: '#e0c294',
        fact: 'The hottest planet: a runaway CO₂ greenhouse under a crushing 92-bar atmosphere. It also spins backwards.',
    },
    {
        id: 'earth', name: 'Earth', radiusKm: 6371, distanceAu: 1.0,
        orbitalPeriodDays: 365.256, rotationPeriodDays: 0.9973, axialTiltDeg: 23.44,
        inclinationDeg: 0.0, nodeDeg: -11.3, phaseDeg: 100,
        temperature: '−88 to 47 °C', moonCount: 1, textureKind: 'earth', fill: '#3a78c2',
        fact: 'The only known world with life and liquid surface water. Its tilt seasons and its Moon steadies its axis.',
    },
    {
        id: 'mars', name: 'Mars', radiusKm: 3389.5, distanceAu: 1.524,
        orbitalPeriodDays: 686.98, rotationPeriodDays: 1.026, axialTiltDeg: 25.19,
        inclinationDeg: 1.85, nodeDeg: 79.3, phaseDeg: 210,
        temperature: '−153 to 20 °C', moonCount: 2, textureKind: 'mars', fill: '#b4593a',
        fact: 'Home of Olympus Mons (the solar system’s tallest volcano) and Valles Marineris canyon.',
    },
    {
        id: 'jupiter', name: 'Jupiter', radiusKm: 69911, distanceAu: 5.203,
        orbitalPeriodDays: 4332.59, rotationPeriodDays: 0.4135, axialTiltDeg: 3.13,
        inclinationDeg: 1.30, nodeDeg: 100.5, phaseDeg: 350,
        temperature: '~−103 °C', moonCount: 95, textureKind: 'jupiter', fill: '#c8a174',
        fact: 'The most massive planet — twice all the others combined. The Great Red Spot is a storm wider than Earth.',
    },
    {
        id: 'saturn', name: 'Saturn', radiusKm: 58232, distanceAu: 9.537,
        orbitalPeriodDays: 10759.2, rotationPeriodDays: 0.444, axialTiltDeg: 26.73,
        inclinationDeg: 2.49, nodeDeg: 113.7, phaseDeg: 120,
        temperature: '~−135 °C', moonCount: 146, textureKind: 'saturn', fill: '#d8c49a', ring: true,
        fact: 'Its rings span 280,000 km yet are mostly tens of metres thick — shards of water ice.',
    },
    {
        id: 'uranus', name: 'Uranus', radiusKm: 25362, distanceAu: 19.191,
        orbitalPeriodDays: 30688.5, rotationPeriodDays: -0.718, axialTiltDeg: 97.77,
        inclinationDeg: 0.77, nodeDeg: 74.0, phaseDeg: 20,
        temperature: '~−197 °C', moonCount: 28, textureKind: 'uranus', fill: '#9fd8d4',
        fact: 'It rolls on its side: a 98° tilt makes it orbit the Sun almost equator-first, likely from an ancient impact.',
    },
    {
        id: 'neptune', name: 'Neptune', radiusKm: 24622, distanceAu: 30.069,
        orbitalPeriodDays: 60182, rotationPeriodDays: 0.6713, axialTiltDeg: 28.3,
        inclinationDeg: 1.77, nodeDeg: 131.0, phaseDeg: 250,
        temperature: '~−201 °C', moonCount: 25, textureKind: 'neptune', fill: '#3b5bdb',
        fact: 'Supersonic — winds reach 2,100 km/h, the fastest measured in the solar system, despite receiving little sunlight.',
    },
];

const MOON_RECORDS = [
    { parent: 'earth', id: 'moon', name: 'Moon', radiusKm: 1737.4, distanceKm: 384400, orbitalPeriodDays: 27.322,
      inclinationDeg: 5.1, nodeDeg: 0, phaseDeg: 30, temperature: '−173 to 70 °C', textureKind: 'gray-cratered', fill: '#b9b7b2',
      fact: 'Earth’s only natural satellite; its pull drives our tides and steadies the planet’s spin axis.' },
    { parent: 'mars', id: 'phobos', name: 'Phobos', radiusKm: 11.1, distanceKm: 6283, orbitalPeriodDays: 0.3189,
      inclinationDeg: 1.0, nodeDeg: 0, phaseDeg: 80, temperature: '~−5 °C', textureKind: 'gray-cratered', fill: '#7a6a58',
      fact: 'Mars’s inner moon, actually falling into the planet — it loses ~1.8 km of orbit per year.' },
    { parent: 'mars', id: 'deimos', name: 'Deimos', radiusKm: 6.2, distanceKm: 23463, orbitalPeriodDays: 1.2624,
      inclinationDeg: 10.6, nodeDeg: 0, phaseDeg: 200, temperature: '~−5 °C', textureKind: 'gray-cratered', fill: '#8a7a66',
      fact: 'Lumpy and irregular — likely an asteroid captured by Mars long ago.' },
    { parent: 'jupiter', id: 'io', name: 'Io', radiusKm: 1821.6, distanceKm: 421700, orbitalPeriodDays: 1.769,
      inclinationDeg: 2.2, nodeDeg: 0, phaseDeg: 0, temperature: '−143 to 50 °C', textureKind: 'io', fill: '#c8b23c',
      fact: 'The most volcanic body in the solar system — sulfur fountains up to 700 km high, heated by Jupiter’s tides.' },
    { parent: 'jupiter', id: 'europa', name: 'Europa', radiusKm: 1560.8, distanceKm: 671000, orbitalPeriodDays: 3.551,
      inclinationDeg: 3.0, nodeDeg: 0, phaseDeg: 120, temperature: '~−160 °C', textureKind: 'europa', fill: '#d8d9dd',
      fact: 'A cracked icy shell hides a global salt-water ocean — a prime target in the search for life.' },
    { parent: 'jupiter', id: 'ganymede', name: 'Ganymede', radiusKm: 2634.1, distanceKm: 1070400, orbitalPeriodDays: 7.155,
      inclinationDeg: 4.5, nodeDeg: 0, phaseDeg: 240, temperature: '~−160 °C', textureKind: 'ganymede', fill: '#9a8672',
      fact: 'The largest moon in the solar system — bigger than the planet Mercury, with its own magnetic field.' },
    { parent: 'jupiter', id: 'callisto', name: 'Callisto', radiusKm: 2410.3, distanceKm: 1882700, orbitalPeriodDays: 16.689,
      inclinationDeg: 7.0, nodeDeg: 0, phaseDeg: 300, temperature: '~−165 °C', textureKind: 'callisto', fill: '#6b655d',
      fact: 'The most heavily cratered world in the solar system — its ancient surface shows almost no renewal.' },
    { parent: 'saturn', id: 'titan', name: 'Titan', radiusKm: 2574.7, distanceKm: 1221830, orbitalPeriodDays: 15.945,
      inclinationDeg: 14.0, nodeDeg: 0, phaseDeg: 60, temperature: '~−179 °C', textureKind: 'titan', fill: '#c8862e',
      fact: 'The only moon with a dense atmosphere (thicker than Earth’s) — its hazy orange sky rains methane.' },
    { parent: 'saturn', id: 'rhea', name: 'Rhea', radiusKm: 382, distanceKm: 527108, orbitalPeriodDays: 4.518,
      inclinationDeg: 9.0, nodeDeg: 0, phaseDeg: 150, temperature: '~−190 °C', textureKind: 'ice', fill: '#c4d2de',
      fact: 'Saturn’s second-largest moon — a lumpy ball of water ice, mostly hidden by the rings when viewed from Earth.' },
    { parent: 'uranus', id: 'titania', name: 'Titania', radiusKm: 788.5, distanceKm: 435910, orbitalPeriodDays: 8.706,
      inclinationDeg: 6.0, nodeDeg: 0, phaseDeg: 30, temperature: '~−195 °C', textureKind: 'ice', fill: '#b9c9dc',
      fact: 'Largest of Uranus’s five big moons; its surface is mostly water ice with cliff-lined canyons.' },
    { parent: 'uranus', id: 'oberon', name: 'Oberon', radiusKm: 761.2, distanceKm: 583520, orbitalPeriodDays: 13.456,
      inclinationDeg: 8.0, nodeDeg: 0, phaseDeg: 160, temperature: '~−195 °C', textureKind: 'ice', fill: '#b3c2d2',
      fact: 'Outermost of Uranus’s five big moons; it hosts one of the tallest cliffs in the solar system.' },
    { parent: 'neptune', id: 'triton', name: 'Triton', radiusKm: 1353.4, distanceKm: 354760, orbitalPeriodDays: 5.877,
      inclinationDeg: 12.0, nodeDeg: 0, phaseDeg: 280, temperature: '~−235 °C', textureKind: 'triton', fill: '#b8b4ac',
      fact: 'Orbits Neptune backwards — a captured Kuiper-belt object spouting nitrogen geysers 28 km high.' },
];

/**
 * Builds the full celestial dataset with all pre-computed visual values.
 *
 * @returns {{ sun: object, planets: object[], allBodies: object[] }} Records
 *   safe for direct use by the scene builder (each carries its own orbit and
 *   radius in scene units).
 */
export function buildCelestialData() {
    const planets = PLANET_RECORDS.map((record) => {
        const planet = {
            id: record.id,
            name: record.name,
            isSun: false,
            realRadiusKm: record.radiusKm,
            radiusUnits: planetRadiusUnits(record.radiusKm),
            orbit: {
                radiusUnits: orbitRadiusUnits(record.distanceAu),
                periodDays: record.orbitalPeriodDays,
                phaseRad: toRadians(record.phaseDeg),
                inclinationRad: toRadians(record.inclinationDeg),
                nodeRad: toRadians(record.nodeDeg),
            },
            spinPeriodDays: record.rotationPeriodDays,
            axialTiltRad: spinAxialTiltRadians(record.axialTiltDeg),
            worldPosition: [0, 0, 0],
            distanceAu: record.distanceAu,
            distanceKm: record.distanceAu * 149597870.7,
            axialTiltDeg: record.axialTiltDeg,
            temperature: record.temperature,
            moonCount: record.moonCount,
            textureKind: record.textureKind,
            fill: record.fill,
            fact: record.fact,
            ring: record.ring === true,
            moons: [],
        };

        MOON_RECORDS
            .filter((moonRecord) => moonRecord.parent === record.id)
            .forEach((moonRecord, moonIndex) => {
                // Moon orbits are spaced out relative to their planet’s visual
                // radius so neighbouring systems never visually collide.
                planet.moons.push({
                    id: moonRecord.id,
                    name: moonRecord.name,
                    isSun: false,
                    parent: record.id,
                    parentName: record.name,
                    realRadiusKm: moonRecord.radiusKm,
                    radiusUnits: moonRadiusUnits(moonRecord.radiusKm),
                    orbit: {
                        radiusUnits: planet.radiusUnits * (1.9 + 1.2 * moonIndex),
                        periodDays: moonRecord.orbitalPeriodDays,
                        phaseRad: toRadians(moonRecord.phaseDeg),
                        inclinationRad: toRadians(moonRecord.inclinationDeg),
                        nodeRad: toRadians(moonRecord.nodeDeg),
                    },
                    spinPeriodDays: moonRecord.orbitalPeriodDays, // tidally locked
                    axialTiltRad: 0,
                    worldPosition: [0, 0, 0],
                    distanceKm: moonRecord.distanceKm,
                    temperature: moonRecord.temperature,
                    textureKind: moonRecord.textureKind,
                    fill: moonRecord.fill,
                    fact: moonRecord.fact,
                    moons: undefined,
                });
            });

        return planet;
    });

    const sun = {
        id: 'sun',
        name: 'Sun',
        isSun: true,
        realRadiusKm: 696340,
        radiusUnits: SUN_RADIUS_UNITS,
        orbit: undefined,
        spinPeriodDays: 25.38,
        axialTiltRad: toRadians(7.25),
        worldPosition: [0, 0, 0],
        temperature: '5,505 °C surface',
        axialTiltDeg: 7.25,
        textureKind: 'sun',
        fill: '#ffb14d',
        fact: 'A G2V main-sequence star holding 99.86% of the system’s mass. Its light reaches Earth in 8 min 20 s.',
    };

    return {
        sun,
        planets,
        allBodies: [sun, ...planets.flatMap((planet) => [planet, ...planet.moons])],
    };
}