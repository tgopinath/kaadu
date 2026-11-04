// Captures the phone screenshots used on the portfolio card: node tools/shots.mjs
// Saves 600-wide JPEGs to prototype/shots (same size as the other portfolio phone shots).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'prototype', 'shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(ROOT, '.shots-'));
const port = 5700 + Math.floor(Math.random() * 200), dbg = port + 1000;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${dbg}`, `--user-data-dir=${tmp}/profile`, 'about:blank'], { stdio: 'ignore' });
try {
  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    try { const p = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(t => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
    if (!ws) await sleep(250);
  }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const origin = `http://127.0.0.1:${port}`;
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 849, deviceScaleFactor: 2, mobile: true });
  const grab = async (hash, file, { wait = 5000, lang = 'en', js } = {}) => {
    await send('Page.navigate', { url: `${origin}/index.html` }); await sleep(1500);
    await send('Runtime.evaluate', { expression: `localStorage.clear(); localStorage.setItem('kd.lang', '"${lang}"'); localStorage.setItem('kd.swipeHint', 'true')` });
    await send('Page.navigate', { url: `${origin}/index.html?shot=${file}${hash}` }); await sleep(wait);
    if (js) { await send('Runtime.evaluate', { expression: js, awaitPromise: true }); await sleep(1500); }
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const png = path.join(tmp, file + '.png');
    fs.writeFileSync(png, Buffer.from(s.result.data, 'base64'));
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '84', '--resampleWidth', '600', png, '--out', path.join(SHOTS, file + '.jpg')], { stdio: 'pipe' });
  };
  await grab('#/', 'home', { wait: 8000 });
  await grab('#/g/vine', 'vines', { wait: 8000 });
  await grab('#/p/banyan', 'plant-ta', { lang: 'ta', wait: 7000 });
  await grab('#/types', 'types', { wait: 6000 });
  // Desktop shot for the portfolio card's browser window (1440x900, saved as JPEG).
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${origin}/index.html` }); await sleep(1000);
  await send('Runtime.evaluate', { expression: `localStorage.clear(); localStorage.setItem('kd.lang', '"en"')` });
  await send('Page.navigate', { url: `${origin}/index.html?shot=desk#/` }); await sleep(8000);
  { const s = await send('Page.captureScreenshot', { format: 'png' }); const png = path.join(tmp, 'desk.png'); fs.writeFileSync(png, Buffer.from(s.result.data, 'base64'));
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '84', png, '--out', path.join(SHOTS, 'web-kaadu.jpg')], { stdio: 'pipe' }); }
  console.log('captured', fs.readdirSync(SHOTS).join(', '));
  ws.close();
} finally {
  const exited = new Promise(r => chrome.once('exit', r));
  chrome.kill(); server.kill();
  await Promise.race([exited, sleep(5000)]);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
