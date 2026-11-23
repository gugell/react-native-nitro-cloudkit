/* global fetch, WebSocket */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Renders docs/demo/demo.html to docs/demo/demo.mp4 and docs/demo/demo.gif: headless Chrome
 * steps the page's render(t) frame by frame over the DevTools protocol, ffmpeg encodes.
 *
 *   node scripts/render-demo.mjs            # needs Google Chrome and ffmpeg
 *   CHROME=/path/to/chrome node scripts/render-demo.mjs
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = join(root, 'docs/demo/demo.html');
const out = join(root, 'docs/demo');
const FPS = 30;
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333 + Math.floor(Math.random() * 500);
const frames = mkdtempSync(join(tmpdir(), 'nitro-cloudkit-demo-'));

const browser = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(frames, 'profile')}`,
    '--window-size=1920,1080',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

function run(command, args) {
  return new Promise((ok, fail) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${command} exited ${code}`))));
  });
}

async function target() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const tab = list.find((entry) => entry.type === 'page');
      if (tab) return tab.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

try {
  const socket = new WebSocket(await target());
  await new Promise((ok) => socket.addEventListener('open', ok, { once: true }));
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
  });
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      const call = ++id;
      pending.set(call, (message) => {
        pending.delete(call);
        if (message.error) fail(new Error(`${method}: ${message.error.message}`));
        else ok(message.result);
      });
      socket.send(JSON.stringify({ id: call, method, params }));
    });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: `${pathToFileURL(page).href}?render` });
  await sleep(1500);
  const { result } = await send('Runtime.evaluate', { expression: 'window.DURATION' });
  const total = Math.round(result.value * FPS);

  for (let frame = 0; frame < total; frame++) {
    await send('Runtime.evaluate', { expression: `render(${frame / FPS})` });
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      join(frames, `${String(frame).padStart(5, '0')}.png`),
      Buffer.from(data, 'base64'),
    );
    if (frame % 150 === 0) console.log(`frame ${frame}/${total}`);
  }
  socket.close();

  const input = ['-y', '-framerate', String(FPS), '-i', join(frames, '%05d.png')];
  await run('ffmpeg', [
    ...input,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    join(out, 'demo.mp4'),
  ]);
  // GIF for the README: smaller, 12 fps, one palette for the whole clip.
  await run('ffmpeg', [
    ...input,
    '-vf',
    'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    join(out, 'demo.gif'),
  ]);
  console.log(`Rendered ${total} frames → docs/demo/demo.mp4, docs/demo/demo.gif`);
} finally {
  browser.kill();
  rmSync(frames, { recursive: true, force: true });
}
