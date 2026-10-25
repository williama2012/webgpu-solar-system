/**
 * UI construction: pure DOM, no WebGPU and no per-frame render math.
 *
 * Builders committed in plan §2:
 * - createLabelLayer(labelContainerEl, bodies, onSelectBody)
 * - updateLabels(worldPositions, camera, simTimeSeconds?)
 * - createFactoidPopup(rootEl, onSelectClose) — factoid card per plan §5.4
 * - createTimeControls(containerEl, stateGetters/Setters)
 * - createJumpToGrid(containerEl, onFocusBody) — Sun/8 planets/Overview
 * - createScalePanel(containerEl, onScaleChange) — S / sun radius / p + reset
 * - createFpsReadout(el)
 * - showUnsupportedOverlay(el, supported)
 *
 * The only per-frame function is updateLabels; it positions labels with
 * math.projectWorldToScreen (the committed projection helper) and applies the
 * §6 rules: all planets+Sun always visible unless behind camera; moons only
 * when the camera is within 45 scene units of the parent or the parent is
 * selected.
 *
 * State kept module-local (label elements, selection name, popup root, time
 * slider) so the exported API matches the committed signatures.
 */
import { multiplyMatrices, projectWorldToScreen } from './math.js';
import {
  DISTANCE_POWER_DEFAULT,
  DISTANCE_POWER_MAX,
  DISTANCE_POWER_MIN,
  DISTANCE_POWER_STEP,
  MILLION_KILOMETER_PER_AU,
  PLANET_FACTOIDS,
  PLANET_SIZE_MULTIPLIER_DEFAULT,
  PLANET_SIZE_MULTIPLIER_MAX,
  PLANET_SIZE_MULTIPLIER_MIN,
  PLANET_SIZE_MULTIPLIER_STEP,
  PLANET_RECORDS,
  SECONDS_PER_DAY,
  SECONDS_PER_JULIAN_YEAR,
  SUN_DISPLAY_RADIUS_DEFAULT,
  SUN_DISPLAY_RADIUS_MAX,
  SUN_DISPLAY_RADIUS_MIN,
  SUN_RECORD,
  TIME_SCALE_MAX_SECONDS_PER_SECOND,
  MOON_RECORDS,
} from './constants.js';

/* ========================== Shared helpers ========================= */

/**
 * Whole-number with thousands separators (en-US).
 * @param {number} value - number to format.
 * @returns {string} e.g. "1,392,700".
 */
