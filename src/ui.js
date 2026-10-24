/**
 * DOM overlay: jump-to bar, time-scale slider (real-time ↔ 1000 days/s on a
 * logarithmic curve), factoid panel, body labels and the simulation clock.
 */

const MIN_DAYS_PER_SECOND = 1 / 86400; // exactly 1 real second per second
const MAX_DAYS_PER_SECOND = 1000;
const LOG10_MIN = Math.log10(MIN_DAYS_PER_SECOND);
const LOG10_MAX = Math.log10(MAX_DAYS_PER_SECOND);

/**
 * Maps the 0–100 slider onto the logarithmic time-scale range.
 *
 * @param {number} sliderValue - Integer slider value in [0, 100].
 * @returns {number} Simulated days elapsing per real second.
 */
export function daysPerSecondFromSlider(sliderValue) {
    const t = Math.min(1, Math.max(0, sliderValue / 100));
    return 10 ** (LOG10_MIN + t * (LOG10_MAX - LOG10_MIN));
}

/**
 * Formats a days-per-second rate as a human-readable string.
 *
 * @param {number} daysPerSecond - Rate to format.
 * @returns {string} Short label, e.g. "2.9 d/s".
 */
export function formatDaysPerSecond(daysPerSecond) {
    if (daysPerSecond * 86400 < 1.5) {
        return '1 s/s (real time)';
    }
    if (daysPerSecond < 1 / 60) {
        return `${Math.round(daysPerSecond * 86400)} s/s`;
    }
    if (daysPerSecond < 90) {
        return `${daysPerSecond.toFixed(1)} d/s`;
    }
    return `${(daysPerSecond / 365.25).toFixed(1)} yr/s`;
}

/**
 * Formats elapsed simulation time since the J2000 epoch.
 *
 * @param {number} simDays - Days elapsed.
 * @returns {string} e.g. "J2000 + 2 yr 14 d".
 */
export function formatSimClock(simDays) {
    const wholeDays = Math.floor(simDays);
    const years = Math.floor(wholeDays / 365.25);
    const remainder = Math.floor(wholeDays % 365.25);
    return `J2000 + ${years} yr ${remainder} d`;
}

/**
 * Projects a world-space point into screen pixels, tolerating either the
 * object or array shape the context may return.
 *
 * @param {object} context - The ripl 3D context.
 * @param {[number, number, number]} point - World point.
 * @returns {{ x: number, y: number, depth: number }} Projected point.
 */
function projectToPoint(context, point) {
    const projected = context.project(point);
    if (Array.isArray(projected)) {
        return { x: projected[0], y: projected[1], depth: projected[2] };
    }
    return { x: projected.x, y: projected.y, depth: projected.depth ?? projected.z ?? 1 };
}

/**
 * Builds the whole HUD and returns its control API.
 *
 * @param {{ bodies: Map<string, object>, onJump: (id: string) => void,
 *           onSelect: (body: object) => void,
 *           setRenderNote: (text: string) => void }} parameters -
 *   Body map plus callbacks into the simulation.
 * @returns {object} Control API (see methods below).
 */
