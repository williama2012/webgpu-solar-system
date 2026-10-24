/**
 * Flat ESLint configuration for the project.
 *
 * Lints the browser ES modules under `src/` and the Node ESM scripts under
 * `scripts/`. Only the `eslint` package is required - browser/Node globals are
 * declared by hand so no extra dependency is needed.
 */

const browserGlobals = {
    atob: 'readonly',
    Blob: 'readonly',
    CanvasPattern: 'readonly',
    console: 'readonly',
    createImageBitmap: 'readonly',
    Date: 'readonly',
    DOMException: 'readonly',
    document: 'readonly',
    Error: 'readonly',
    Event: 'readonly',
    fetch: 'readonly',
    Float32Array: 'readonly',
    HTMLCanvasElement: 'readonly',
    ImageBitmap: 'readonly',
    Infinity: 'readonly',
    JSON: 'readonly',
    Map: 'readonly',
    Math: 'readonly',
    navigator: 'readonly',
    Number: 'readonly',
    Object: 'readonly',
    OffscreenCanvas: 'readonly',
    Path2D: 'readonly',
    performance: 'readonly',
    Promise: 'readonly',
    RangeError: 'readonly',
    requestAnimationFrame: 'readonly',
    cancelAnimationFrame: 'readonly',
    Set: 'readonly',
    String: 'readonly',
    structuredClone: 'readonly',
    Symbol: 'readonly',
    TypeError: 'readonly',
    Uint32Array: 'readonly',
    Uint8ClampedArray: 'readonly',
    URL: 'readonly',
    WeakMap: 'readonly',
    window: 'readonly',
};

const nodeGlobals = {
    Buffer: 'readonly',
    console: 'readonly',
    process: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    globalThis: 'readonly',
    module: 'writable',
    require: 'readonly',
};

export default [
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: browserGlobals,
        },
        linterOptions: { reportUnusedDisableDirectives: true },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
            'no-const-assign': 'error',
            'no-dupe-keys': 'error',
            'no-dupe-args': 'error',
            'no-redeclare': 'error',
            'no-unreachable': 'error',
            'no-unsafe-negation': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',
            'prefer-const': 'warn',
            'eqeqeq': ['error', 'always'],
            'no-var': 'error',
            'no-new-wrappers': 'error',
            'no-shadow-restricted-names': 'error',
        },
    },
    {
        files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: nodeGlobals,
        },
        linterOptions: { reportUnusedDisableDirectives: true },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
            'no-const-assign': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',
            'prefer-const': 'warn',
            'no-var': 'error',
        },
    },
];