function formatThousands(value) {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Orbital-period readout: days under ~1000 d, years beyond (plan §5.4 "days
 * or years, whichever reads better").
 * @param {number} periodDays - sidereal period in days.
 * @returns {string}
 */
function formatOrbitalPeriod(periodDays) {
  if (periodDays < 1000) return `${formatThousands(periodDays)} days`;
  const years = periodDays / SECONDS_PER_JULIAN_YEAR * SECONDS_PER_DAY; // days→years via Julian year
  return `${years.toFixed(1)} years`;
}

/* ========================== Label layer =========================== */

/** Scene units: moons go visible within this camera distance to their parent. */
const MOON_LABEL_LOD_DISTANCE = 45;

/** Label layer container element (set by createLabelLayer). @type {HTMLElement|null} */
let labelLayerElement = null;

/** Per-body label bookkeeping, keyed by body name. @type {Map<string, {element: HTMLElement, body: object}>} */
const labelEntries = new Map();

/** Currently selected body name (drives moon LOD); null when none. @type {string|null} */
let labelSelectionName = null;

/**
 * Build one .body-label div per scene body (accent = body.labelColor,
 * click → onSelectBodyName). Moon labels follow their parent, planet/Sun
 * labels sit above the viewport.
 *
 * @param {HTMLElement} containerElement - #label-layer (pointer-events off; children auto).
 * @param {Array<object>} bodiesArray - scene.bodies from createSolarSystem (live reference).
 * @param {(bodyName: string) => void} onSelectBodyName - fired with the clicked body's name.
 * @returns {void}
 */
export function createLabelLayer(containerElement, bodiesArray, onSelectBodyName) {
  labelLayerElement = containerElement;
  containerElement.replaceChildren();
  labelEntries.clear();
  for (const body of bodiesArray) {
    const element = document.createElement('div');
    element.className = 'body-label';
    element.textContent = body.name;
    element.style.setProperty('--label-color', body.labelColor);
    element.addEventListener('click', () => {
      onSelectBodyName(body.name);
    });
    containerElement.appendChild(element);
    labelEntries.set(body.name, { element, body });
  }
}

/**
 * Tell the label layer which body is selected (moon LOD: parent selected →
 * that parent's moons stay visible). Pass null to clear.
 * @param {string|null} bodyName - scene body name or null.
 * @returns {void}
 */
export function setLabelSelection(bodyName) {
  labelSelectionName = bodyName;
}

/**
 * Per-frame label update (plan §2/§6): project each visible body, hide when
 * behind camera or off-screen; hide moons unless (camera within 45 u of the
 * parent) OR (parent selected). Positions via CSS transform so no layout
 * invalidation beyond the 21 labels.
 *
 * @param {Map<string, [number, number, number]>} worldPositions - live scene positions (name → [x,y,z]).
 * @param {import('./camera-controls.js').OrbitCamera} camera - live OrbitCamera (view/projection + eye distance).
 * @param {number} [_simTimeSeconds] - reserved for future use; labels do not depend on time.
 * @returns {void}
 */
export function updateLabels(worldPositions, camera, _simTimeSeconds) {
  if (!labelLayerElement || labelEntries.size === 0) return;
  const widthPx = Math.max(1, labelLayerElement.clientWidth);
  const heightPx = Math.max(1, labelLayerElement.clientHeight);
  const aspectRatio = widthPx / heightPx;
  const viewProjectionMatrix = multiplyMatrices(camera.getProjectionMatrix(aspectRatio), camera.getViewMatrix());
  for (const [name, entry] of labelEntries) {
    const worldPosition = worldPositions.get(name);
    if (!worldPosition) {
      entry.element.style.display = 'none';
      continue;
    }
    let visible = !isWorldPointBehindCamera({ x: worldPosition[0], y: worldPosition[1], z: worldPosition[2] }, viewProjectionMatrix, widthPx, heightPx);
    if (visible && entry.body.kind === 'moon') {
      const parentPosition = worldPositions.get(entry.body.parentName);
      visible = camera.getDistanceTo({ x: parentPosition[0], y: parentPosition[1], z: parentPosition[2] }) < MOON_LABEL_LOD_DISTANCE || labelSelectionName === entry.body.parentName;
    }
    if (visible) {
      const projected = projectWorldToScreen({ x: worldPosition[0], y: worldPosition[1], z: worldPosition[2] }, viewProjectionMatrix, widthPx, heightPx);
      entry.element.style.display = '';
      entry.element.style.transform = `translate3d(${projected.xPixels.toFixed(1)}px, ${projected.yPixels.toFixed(1)}px, 0) translate(-50%, -140%)`;
    } else {
      entry.element.style.display = 'none';
    }
  }
}

/**
 * Camera-behind test shared by updateLabels (projectWorldToScreen returns a
 * flag but labels also cull off-screen). Returns true when the point must be
 * hidden.
 *
 * @param {{x:number,y:number,z:number}} worldPoint - scene position.
 * @param {Float32Array} viewProjectionMatrix - P·V (column-major 4×4).
 * @param {number} viewportWidthPx - label-layer CSS width.
 * @param {number} viewportHeightPx - label-layer CSS height.
 * @returns {boolean} true → hide the label.
 */
function isWorldPointBehindCamera(worldPoint, viewProjectionMatrix, viewportWidthPx, viewportHeightPx) {
  const projected = projectWorldToScreen(worldPoint, viewProjectionMatrix, viewportWidthPx, viewportHeightPx);
  if (projected.isBehindCamera) return true;
  return projected.xPixels < -60 || projected.xPixels > viewportWidthPx + 60 || projected.yPixels < -60 || projected.yPixels > viewportHeightPx + 60;
}

/* ========================== Factoid popup ========================= */

/** Popup root element (#factoid-popup). @type {HTMLElement|null} */
let factoidRootElement = null;

/** Dismiss callback wired by createFactoidPopup. @type {() => void}|null */
let onFactoidDismiss = null;

/**
 * Wire the #factoid-popup card (plan §5.4). The close button calls
 * onSelectClose; open/close are driven through showFactoidCard/hideFactoidCard.
 *
 * @param {HTMLElement} rootElement - #factoid-popup.
 * @param {() => void} onSelectClose - fires when the user dismisses (main releases focus).
 * @returns {void}
 */
export function createFactoidPopup(rootElement, onSelectClose) {
  factoidRootElement = rootElement;
  onFactoidDismiss = onSelectClose;
  const closeButton = document.createElement('button');
  closeButton.id = 'popup-close-button';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close body details');
  closeButton.textContent = '×';
  closeButton.addEventListener('click', () => {
    hideFactoidCard();
  });
  rootElement.replaceChildren(closeButton);
}

/**
 * Fill + show the factoid card for a scene body (Sun/planet/moon rules from
 * plan §5.4; data from src/constants.js, never fabricated).
 *
 * @param {string} bodyName - scene body name ("Sun", "Earth", "Triton", …).
 * @returns {void}
 */
export function showFactoidCard(bodyName) {
  if (!factoidRootElement || !bodyName) return;
  const cardData = buildFactoidCardData(bodyName);
  if (!cardData) return;
  const rootElement = factoidRootElement;
  rootElement.replaceChildren(rootElement.querySelector('#popup-close-button'));
  const title = document.createElement('h2');
  title.textContent = cardData.title;
  const typeLine = document.createElement('span');
  typeLine.className = 'fact-type';
  typeLine.textContent = cardData.typeText;
  const grid = document.createElement('dl');
  grid.className = 'fact-grid';
  for (const row of cardData.rows) {
    const term = document.createElement('dt');
    term.textContent = row.label;
    const detail = document.createElement('dd');
    detail.textContent = row.value;
    grid.append(term, detail);
  }
  rootElement.append(title, typeLine, grid);
  for (const line of cardData.triviaLines) {
    const trivia = document.createElement('p');
    trivia.className = 'fact-trivia';
    trivia.textContent = line;
    rootElement.appendChild(trivia);
  }
  rootElement.hidden = false;
}

/**
 * Hide the factoid card (main also releases camera focus / clears selection).
 * @returns {void}
 */
export function hideFactoidCard() {
  if (!factoidRootElement) return;
  factoidRootElement.hidden = true;
  if (typeof onFactoidDismiss === 'function') onFactoidDismiss();
}

/**
 * Compose the card rows for a body; null when the name is unknown.
 * Sun: type/diameter/surface temp/age + trivia. Planets: type, diameter,
 * distance from Sun (AU + × Mm km), orbital period (days or years), surface
 * temperature, moon count, day length + one trivia line. Moons: parent,
 * diameter, distance from planet (km), orbital period, surface temperature
 * + trivia.
 *
 * @param {string} bodyName - scene body name.
 * @returns {{title: string, typeText: string, rows: Array<{label: string, value: string}>, triviaLines: Array<string>}|null}
 */
function buildFactoidCardData(bodyName) {
  if (bodyName === 'Sun') {
    const record = SUN_RECORD;
    return {
      title: 'Sun',
      typeText: `Type: ${record.type}`,
      rows: [
        { label: 'Diameter', value: `${formatThousands(record.diameterKm)} km` },
        { label: 'Surface temperature', value: record.surfaceTemperatureDisplay },
        { label: 'Age', value: record.ageDisplay },
      ],
      triviaLines: [...record.trivia],
    };
  }
  const planetRecord = PLANET_RECORDS.find((candidate) => candidate.name === bodyName);
  if (planetRecord) {
    const facts = PLANET_FACTOIDS[bodyName];
    return {
      title: bodyName,
      typeText: `Type: ${facts.type}`,
      rows: [
        { label: 'Diameter', value: `${formatThousands(2 * planetRecord.radiusKm)} km` },
        {
          label: 'Distance from Sun',
          value: `${planetRecord.aAU} AU (${(planetRecord.aAU * MILLION_KILOMETER_PER_AU).toFixed(1)} Mm km)`,
        },
        { label: 'Orbital period', value: formatOrbitalPeriod(planetRecord.periodDays) },
        { label: 'Surface temperature', value: facts.surfaceTemperatureDisplay },
        { label: 'Moons', value: facts.moonCountDisplay },
        { label: 'Day length', value: facts.dayLengthDisplay },
      ],
      triviaLines: [...facts.trivia],
    };
  }
  const moonRecord = MOON_RECORDS.find((candidate) => candidate.name === bodyName);
  if (moonRecord) {
    return {
      title: bodyName,
      typeText: `Type: Moon of ${moonRecord.parentName}`,
      rows: [
        { label: 'Parent', value: moonRecord.parentName },
        { label: 'Diameter', value: `${formatThousands(2 * moonRecord.radiusKm)} km` },
        { label: 'Distance from planet', value: `${formatThousands(moonRecord.aMmkm * 1_000_000)} km` },
        { label: 'Orbital period', value: formatOrbitalPeriod(moonRecord.periodDays) },
        { label: 'Surface temperature', value: moonRecord.temperatureDisplay },
      ],
      triviaLines: [...moonRecord.trivia],
    };
  }
  return null;
}

/* ========================== Time controls ========================= */

/** Slider domain exponent for TIME_SCALE_MAX_SECONDS_PER_SECOND (log10 of it). */
const TIME_SLIDER_DOMAIN_LOG10 = Math.log10(TIME_SCALE_MAX_SECONDS_PER_SECOND);

/**
 * Build the time-scale widget into containerElement (plan §2): slider +
 * readout, pause toggle, and the five preset chips (1× / 1 day/s /
 * 1 month/s / 1 year/s / 100 yr/s). The slider is logarithmic: position t
 * maps to multiplier 10^(t·log10(max)) so 1× sits at the far left and
 * 100 yr/s at the far right.
 *
 * @param {HTMLElement} containerElement - #time-controls section.
 * @param {{getTimeScaleMultiplier: () => number, setTimeScaleMultiplier: (m: number) => void, isPaused: () => boolean, setPaused: (paused: boolean) => void}} stateGettersSetters -
 *   main-owned time state; the widget reads on init and writes through these.
 * @returns {void}
 */
export function createTimeControls(containerElement, stateGettersSetters) {
  containerElement.replaceChildren();

  const sliderRow = document.createElement('div');
  sliderRow.className = 'slider-row';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.001';
  slider.setAttribute('aria-label', 'Time scale');
  const readout = document.createElement('span');
  readout.className = 'time-readout';
  sliderRow.append(slider, readout);

  const pauseButton = document.createElement('button');
  pauseButton.id = 'pause-toggle';
  pauseButton.type = 'button';
  const chipRow = document.createElement('div');
  chipRow.className = 'chip-row';

  const presets = [
    { label: '1×', multiplier: 1 },
    { label: '1 day/s', multiplier: SECONDS_PER_DAY },
    { label: '1 month/s', multiplier: 30 * SECONDS_PER_DAY },
    { label: '1 year/s', multiplier: SECONDS_PER_JULIAN_YEAR },
    { label: '100 yr/s', multiplier: TIME_SCALE_MAX_SECONDS_PER_SECOND },
  ];

  function sliderPositionForMultiplier(multiplier) {
    return Math.log10(multiplier) / TIME_SLIDER_DOMAIN_LOG10;
  }

  function refresh() {
    const multiplier = stateGettersSetters.getTimeScaleMultiplier();
    slider.value = String(sliderPositionForMultiplier(multiplier));
    readout.textContent = formatTimeReadout(multiplier);
    for (const preset of presets) {
      preset.chip.classList.toggle('is-active', Math.abs(sliderPositionForMultiplier(multiplier) - sliderPositionForMultiplier(preset.multiplier)) < 0.01);
    }
    pauseButton.textContent = stateGettersSetters.isPaused() ? '▶ Resume' : '⏸ Pause';
    pauseButton.classList.toggle('is-active', stateGettersSetters.isPaused());
  }

  function setMultiplier(multiplier) {
    const clamped = Math.min(Math.max(multiplier, 1), TIME_SCALE_MAX_SECONDS_PER_SECOND);
    stateGettersSetters.setTimeScaleMultiplier(clamped);
    refresh();
  }

  slider.addEventListener('input', () => {
    setMultiplier(10 ** (parseFloat(slider.value) * TIME_SLIDER_DOMAIN_LOG10));
  });
  pauseButton.addEventListener('click', () => {
    stateGettersSetters.setPaused(!stateGettersSetters.isPaused());
    refresh();
  });

  for (const preset of presets) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = preset.label;
    chip.addEventListener('click', () => setMultiplier(preset.multiplier));
    preset.chip = chip;
    chipRow.appendChild(chip);
  }

  containerElement.append(sliderRow, pauseButton, chipRow);
  refresh();
}

/**
 * Readout formatting per plan §6: s/s below an hour, h/s below a day,
 * d/s below a year, else yr/s.
 *
 * @param {number} multiplier - simulated seconds per wall second (≥ 1).
 * @returns {string}
 */
function formatTimeReadout(multiplier) {
  if (multiplier < 3600) return `${trimNumber(multiplier)} s/s`;
  if (multiplier < SECONDS_PER_DAY) return `${trimNumber(multiplier / 3600)} h/s`;
  if (multiplier < SECONDS_PER_JULIAN_YEAR) return `${trimNumber(multiplier / SECONDS_PER_DAY)} d/s`;
  return `${trimNumber(multiplier / SECONDS_PER_JULIAN_YEAR)} yr/s`;
}

/**
 * Trim a magnitude for the readout (1, 3.5, 22, 87). Not exported: internal.
 * @param {number} value - value in the chosen unit.
 * @returns {string}
 */
function trimNumber(value) {
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return String(Number(value.toFixed(1)));
  return String(Number(value.toFixed(2)));
}

/* ========================== Jump-to grid ========================= */

/**
 * Build the Jump To grid: "☀ Sun", the eight planet names, and "Overview"
 * (releases focus). Each click fires onJumpToBodyName(name) — or null for
 * Overview. Buttons gain .is-focused via setFocusedJumpBody as main selects.
 *
 * @param {HTMLElement} containerElement - #jump-to-grid section.
 * @param {(bodyName: string|null) => void} onJumpToBodyName - main's focus/release handler.
 * @returns {{setFocusedBodyName: (bodyName: string|null) => void}}
 */
export function createJumpToGrid(containerElement, onJumpToBodyName) {
  containerElement.replaceChildren();
  const buttonsByName = new Map();
  const entries = [{ label: '☀ Sun', name: 'Sun' }, ...PLANET_RECORDS.map((record) => ({ label: record.name, name: record.name })), { label: 'Overview', name: null }];
  for (const entry of entries) {
    const button = document.createElement('button');
    button.className = 'jump-button';
    button.type = 'button';
    button.textContent = entry.label;
    button.addEventListener('click', () => onJumpToBodyName(entry.name));
    containerElement.appendChild(button);
    buttonsByName.set(entry.name, button);
  }
  return {
    setFocusedBodyName(bodyName) {
      for (const [name, button] of buttonsByName) {
        button.classList.toggle('is-focused', name !== null && name === bodyName);
      }
    },
  };
}

/* ========================== Scale panel ========================= */

/**
 * Build the Scale & Distance sliders into containerElement (inside the
 * <details> from index.html): planet size multiplier S (10..300, step 5,
 * default 40), Sun display radius (1..20, default 5), distance exponent p
 * (0.4..0.8, step 0.05, default 0.5), and a reset button (#scale-reset). Every
 * change fires onApplyScale with the full {planetSizeMultiplier,
 * sunDisplayRadius, distancePower} object so main can call applySceneScale.
 *
 * @param {HTMLElement} containerElement - #scale-controls div.
 * @param {(values: {planetSizeMultiplier: number, sunDisplayRadius: number, distancePower: number}) => void} onApplyScale - rebuild callback (main → applySceneScale).
 * @returns {{getValues: () => {planetSizeMultiplier: number, sunDisplayRadius: number, distancePower: number}}}
 */
export function createScalePanel(containerElement, onApplyScale) {
  containerElement.replaceChildren();
  const values = {
    planetSizeMultiplier: PLANET_SIZE_MULTIPLIER_DEFAULT,
    sunDisplayRadius: SUN_DISPLAY_RADIUS_DEFAULT,
    distancePower: DISTANCE_POWER_DEFAULT,
  };

  function emit() {
    onApplyScale({ ...values });
  }

  const rows = [
    {
      key: 'planetSizeMultiplier',
      label: 'Planet size',
      min: PLANET_SIZE_MULTIPLIER_MIN,
      max: PLANET_SIZE_MULTIPLIER_MAX,
      step: PLANET_SIZE_MULTIPLIER_STEP,
      format: (value) => `×${value}`,
    },
    {
      key: 'sunDisplayRadius',
      label: 'Sun radius',
      min: SUN_DISPLAY_RADIUS_MIN,
      max: SUN_DISPLAY_RADIUS_MAX,
      step: 1,
      format: (value) => `r ${value}`,
    },
    {
      key: 'distancePower',
      label: 'Distance exponent',
      min: DISTANCE_POWER_MIN,
      max: DISTANCE_POWER_MAX,
      step: DISTANCE_POWER_STEP,
      format: (value) => `p ${value.toFixed(2)}`,
    },
  ];

  const slidersByKey = new Map();
  for (const row of rows) {
    const wrap = document.createElement('div');
    wrap.className = 'scale-row';
    const label = document.createElement('label');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${row.label} `;
    const valueSpan = document.createElement('span');
    valueSpan.textContent = row.format(values[row.key]);
    label.append(nameSpan, valueSpan);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(row.min);
    input.max = String(row.max);
    input.step = String(row.step);
    input.value = String(values[row.key]);
    input.setAttribute('aria-label', row.label);
    input.addEventListener('input', () => {
      values[row.key] = parseFloat(input.value);
      valueSpan.textContent = row.format(values[row.key]);
      emit();
    });
    wrap.append(label, input);
    containerElement.appendChild(wrap);
    slidersByKey.set(row.key, { input, valueSpan, row });
  }

  const resetButton = document.createElement('button');
  resetButton.id = 'scale-reset';
  resetButton.className = 'jump-button';
  resetButton.type = 'button';
  resetButton.textContent = 'Reset to defaults';
  resetButton.addEventListener('click', () => {
    values.planetSizeMultiplier = PLANET_SIZE_MULTIPLIER_DEFAULT;
    values.sunDisplayRadius = SUN_DISPLAY_RADIUS_DEFAULT;
    values.distancePower = DISTANCE_POWER_DEFAULT;
    for (const { input, valueSpan, row } of slidersByKey.values()) {
      input.value = String(values[row.key]);
      valueSpan.textContent = row.format(values[row.key]);
    }
    emit();
  });
  containerElement.appendChild(resetButton);

  return {
    getValues() {
      return { ...values };
    },
  };
}

/* ========================== FPS readout ========================= */

/**
 * Build the #fps-readout refresher (plan §2). report(elapsedMs) is called
 * once per frame; the text updates at most twice a second.
 *
 * @param {HTMLElement} element - #fps-readout.
 * @returns {{report: (elapsedMs: number) => void}}
 */
export function createFpsReadout(element) {
  let framesSinceUpdate = 0;
  let windowStartMs = performance.now();
  return {
    report(elapsedMs) {
      framesSinceUpdate += 1;
      const now = performance.now();
      if (now - windowStartMs < 500 || elapsedMs <= 0) return;
      element.textContent = `${Math.round((framesSinceUpdate * 1000) / (now - windowStartMs))} fps`;
      windowStartMs = now;
      framesSinceUpdate = 0;
    },
  };
}

/* ====================== Unsupported overlay ===================== */

/**
 * Show the full-screen #unsupported-overlay card only when WebGPU is
 * unavailable or init fails (plan §2). main edits the card text before
 * unhiding for device-lost/validation fatal errors.
 *
 * @param {HTMLElement} overlayElement - #unsupported-overlay.
 * @param {boolean} supported - false → unhide the overlay; true → hide it again.
 * @returns {void}
 */
export function showUnsupportedOverlay(overlayElement, supported) {
  overlayElement.hidden = supported !== false;
}