export function buildUi({ bodies, onJump, onSelect, setRenderNote }) {
    setRenderNote; // referenced for API completeness

    // ---- Jump bar ----
    const jumpContainer = document.getElementById('jump-buttons');
    const jumpButtons = new Map();
    const jumpOrder = ['sun', ...[...bodies.values()].filter((body) => !body.isSun && body.orbit).map((body) => body.id)];
    for (const bodyId of jumpOrder) {
        const body = bodies.get(bodyId);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = body.name;
        button.addEventListener('click', () => {
            onJump(bodyId);
            markActiveButton(bodyId);
        });
        jumpButtons.set(bodyId, button);
        jumpContainer.appendChild(button);
    }
    function markActiveButton(bodyId) {
        for (const [id, button] of jumpButtons) {
            button.classList.toggle('active', id === bodyId);
        }
    }
    const markJumpActive = markActiveButton;

    // ---- Time panel ----
    const slider = document.getElementById('time-scale');
    const readout = document.getElementById('time-readout');
    const pauseButton = document.getElementById('pause-button');
    const clock = document.getElementById('sim-clock');
    let paused = false;

    function refreshReadout() {
        readout.textContent = formatDaysPerSecond(daysPerSecondFromSlider(Number(slider.value)));
    }
    slider.addEventListener('input', refreshReadout);
    refreshReadout();

    function togglePause() {
        paused = !paused;
        pauseButton.textContent = paused ? 'Resume' : 'Pause';
    }
    pauseButton.addEventListener('click', togglePause);
    window.addEventListener('keydown', (event) => {
        if (event.key === ' ') {
            event.preventDefault();
            togglePause();
        }
    });

    // ---- Labels ----
    const labelLayer = document.getElementById('label-layer');
    const labels = new Map();
    for (const body of bodies.values()) {
        const label = document.createElement('div');
        label.className = `body-label${body.isSun ? '' : body.parent ? ' moon-label' : ''}`;
        label.textContent = body.name;
        label.addEventListener('click', () => {
            onSelect(body);
        });
        labelLayer.appendChild(label);
        labels.set(body.id, label);
    }
    function setActiveLabel(bodyId) {
        for (const [id, label] of labels) {
            label.classList.toggle('active', id === bodyId);
        }
    }

    // ---- Factoid panel ----
    const factoidPanel = document.getElementById('factoid');
    const factoidTitle = document.getElementById('factoid-title');
    const factoidDetails = document.getElementById('factoid-details');
    const factoidFact = document.getElementById('factoid-fact');
    document.getElementById('factoid-close').addEventListener('click', () => {
        factoidPanel.hidden = true;
    });

    function daysLabel(days) {
        return days < 1 ? `${Math.round(days * 24)} h` : `${days.toFixed(1)} d`;
    }

    function showFactoid(body) {
        factoidTitle.textContent = body.name;
        factoidDetails.innerHTML = '';
        const rows = [];
        rows.push(['Class', body.isSun ? 'G2V star' : body.parent ? `Moon of ${body.parentName}` : 'Planet']);
        rows.push(['Diameter', `${Math.round(body.realRadiusKm * 2).toLocaleString('en-US')} km`]);
        if (body.orbit) {
            rows.push(body.parent
                ? [`Distance from ${body.parentName}`, `${body.distanceKm.toLocaleString('en-US')} km`]
                : ['Distance from Sun', `${body.distanceAu.toFixed(3)} AU`]);
            rows.push(['Orbital period', body.orbit.periodDays > 365
                ? `${(body.orbit.periodDays / 365.25).toFixed(2)} yr`
                : daysLabel(body.orbit.periodDays)]);
        }
        if (!body.isSun) {
            rows.push(['Rotation period', daysLabel(Math.abs(body.spinPeriodDays))]);
        }
        rows.push(['Axial tilt', `${body.axialTiltDeg}°`]);
        rows.push(['Temperature', body.temperature]);
        if (!body.isSun && !body.parent) {
            rows.push(['Moons', String(body.moonCount)]);
        }
        for (const row of rows) {
            const term = document.createElement('dt');
            term.textContent = row[0];
            const detail = document.createElement('dd');
            detail.textContent = row[1];
            factoidDetails.append(term, detail);
        }
        factoidFact.textContent = body.fact;
        factoidPanel.hidden = false;
    }

    /**
     * Moves every label to its body's projected screen position and hides
     * labels behind the camera.
     *
     * @param {object} context - The ripl 3D context.
     * @returns {void}
     */
    function updateOverlays(context) {
        for (const [bodyId, body] of bodies) {
            const projected = projectToPoint(context, body.worldPosition);
            const label = labels.get(bodyId);
            const visible = !(Number.isFinite(projected.depth) && projected.depth <= 0);
            label.style.opacity = visible ? '' : '0';
            label.style.visibility = visible ? '' : 'hidden';
            label.style.left = `${projected.x}px`;
            label.style.top = `${projected.y}px`;
        }
        setActiveLabel; // keep reference stable for tree-shaking-free builds
    }

    /**
     * Refreshes the elapsed-time readout.
     *
     * @param {number} simDays - Days elapsed since J2000.
     * @returns {void}
     */
    function updateClock(simDays) {
        clock.textContent = formatSimClock(simDays);
    }

    return {
        getDaysPerSecond: () => daysPerSecondFromSlider(Number(slider.value)),
        isPaused: () => paused,
        showFactoid,
        updateOverlays,
        updateClock,
        markJumpActive,
    };
}