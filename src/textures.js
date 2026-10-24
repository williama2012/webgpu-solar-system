/**
 * Procedural equirectangular texture painting. Every planet/moon gets a
 * 512–1024 px canvas texture generated at startup, so the scene needs no
 * external image files. All drawing is seeded, so results are stable per
 * run. Patterns stay 20 px away from the horizontal seam so the texture
 * wraps cleanly onto the sphere.
 */

/**
 * Small deterministic PRNG (mulberry32).
 *
 * @param {number} seed - 32-bit seed.
 * @returns {() => number} Function returning floats in [0, 1).
 */
function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ 0;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Paints horizontal atmosphere bands with a soft wavy top edge.
 *
 * @param {CanvasRenderingContext2D} context2d - Target canvas context.
 * @param {number} width - Texture width.
 * @param {number} height - Texture height.
 * @param {string[]} colors - Band colours, cycled.
 * @param {number} bandHeight - Height of one band row in px.
 * @param {number} wobble - Vertical wobble amplitude in px.
 * @returns {void}
 */
function drawBands(context2d, width, height, colors, bandHeight, wobble) {
    for (let y = 0, index = 0; y < height; y += bandHeight, index += 1) {
        context2d.globalAlpha = 0.85;
        context2d.fillStyle = colors[index % colors.length];
        context2d.beginPath();
        context2d.moveTo(-4, y);
        for (let x = 0; x <= width + 8; x += 24) {
            context2d.lineTo(x, y + Math.sin(x * 0.02 + index * 1.7) * wobble);
        }
        context2d.lineTo(width + 4, y + bandHeight);
        context2d.lineTo(-4, y + bandHeight);
        context2d.closePath();
        context2d.fill();
    }
    context2d.globalAlpha = 1;
}

/**
 * Paints random circular impact craters with a light rim.
 *
 * @param {CanvasRenderingContext2D} context2d - Target context.
 * @param {number} width - Texture width.
 * @param {number} height - Texture height.
 * @param {number} count - Number of craters.
 * @param {() => number} random - Seeded random source.
 * @returns {void}
 */
function drawCraters(context2d, width, height, count, random) {
    for (let i = 0; i < count; i += 1) {
        const x = 20 + random() * (width - 40);
        const y = 20 + random() * (height - 40);
        const radius = 1.5 + random() * 6;
        context2d.globalAlpha = 0.5;
        context2d.fillStyle = 'rgba(0, 0, 0, 0.35)';
        context2d.beginPath();
        context2d.arc(x, y, radius, 0, TWO_PI_LOCAL);
        context2d.fill();
        context2d.globalAlpha = 0.35;
        context2d.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        context2d.lineWidth = 1;
        context2d.beginPath();
        context2d.arc(x, y, radius, Math.PI * 0.7, Math.PI * 1.7);
        context2d.stroke();
    }
    context2d.globalAlpha = 1;
}
const TWO_PI_LOCAL = Math.PI * 2;

/**
 * Paints soft blurred ellipses (continents / maria / blotches).
 *
 * @param {CanvasRenderingContext2D} context2d - Target context.
 * @param {number} width - Texture width.
 * @param {number} height - Texture height.
 * @param {number} count - Number of blobs.
 * @param {string} color - Fill colour.
 * @param {number} minRadius - Smallest blob radius.
 * @param {number} maxRadius - Largest blob radius.
 * @param {() => number} random - Seeded random source.
 * @returns {void}
 */
function drawBlobs(context2d, width, height, count, color, minRadius, maxRadius, random) {
    context2d.fillStyle = color;
    for (let i = 0; i < count; i += 1) {
        const x = 20 + random() * (width - 40);
        const y = 24 + random() * (height - 48);
        const radius = minRadius + random() * (maxRadius - minRadius);
        context2d.globalAlpha = 0.5;
        context2d.beginPath();
        context2d.ellipse(x, y, radius * 1.6, radius, random() * Math.PI, 0, TWO_PI_LOCAL);
        context2d.fill();
    }
    context2d.globalAlpha = 1;
}

/**
 * Paints the bright polar ice caps top and bottom of the texture.
 *
 * @param {CanvasRenderingContext2D} context2d - Target context.
 * @param {number} width - Texture width.
 * @param {number} height - Texture height.
 * @param {number} capHeight - Cap band height in px.
 * @returns {void}
 */
