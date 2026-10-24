/**
 * Development static file server for the WebGPU solar system project.
 *
 * Usage:
 *   npm run dev
 * or
 *   node scripts/serve.mjs [port]
 *
 * Built on Express. It serves the project folder over plain HTTP so the
 * ES module import map in `index.html` can resolve the `@ripl/*` packages
 * straight from `node_modules`. No build step is involved, and nothing is
 * bundled.
 */

import { fileURLToPath } from 'node:url';
import express from 'express';

/** The folder that should be served to the browser. */
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/** Port taken from the first CLI argument, defaulting to 8080. */
const requestedPort = Number(process.argv[2] ?? 8080);
const port = Number.isInteger(requestedPort) && requestedPort > 0
    ? requestedPort
    : 8080;

/** The Express application instance. */
const application = express();

/**
 * Serves the whole project folder so that `/src/*.js` and
 * `/node_modules/@ripl/*` resolve exactly as written in `index.html`'s
 * import map.
 *
 */
application.use(
    express.static(projectRoot, {
        extensions: ['html'],
    }),
);

/**
 * Final guard for any request that matched no real file. Express' static
 * middleware calls `next()` in that case, so this runs instead of the
 * default HTML 404 page.
 *
 * @param {object} request - The incoming request.
 * @param {object} response - The outgoing response.
 */
function notFoundHandler(request, response) {
    response
        .status(404)
        .type('text/plain')
        .send(`404 - no file at ${request.originalUrl}`);
}

application.use(notFoundHandler);

/** Starts the HTTP listener once the module has loaded. */
application.listen(port, '0.0.0.0', () => {
    console.log(`Serving ${projectRoot}`);
    console.log(`Open http://localhost:${port} in a WebGPU-capable browser.`);
});
