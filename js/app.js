/* app.js
 * Boots the page, owns the clock, and glues scene ↔ camera ↔ UI.
 * The single shared clock `simDays` drives OrbitMech, so planets, moons, spins and the
 * time-scale slider all stay in exact real ratio to each other.
 */

const App = {
  canvas: null,
  labels: {},
  simDays: 0,
  daysPerSecond: 30,          /* default: one "week of the solar system" per ~27 s */
  paused: false,
  focusedBody: null,
  lastFrameMs: 0,

  async start() {
    this.canvas = document.getElementById('scene');
    this.camera = new OrbitCamera();
    this.camera.attach(this.canvas);

    if (!navigator.gpu) {
      document.getElementById('nogl').style.display = 'block';
      return;
    }

    const progress = document.getElementById('progress');
    const progressText = document.getElementById('progressText');
    const report = (fraction) => {
      progressText.textContent = 'Painting planets… ' + Math.round(fraction * 100) + '%';
    };

    report(0);
    const ok = await Scene.init(this.canvas);
    if (!ok) {
      document.getElementById('nogl').style.display = 'block';
      document.getElementById('nogl').textContent = 'No WebGPU adapter — use a recent Chrome/Edge/Safari build.';
      return;
    }
    await Scene.build(report);

    this.canvas.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.resize();

    this.buildLabels();
    this.buildJumpList();
    this.buildTimeControls();

    this.lastFrameMs = performance.now();
    requestAnimationFrame((timestamp) => this.loop(timestamp));
  },

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(2, Math.floor(rect.width * devicePixelRatio));
    this.canvas.height = Math.max(2, Math.floor(rect.height * devicePixelRatio));
  },

  loop(timestamp) {
    const deltaSeconds = Math.min(0.1, (timestamp - this.lastFrameMs) / 1000);
    this.lastFrameMs = timestamp;
    Scene.realSeconds += deltaSeconds;
    if (!this.paused) { this.simDays += deltaSeconds * this.daysPerSecond; }

    const focusPosition = this.focusedBody
      ? this.focusedBody.position
      : null;
    this.camera.update(deltaSeconds, focusPosition);
    Scene.update(this.simDays);
    Scene.render(this.camera);
    this.updateLabels();
    requestAnimationFrame((t) => this.loop(t));
  },

  /* ---------------- labels ---------------- */

  buildLabels() {
    const layer = document.getElementById('labels');
    for (const bodyId of Object.keys(Scene.bodies)) {
      const record = Scene.bodies[bodyId];
      const label = document.createElement('div');
      label.className = 'label' + (record.data.kind === 'Natural satellite' ? ' label-moon' : '');
      label.textContent = record.data.name;
      label.style.color = record.labelColor;
      label.addEventListener('click', () => this.focusOn(record));
      layer.appendChild(label);
      this.labels[bodyId] = label;
    }
  },

  updateLabels() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    for (const bodyId of Object.keys(Scene.bodies)) {
      const record = Scene.bodies[bodyId];
      const isMoon = record.data.kind === 'Natural satellite';
      const parentRecord = isMoon ? Scene.bodies[record.data.parentId] : null;
      /* Moon labels only near their parent (or when focused) to avoid clutter. */
      if (isMoon && this.focusedBody !== record && !this.isNear(parentRecord)) {
        this.labels[bodyId].style.display = 'none';
        continue;
      }
      const projected = this.camera.project(record.position, width, height);
      if (!projected.visible) { this.labels[bodyId].style.display = 'none'; continue; }
      /* Hover the label just above the body's screen radius. */
      const screenRadius = this.screenRadius(record, projected.x, projected.y, width, height);
      this.labels[bodyId].style.display = 'block';
      this.labels[bodyId].style.transform =
        'translate(' + Math.round(projected.x) + 'px,' + Math.round(projected.y - screenRadius * 1.25 - 10) + 'px) translate(-50%,-100%)';
    }
  },

  isNear(body) {
    if (!body) { return false; }
    return Math.hypot(
      this.camera.position[0] - body.position[0],
      this.camera.position[1] - body.position[1],
      this.camera.position[2] - body.position[2]) < 55;
  },

  screenRadius(record, x, y, width, height) {
    /* Project a point offset by the body radius to get a pixel radius. */
    const probe = this.camera.project([
      record.position[0] + record.radius, record.position[1], record.position[2]
    ], width, height);
    return Math.max(2, Math.hypot(probe.x - x, probe.y - y));
  },

  /* ---------------- focus / picking ---------------- */

  focusOn(record) {
    this.focusedBody = record;
    this.camera.followBody(record);
    this.showPanel(record);
  },

  pick(screenX, screenY) {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const ndcX = (screenX / width) * 2 - 1;
    const ndcY = 1 - (screenY / height) * 2;
    const tanHalfFov = Math.tan((this.camera.fovDegrees * Math.PI / 180) / 2);
    const aspect = width / height;
    const dir = OrbitCamera.normalize([
      this.camera.forward[0] + this.camera.right[0] * ndcX * tanHalfFov * aspect + this.camera.up[0] * ndcY * tanHalfFov,
      this.camera.forward[1] + this.camera.right[1] * ndcX * tanHalfFov * aspect + this.camera.up[1] * ndcY * tanHalfFov,
      this.camera.forward[2] + this.camera.right[2] * ndcX * tanHalfFov * aspect + this.camera.up[2] * ndcY * tanHalfFov
    ]);
    const origin = this.camera.position;
    let best = null;
    for (const bodyId of Object.keys(Scene.bodies)) {
      const record = Scene.bodies[bodyId];
      const pickRadius = Math.max(record.radius, 0.5);   /* generous grab radius for small bodies */
      const ox = origin[0] - record.position[0];
      const oy = origin[1] - record.position[1];
      const oz = origin[2] - record.position[2];
      const b = 2 * (ox * dir[0] + oy * dir[1] + oz * dir[2]);
      const c = ox * ox + oy * oy + oz * oz - pickRadius * pickRadius;
      const disc = b * b - 4 * c;
      if (disc <= 0) { continue; }
      const root = Math.sqrt(disc);
      const near = (-b - root) / 2;
      if (near > 0 && (!best || near < best.near)) { best = { record, near }; }
    }
    return best ? best.record : null;
  },

  /* ---------------- factoid popup ---------------- */

  showPanel(record) {
    const panel = document.getElementById('infoPanel');
    const d = record.data;
    const rows = [];
    const push = (k, v) => { if (v) { rows.push('<tr><td>' + k + '</td><td>' + v + '</td></tr>'); } };
    push('Type', d.kind);
    push('Diameter', (d.diameterKm ? d.diameterKm.toLocaleString() + ' km' : (d.radiusKm * 2).toLocaleString() + ' km'));
    push('Distance', d.id === 'sun' ? '—' : (d.distanceText || d.distanceFromParentText || ''));
    push('Orbit', d.id === 'sun' ? d.rotationPeriodDays ? 'rotates in ~25.4 d' : '—' : (d.periodText || (d.orbitalPeriodDays + ' days') + (d.orbitSign === -1 ? ' · retrograde' : '')));
    push('Spin', d.spinText || '');
    push('Tilt', d.tiltText || '');
    push('Temperature', d.temperatureText || '');
    push('Moons', d.moonsCount !== undefined ? d.moonsCount + ' (' + d.moonListText + ')' : '');
    panel.querySelector('h2').textContent = d.name;
    panel.querySelector('table').innerHTML = rows.join('');
    panel.querySelector('p').textContent = d.blurb || '';
    panel.style.display = 'block';
  },

  hidePanel() { document.getElementById('infoPanel').style.display = 'none'; },

  /* ---------------- UI builders ---------------- */

  buildJumpList() {
    const list = document.getElementById('jumpList');
    const entries = [SolarData.sun].concat(SolarData.planets);
    for (const entry of entries) {
      const button = document.createElement('button');
      button.className = 'jump-button' + (entry.id === 'sun' ? ' jump-sun' : '');
      button.textContent = entry.name;
      button.addEventListener('click', () => this.focusOn(Scene.bodies[entry.id]));
      list.appendChild(button);
    }
  },

  buildTimeControls() {
    const slider = document.getElementById('timeScale');
    const readout = document.getElementById('timeReadout');
    const pauseButton = document.getElementById('pauseButton');

    const applySlider = () => {
      /* Logarithmic: real-time (1 s/s = 1/86400 d/s) up to 1000 days/s. */
      const normalized = Number(slider.value) / 1000;
      const minLog = Math.log10(1 / 86400);
      const maxLog = Math.log10(1000);
      this.daysPerSecond = Math.pow(10, minLog + normalized * (maxLog - minLog));
      readout.textContent = this.formatRate(this.daysPerSecond);
    };
    slider.addEventListener('input', applySlider);
    applySlider();

    pauseButton.addEventListener('click', () => {
      this.paused = !this.paused;
      pauseButton.textContent = this.paused ? '▶ Resume' : '❚❚ Pause';
    });
  },

  formatRate(daysPerSecond) {
    if (daysPerSecond < 0.001) {
      return (1 / daysPerSecond).toFixed(0) + ' s/s (real time)';
    }
    if (daysPerSecond < 1) { return (daysPerSecond * 86400).toFixed(0) + ' s/s'; }
    const text = daysPerSecond.toFixed(daysPerSecond < 10 ? 2 : 0) + ' days/s';
    if (daysPerSecond > 365) { return text + ' (' + (daysPerSecond / 365.25).toFixed(1) + ' yr/s)'; }
    return text;
  }
};

document.addEventListener('DOMContentLoaded', () => { App.start(); });