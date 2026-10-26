// CDP driver: run the probe page headless and print its #out box + console errors.
const PORT = 9333;
import('http').then((mod) => { const http = mod.default;
  const getJson = (path, method) => new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method: method || 'GET' }, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d));
    });
    req.on('error', (e) => rej(e)); req.end();
  });

  const main = async () => {
    const ver = JSON.parse(await getJson('/json/version'));
    console.log('browser:', ver.Browser);
    const target = JSON.parse(await getJson('/json/new?' + encodeURIComponent(process.env.PAGE_URL), 'PUT'));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let idc = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else if (msg.method === 'Runtime.consoleAPICalled') events.push(msg);
    };
    const send = (method, params) => new Promise((res) => {
      const id = ++idc; pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
    await new Promise((r) => { ws.onopen = () => r(); });
    await send('Runtime.enable');
    // give the module script time to finish its GPU tests in real time
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let out = '';
    for (let i = 0; i < 240; i++) {
      await sleep(1000);
      const resp = await send('Runtime.evaluate', { expression: "document.getElementById('out').textContent", returnByValue: true });
      out = resp.result && resp.result.result ? String(resp.result.result.value) : '';
      if (out.startsWith('done:') || out.includes('NO navigator.gpu') || out.includes('PROBE-ERROR')) break;
    }
    console.log('===== PAGE BOX =====');
    console.log(out);
    const errs = events.filter((e) => e.params.type === 'error').map((e) => (e.params.args[0] && e.params.args[0].value) ? String(e.params.args[0].value) : JSON.stringify(e.params.args));
    if (errs.length) { console.log('===== CONSOLE ERRORS ====='); errs.slice(0, 10).forEach((s) => console.log(s)); }
    try { await send('Browser.close'); } catch (e2) {}
    process.exit(0);
  };
  main().catch((e) => { console.error('CDP-DRIVER-ERROR', e.message); process.exit(3); });
});
