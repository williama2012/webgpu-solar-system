// One-shot generator:
//   1) extracts the REAL WGSL bytes from src/renderer.js (no retyping),
//   2) normalises renderer.js line endings CRLF -> LF in place,
//   3) rewrites tools/wgsl-probe.html embedding both flavours byte-exact.
import { readFileSync, writeFileSync } from 'node:fs';

let src = readFileSync('src/renderer.js', 'utf8');

function tmpl(name, text) {
  const marker = 'const ' + name + ' = ';
  const i = text.indexOf(marker);
  if (i < 0) throw new Error('marker not found: ' + name);
  let j = i + marker.length;
  if (text[j] !== '`') throw new Error('expected opening backtick for ' + name);
  j++;
  const end = text.indexOf('\n`;', j); // these literals close with backtick + ;
  if (end < 0) throw new Error('closing backtick not found: ' + name);
  return text.slice(j, end);
}

const G = tmpl('GLOBAL_UNIFORMS_WGSL', src);        // shared preamble, CRLF as in app
let Sraw = tmpl('SHADER_BACKGROUND_STARS', src);
const S = Sraw.replace('${GLOBAL_UNIFORMS_WGSL}', G); // evaluated stars shader (CRLF)
const crlf = (s) => (s.match(/\r\n/g) || []).length;
console.log('G bytes:', G.length, 'crlf:', crlf(G), '| S bytes:', S.length, 'crlf:', crlf(S));

src = src.replace(/\r\n/g, '\n');                  // CRLF -> LF (safe for JS semantics)
writeFileSync('src/renderer.js', src);
console.log('renderer.js CRLF now:', (src.match(/\r\n/g) || []).length, '(expect 0)');

const jsstr = (v) => JSON.stringify(v).replace(/<\//g, '<\\/'); // embed safely in <script>

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<p>WGSL leading-newline probe v3 (built from real src bytes). Wait for <code>done:</code> in the box below.</p>
<pre id="out">running…</pre>
<script type="module">
// Five probes: baseline sanity / shared preamble CRLF-vs-LF / full stars shader CRLF-vs-LF.
const PreambleAsApp = ${jsstr(G)};
const StarsAsApp    = ${jsstr(S)};
const preambleLF = PreambleAsApp.replace(/\\r\\n/g, '\\n');
const starsLF    = StarsAsApp.replace(/\\r\\n/g, '\\n');
const gWithLead  = '\\n' + PreambleAsApp;
const sWithLead  = '\\n' + StarsAsApp;
let result = '';
if (!('gpu' in navigator)) { result = 'NO_GPU\\n'; }
else {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { result = 'NO_ADAPTER\\n'; }
  else {
    const device = await adapter.requestDevice({ requiredFeatures: [], requiredLimits: {} });
    const pending = [];
    device.onuncapturederror = (e) => pending.push(String(e.message).split('\\n')[0]);
    async function probe(label, code) {
      const n0 = pending.length;
      try { device.createShaderModule({ label, code }); }
      catch (e) { return label + ': THROWS ' + e.message + '\\n'; }
      await new Promise((r) => setTimeout(r, 150)); // let async device errors land
      const got = pending.slice(n0);
      if (!got.length) return label + ': OK\\n';
      return label + ': INVALID — ' + got.join(' | ') + '\\n';
    }
    result += await probe('p1_minimal_baseline', 'struct A { x: f32; y: f32; };\\n');
    result += await probe('p2_preamble_CRLF_asApp', PreambleAsApp);
    result += await probe('p3_preamble_LF', preambleLF);
    result += await probe('p4_stars_CRLF_asApp', StarsAsApp);
    result += await probe('p5_stars_LF', starsLF);
    result += await probe('p6_G_asApp_now', PreambleAsApp);
    result += await probe('p7_S_asApp_now', StarsAsApp);
    result += await probe('p8_G_LEADING_NL', gWithLead);
    result += await probe('p9_S_LEADING_NL', sWithLead);
    result += await probe('p10_minimal_leadNL', '\\nstruct A { x: vec3<f32>; y: f32; };');
    result += await probe('p11_minimal_plain', 'struct A { x: vec3<f32>; y: f32; };');
  }
}
document.getElementById('out').textContent = 'done:\\n' + result;
try { await fetch('/__result', { method: 'POST', body: document.getElementById('out').textContent }); } catch (e) {}

</script></body></html>`;
writeFileSync('tools/wgsl-probe.html', html);
console.log('probe written:', html.length, 'bytes');