function drawPolarCaps(context2d, width, height, capHeight) {
    context2d.fillStyle = 'rgba(250, 252, 255, 0.9)';
    context2d.fillRect(0, 0, width, capHeight);
    context2d.fillRect(0, height - capHeight, width, capHeight);
    context2d.fillStyle = 'rgba(250, 252, 255, 0.4)';
    context2d.fillRect(0, capHeight, width, 4);
    context2d.fillRect(0, height - capHeight - 4, width, 4);
}

/**
 * Paints a starfield skybox texture: dense small stars plus a few bright
 * ones with a soft cross flare.
 *
 * @param {CanvasRenderingContext2D} context2d - Target context.
 * @param {number} width - Texture width.
 * @param {number} height - Texture height.
 * @param {() => number} random - Seeded random source.
 * @returns {void}
 */
function drawStarfield(context2d, width, height, random) {
    context2d.fillStyle = '#050a14';
    context2d.fillRect(0, 0, width, height);
    const starColors = ['#ffffff', '#cdd8ff', '#ffe9c8', '#ffffff'];
    for (let i = 0; i < 420; i += 1) {
        const x = random() * width;
        const y = random() * height;
        const radius = 0.4 + random() * 1.5;
        context2d.globalAlpha = 0.3 + random() * 0.65;
        context2d.fillStyle = starColors[Math.floor(random() * starColors.length) % starColors.length];
        context2d.beginPath();
        context2d.arc(x, y, radius, 0, TWO_PI_LOCAL);
        context2d.fill();
    }
    for (let i = 0; i < 12; i += 1) {
        const x = random() * width;
        const y = random() * height;
        context2d.globalAlpha = 0.9;
        context2d.fillStyle = '#ffffff';
        context2d.beginPath();
        context2d.arc(x, y, 1.6, 0, TWO_PI_LOCAL);
        context2d.fill();
        context2d.globalAlpha = 0.3;
        context2d.fillRect(x - 6, y - 0.5, 12, 1);
        context2d.fillRect(x - 0.5, y - 6, 1, 12);
    }
    context2d.globalAlpha = 1;
}

/**
 * Generates one procedural texture canvas.
 *
 * @param {string} kind - Texture kind name (e.g. 'earth', 'io', 'starfield').
 * @param {number} seed - Deterministic seed for all random features.
 * @returns {HTMLCanvasElement} The painted texture canvas.
 */
