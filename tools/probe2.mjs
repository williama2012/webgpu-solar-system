const get = async (path) => {
  const res = await fetch('http://127.0.0.1:9334' + path);
  return JSON.parse(await res.text());
};
async function main() {
  const browser = await get('/json');
  const target = browser.find((t) => t.type === 'page' && t.url === 'about:blank');
  if (!target) throw new Error('no blank page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let idc = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id != null && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params) => { const id = ++idc; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); };
  await send('Runtime.enable');
  try { await get('/json/new?http://localhost:8080/tools/mintest.html').catch(() => null); } catch (e2) { const t2 = browser.find((x) => x.type === 'page' && x.url === 'about:blank'); if (t2) { const w2 = new WebSocket(t2.webSocketDebuggerUrl); await new Promise((r2) => { w2.onopen = r2; }); } }
  const sleep = (ms) => new Promise((res2) => setTimeout(res2, ms));
  for (let i = 0; i < 45; i++) { await sleep(1000); try { const v = await send('Runtime.evaluate', { expression: `document.getElementById('out') ? document.getElementById('out').textContent : 'NOELEM'`, returnByValue: true }); const txt = (v.result && v.result.value) || ''; if (txt.includes('done:') || txt.startsWith('ERR') || txt === 'NO GPU' || txt === 'NO ADAPTER') break; } catch (e3) {} }
  process.stdout.write((await send('Runtime.evaluate', { expression: `document.getElementById('out').textContent`, returnByValue: true })).result.value + '\n');
  await get('/json/close/' + target.id).catch(() => null);
  try { await new Promise((r3) => setTimeout(r3, 500)); } catch (e4) {}
}
main().catch((e) => { console.error('FATAL ' + e.message); process.exit(2); });
