/**
 * Smoke test driven by geckodriver + the machine's own Firefox (no Playwright,
 * no bundled browser). This is the default browser check on this Linux box,
 * where no Chromium-family browser is installed.
 *
 *   npm run build && npm run serve     # http://127.0.0.1:4175/
 *   node tests/firefox-e2e.mjs         # or: npm run test:firefox
 *
 * Environment:
 *   TABFALL_URL       default http://127.0.0.1:4175/
 *   FIREFOX_BIN       default /opt/firefox/firefox (falls back to `firefox`)
 *   GECKODRIVER       default `geckodriver` from PATH
 *   GECKODRIVER_PORT  default 4444
 *   HEADLESS=0        run with a visible window (needs DISPLAY)
 *
 * It reuses an already-running geckodriver on that port, otherwise spawns one
 * and stops it afterwards. Artifacts: tests/artifacts/firefox.png (viewport)
 * and tests/artifacts/firefox-canvas.png (the lane canvas itself).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.env.TABFALL_URL || 'http://127.0.0.1:4175/';
const driverPort = Number(process.env.GECKODRIVER_PORT ?? 4444);
const base = `http://127.0.0.1:${driverPort}`;
const headless = process.env.HEADLESS !== '0';
const driverBin = process.env.GECKODRIVER || 'geckodriver';
const firefoxBin =
  process.env.FIREFOX_BIN || (existsSync('/opt/firefox/firefox') ? '/opt/firefox/firefox' : 'firefox');

const artifacts = fileURLToPath(new URL('./artifacts/', import.meta.url));
mkdirSync(artifacts, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function webdriver(method, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.value?.error) {
    const error = payload.value ?? {};
    throw new Error(
      `WebDriver ${method} ${pathname} -> ${response.status}: ${error.error ?? 'unknown'} ${error.message ?? ''}`.trim(),
    );
  }
  return payload.value;
}

async function waitFor(label, probe, { timeout = 30_000, interval = 200 } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await probe();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`timed out after ${timeout} ms waiting for ${label} (last: ${JSON.stringify(last)})`);
}

async function driverReady() {
  try {
    const response = await fetch(`${base}/status`, { signal: AbortSignal.timeout(1000) });
    return (await response.json()).value?.ready === true;
  } catch {
    return false;
  }
}

let driver;
let spawnedDriver = false;
if (await driverReady()) {
  console.log(`firefox e2e: reusing geckodriver on ${base}`);
} else {
  driver = spawn(driverBin, ['--host', '127.0.0.1', '--port', String(driverPort), '--log', 'error'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  spawnedDriver = true;
  driver.on('error', (error) => {
    console.error(`cannot start ${driverBin}: ${error.message}`);
  });
  let stderr = '';
  driver.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  driver.on('exit', (code) => {
    if (code && !stderr.includes('Address in use')) {
      console.error(`geckodriver exited with ${code}:\n${stderr}`);
    }
  });
  await waitFor('geckodriver to accept connections', driverReady, { timeout: 15_000 });
}

let sessionId;
try {
  const session = await webdriver('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        pageLoadStrategy: 'eager',
        'moz:firefoxOptions': {
          binary: firefoxBin,
          args: headless ? ['-headless'] : [],
          prefs: {
            // Headless runs have no user gesture, so let the demo audio start;
            // otherwise the alphaTab clock stays at 0 and the test is useless.
            'media.autoplay.default': 0,
            'media.autoplay.blocking_policy': 0,
            'media.autoplay.block-webaudio': false,
            'media.volume_scale': '1.0',
            'browser.sessionstore.resume_from_crash': false,
          },
        },
      },
    },
  });
  sessionId = session.sessionId;
  const capabilities = session.capabilities;
  console.log(`firefox e2e: Firefox ${capabilities.browserVersion} via geckodriver ${capabilities['moz:geckodriverVersion']}`);

  const call = (method, pathname, body) => webdriver(method, `/session/${sessionId}${pathname}`, body);
  const run = async (script) => call('POST', '/execute/sync', { script, args: [] });
  const key = async (code) => {
    await call('POST', '/actions', {
      actions: [
        {
          type: 'key',
          id: 'keyboard',
          actions: [
            { type: 'keyDown', value: code },
            { type: 'keyUp', value: code },
          ],
        },
      ],
    });
  };

  await call('POST', '/window/rect', { width: 1680, height: 1050, x: 0, y: 0 });
  await call('POST', '/url', { url });

  await waitFor(
    'the demo score card (Neon Run)',
    async () => /Neon Run/.test(await run("return document.querySelector('.tf-score-card h2')?.textContent ?? ''")),
  );

  await run(`
    window.__ffErrors = [];
    addEventListener('error', (event) => window.__ffErrors.push('error: ' + (event.message ?? 'unknown')));
    addEventListener('unhandledrejection', (event) => window.__ffErrors.push('unhandledrejection: ' + String(event.reason)));
  `);

  const canvas = await run(`
    const element = document.querySelector('canvas.tf-canvas');
    if (!element) return null;
    return { width: element.width, height: element.height };
  `);
  assert.ok(canvas && canvas.width > 400 && canvas.height > 200, `canvas ${JSON.stringify(canvas)}`);

  // The lane is a plain 2D canvas; sample a coarse grid to prove something was
  // actually drawn instead of a black/blank surface.
  const colors = await run(`
    const element = document.querySelector('canvas.tf-canvas');
    const context = element.getContext('2d');
    const seen = new Set();
    for (let x = 0; x < element.width; x += Math.max(1, Math.floor(element.width / 24))) {
      for (let y = 0; y < element.height; y += Math.max(1, Math.floor(element.height / 24))) {
        const [r, g, b] = context.getImageData(x, y, 1, 1).data;
        seen.add((r << 16) | (g << 8) | b);
      }
    }
    return seen.size;
  `);
  assert.ok(colors > 4, `canvas is painted (${colors} distinct sampled colors)`);

  await run("document.querySelector('.tf-play').click()");
  const state = await waitFor(
    'the audio clock and combo to advance',
    async () => {
      const next = await run('return window.__tabfall?.engine?.debugState() ?? null');
      return next?.clock > 900 && next.combo > 2 ? next : null;
    },
    { timeout: 20_000 },
  );

  // Shortcuts must keep working while a transport button holds focus.
  await run("document.querySelector('.tf-play').click()");
  const pausedClock = await run('return window.__tabfall.engine.debugState().clock');
  await key('\uE014'); // ArrowRight
  await sleep(200);
  const seekedClock = await run('return window.__tabfall.engine.debugState().clock');
  assert.ok(
    seekedClock - pausedClock > 900 && seekedClock - pausedClock < 1200,
    `ArrowRight with a focused button: ${Math.round(pausedClock)} -> ${Math.round(seekedClock)}`,
  );
  await key('\uE011'); // Home
  await sleep(200);
  assert.ok(await run('return window.__tabfall.engine.debugState().clock') < 1, 'Home rewinds to 0');

  const errors = await run('return window.__ffErrors');
  assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);

  const viewport = await call('GET', '/screenshot');
  writeFileSync(`${artifacts}firefox.png`, Buffer.from(viewport, 'base64'));
  const lane = await run("return document.querySelector('canvas.tf-canvas').toDataURL('image/png')");
  writeFileSync(`${artifacts}firefox-canvas.png`, Buffer.from(lane.split(',')[1], 'base64'));

  console.log('firefox e2e ok:', {
    url,
    canvas,
    clock: Math.round(state.clock),
    combo: state.combo,
    colors,
    screenshots: ['tests/artifacts/firefox.png', 'tests/artifacts/firefox-canvas.png'],
  });
} finally {
  if (sessionId) await webdriver('DELETE', `/session/${sessionId}`).catch(() => {});
  if (spawnedDriver && driver && driver.exitCode === null) {
    driver.kill();
    await new Promise((resolve) => driver.once('exit', resolve));
  }
}