export function createTextureCanvas(kind, seed) {
    const width = kind === 'earth' || kind === 'sun' || kind === 'jupiter' ? 1024 : 512;
    const height = Math.round(width / 2);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context2d = canvas.getContext('2d');
    const random = mulberry32(seed);
    const baseFill = () => {
        context2d.globalAlpha = 1;
        context2d.fillStyle = 'rgba(0,0,0,0)';
        context2d.fillRect(0, 0, width, height);
    };

    switch (kind) {
        case 'sun': {
            context2d.fillStyle = '#ff8f1f';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 900, '#ffbf66', 2, 7, random);
            drawBlobs(context2d, width, height, 500, '#ff7a00', 1, 5, random);
            drawBlobs(context2d, width, height, 60, '#ffe2a8', 2, 6, random);
            break;
        }
        case 'mercury': {
            context2d.fillStyle = '#8a837b';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 140, '#77706a', 3, 9, random);
            drawCraters(context2d, width, height, 26, random);
            break;
        }
        case 'venus': {
            context2d.fillStyle = '#d9b98c';
            context2d.fillRect(0, 0, width, height);
            drawBands(context2d, width, height, ['#e8cfa2', '#c8a878', '#f0dcb4', '#d9b98c'], 18, 6);
            break;
        }
        case 'earth': {
            context2d.fillStyle = '#123f7d';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 14, '#2e7d43', 18, 46, random);
            drawBlobs(context2d, width, height, 10, '#8a7a4a', 10, 26, random);
            drawPolarCaps(context2d, width, height, 16);
            drawBlobs(context2d, width, height, 70, 'rgba(255,255,255,0.12)', 6, 18, random);
            break;
        }
        case 'mars': {
            context2d.fillStyle = '#b3562f';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 90, '#8f4226', 4, 12, random);
            drawBlobs(context2d, width, height, 26, '#7a3d22', 8, 22, random);
            drawPolarCaps(context2d, width, height, 8);
            drawCraters(context2d, width, height, 10, random);
            break;
        }
        case 'jupiter': {
            context2d.fillStyle = '#c8a174';
            context2d.fillRect(0, 0, width, height);
            drawBands(context2d, width, height, ['#b98d5e', '#e0c298', '#a8794f', '#c8a174'], 26, 7);
            context2d.globalAlpha = 0.95;
            context2d.fillStyle = '#b23a1e';
            context2d.beginPath();
            context2d.ellipse(width * 0.72, height * 0.62, 34, 16, 0, 0, TWO_PI_LOCAL);
            context2d.fill();
            context2d.globalAlpha = 0.5;
            context2d.strokeStyle = '#f0c8a0';
            context2d.lineWidth = 2;
            context2d.stroke();
            context2d.globalAlpha = 1;
            break;
        }
        case 'saturn': {
            context2d.fillStyle = '#d8c294';
            context2d.fillRect(0, 0, width, height);
            drawBands(context2d, width, height, ['#e2cf9e', '#cbb27c', '#d8c294'], 22, 4);
            break;
        }
        case 'uranus': {
            context2d.fillStyle = '#9fd8d4';
            context2d.fillRect(0, 0, width, height);
            drawBands(context2d, width, height, ['#aee3de', '#8fd0cc'], 34, 3);
            break;
        }
        case 'neptune': {
            context2d.fillStyle = '#3050c8';
            context2d.fillRect(0, 0, width, height);
            drawBands(context2d, width, height, ['#2740a8', '#4a68e0', '#3050c8'], 24, 5);
            context2d.globalAlpha = 0.85;
            context2d.fillStyle = '#1a2a70';
            context2d.beginPath();
            context2d.ellipse(width * 0.3, height * 0.45, 26, 12, 0, 0, TWO_PI_LOCAL);
            context2d.fill();
            context2d.globalAlpha = 1;
            break;
        }
        case 'gray-cratered': {
            context2d.fillStyle = '#9c9a96';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 60, '#8a8884', 5, 14, random);
            drawCraters(context2d, width, height, 24, random);
            break;
        }
        case 'io': {
            context2d.fillStyle = '#c8b23c';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 90, '#8a6d1e', 3, 10, random);
            drawBlobs(context2d, width, height, 60, '#e0c86a', 2, 8, random);
            drawBlobs(context2d, width, height, 18, '#f2ecc8', 1, 3, random);
            break;
        }
        case 'europa': {
            context2d.fillStyle = '#cfd2d6';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 30, '#b9b4ac', 4, 12, random);
            context2d.strokeStyle = '#9a7b52';
            context2d.lineWidth = 1.2;
            context2d.globalAlpha = 0.4;
            for (let i = 0; i < 26; i += 1) {
                let x = random() * width;
                let y = random() * height;
                context2d.beginPath();
                context2d.moveTo(x, y);
                for (let s = 0; s < 6; s += 1) {
                    x += (random() - 0.5) * 40;
                    y += (random() - 0.5) * 24;
                    context2d.lineTo(x, y);
                }
                context2d.stroke();
            }
            context2d.globalAlpha = 1;
            break;
        }
        case 'ganymede': {
            context2d.fillStyle = '#8d7a66';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 40, '#6e5b48', 12, 30, random);
            drawBlobs(context2d, width, height, 30, '#a5917c', 8, 20, random);
            drawCraters(context2d, width, height, 18, random);
            break;
        }
        case 'callisto': {
            context2d.fillStyle = '#5d574f';
            context2d.fillRect(0, 0, width, height);
            drawCraters(context2d, width, height, 40, random);
            break;
        }
        case 'titan': {
            context2d.fillStyle = '#c8862e';
            context2d.fillRect(0, 0, width, height);
            drawBands(context2d, width, height, ['#d69438', '#b87622'], 40, 3);
            break;
        }
        case 'ice': {
            context2d.fillStyle = '#b8c8d8';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 40, '#9fb2c4', 6, 18, random);
            drawCraters(context2d, width, height, 12, random);
            break;
        }
        case 'triton': {
            context2d.fillStyle = '#b8b4ac';
            context2d.fillRect(0, 0, width, height);
            drawBlobs(context2d, width, height, 40, '#8f8a80', 6, 16, random);
            context2d.fillStyle = 'rgba(255,255,255,0.9)';
            context2d.beginPath();
            context2d.ellipse(width / 2, height * 0.12, width * 0.22, 18, 0, 0, TWO_PI_LOCAL);
            context2d.fill();
            break;
        }
        case 'starfield': {
            drawStarfield(context2d, width, height, random);
            break;
        }
        default: {
            context2d.fillStyle = '#888888';
            context2d.fillRect(0, 0, width, height);
        }
    }

    baseFill(); // restore alpha state (no-op paint, keeps canvas consistent)
    return canvas;
}