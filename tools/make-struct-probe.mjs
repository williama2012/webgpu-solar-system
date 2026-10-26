// Generates tools/struct-probe.html with byte-exact candidates extracted live from src/renderer.js.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('src/renderer.js', 'utf8');
const s = src.indexOf('/* ============================ WGSL sources');
const e = src.indexOf('/* ======================= Global uniform layout');
if (s < 0 || e < 0) throw new Error('markers not found: ' + s + ',' + e);
const region = src.slice(s, e);

const f = new Function(region + '\nreturn { G: GLOBAL_UNIFORMS_WGSL, S1: SHADER_BACKGROUND_STARS };');
const { G, S1 } = f();
if (!S1.startsWith(G)) throw new Error('preamble not prefix of S1');

// Normalize struct declarations to one-member-per-line; sep = '' (no ';') or ';' (kept).
function normStructs(text, sep) {
  let out = text.replace(/^struct (\w+) \{(.+)\};$/gm, (all, name, inner) =>
    'struct ' + name + ' {\n  ' + inner.split(';').map((x) => x.trim()).filter(Boolean).join('\n  ' + sep) + '\n};');
  const lines = out.split('\n');
  let inStruct = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^struct \w+ \{$/.test(t)) { inStruct = true; continue; }
    if (/^\};$/.test(t) && inStruct) { inStruct = false; continue; }
    if (inStruct && /^\s*\w+:/.test(lines[i])) lines[i] = lines[i].replace(';', sep);
  }
  return lines.join('\n');
}

const vsTriv = '@vertex fn vs_main() -> @builtin(position) pos: vec4<f32> { return vec4<f32>(0.0); }';
const cands = {
  c1_sameLineSemi: 'struct A { center: vec3<f32>; radius: f32 };\n' + vsTriv,
  c2_perLineSemi: 'struct A {\n  center: vec3<f32>;\n  radius: f32;\n};\n' + vsTriv,
  c3_perLineNoSemi: 'struct A {\n  center: vec3<f32>\n  radius: f32\n};\n' + vsTriv,
  c4_singleGenericSemi: 'struct A { a: vec4<f32>; };\n' + vsTriv,
  c5_singleGenericNoSemi: 'struct A { a: vec4<f32> };\n' + vsTriv,
};
const full = {
  now_bgstars: S1,
  norm_strip_semi: normStructs(S1, ''),
  norm_keep_semi: normStructs(S1, ';'),
};

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h3>struct probe (live tree bytes)</h3><pre id="out">\u2026</pre>
<script type="module">
const out = document.getElementById('out');
const C = ${JSON.stringify(cands)};
const F = ${JSON.stringify(full)};
async function main() {
  const lines = [];
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { out.textContent = 'NO ADAPTER'; return; }
  const dev = await adapter.requestDevice({ label: 'probe' });
  const bufInfo = [{ arrayStride: 8, attributes: [{ format: 'float32x2', offset: 0 }] }];
  async function test(label, code) {
    let mod; try { mod = dev.createShaderModule({ label, code }); } catch (e) { lines.push(label + ': CREATE-THROW ' + e.message); return; }
    try {
      dev.createRenderPipeline({ layout: 'auto', vertex: { module: mod, buffers: [bufInfo], entryPoint: 'vs_main' }, fragment: null });
      lines.push(label + ': PARSE-OK (pipeline created)');
    } catch (err) {
      const msg = String(err.message || err);
      lines.push(/WGSL|pars/i.test(msg) ? label + ': PARSE-FAIL ' + msg.split('\n')[0] : label + ': PARSE-OK-ish (rejected for other reason: ' + msg.slice(0, 90) + ')');
    }
  }
  for (const [k, v] of Object.entries(C)) await test(k, v);
  for (const [k, v] of Object.entries(F)) await test(k, v);
  lines.push('DONE');
  out.textContent = lines.join('\n');
}
main().catch((e) => { out.textContent = 'HARNESS-FAIL: ' + e.message; });
</script>`;

writeFileSync('tools/struct-probe.html', html);
console.log('G len=' + G.length + ' S1 len=' + S1.length);
console.log('--- norm_strip_semi(S1) head ---');
console.log(normStructs(S1, '').split('\n').slice(0, 25).join('\n'));
