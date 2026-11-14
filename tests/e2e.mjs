/**
 * Optional browser smoke test.
 *
 *   npm start                     (or: npm run build && npm run serve)
 *   CHROMIUM_PATH=/path/to/chrome TABFALL_URL=http://127.0.0.1:4173/ node tests/e2e.mjs
 *
 * It loads the built-in demo, plays past the pre-roll and verifies that the
 * audio clock advances, hits register and the canvas is actually rendered.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const url = process.env.TABFALL_URL || 'http://127.0.0.1:4173/';
const executablePath = process.env.CHROMIUM_PATH || undefined;
const errors = [];

const artifacts = fileURLToPath(new URL('./artifacts/', import.meta.url));
mkdirSync(artifacts, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tf-score-card h2', { timeout: 30_000 });
  assert.match(await page.locator('.tf-score-card h2').textContent(), /Neon Run/);

  const canvas = await page.locator('canvas.tf-canvas').evaluate((element) => ({
    width: element.width,
    height: element.height,
  }));
  assert.ok(canvas.width > 400 && canvas.height > 200, `canvas ${canvas.width}x${canvas.height}`);

  await page.locator('.tf-play').click();
  await page.waitForFunction(() => {
    const engine = window.__tabfall?.engine;
    const state = engine?.debugState();
    return !!state && state.clock > 900 && state.combo > 2;
  }, { timeout: 15_000 });

  const state = await page.evaluate(() => window.__tabfall.engine.debugState());
  assert.ok(state.clock > 0, 'score clock advances');
  assert.ok(state.combo > 0, 'hits are detected');
  assert.ok(state.effects >= 0, 'effect system is alive');

  // Shortcuts must keep working while a transport button holds focus: clicking
  // play/restart used to silence ← / → / Home for the rest of the session.
  await page.locator('.tf-play').click();
  const pausedClock = await page.evaluate(() => window.__tabfall.engine.debugState().clock);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const seekedClock = await page.evaluate(() => window.__tabfall.engine.debugState().clock);
  assert.ok(
    seekedClock - pausedClock > 900 && seekedClock - pausedClock < 1200,
    `ArrowRight with a focused button: ${Math.round(pausedClock)} -> ${Math.round(seekedClock)}`,
  );
  await page.keyboard.press('Home');
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => window.__tabfall.engine.debugState().clock) < 1, 'Home rewinds to 0');

  await page.screenshot({ path: fileURLToPath(new URL('./artifacts/e2e.png', import.meta.url)) });

  await page.locator('.tf-topbar-actions .is-primary').click();
  await page.waitForSelector('.tf-modal');
  assert.match(await page.locator('.tf-modal h2').textContent(), /导出视频/);
  await page.locator('.tf-modal .tf-icon-btn').click();

  // The score card collapses to one row and the choice is remembered (a UI
  // preference kept outside the project settings, so it survives a reload).
  await page.evaluate(() => localStorage.removeItem('tabfall.ui.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tf-score-card h2');
  await page.locator('.tf-score-toggle').click();
  await page.waitForSelector('.tf-score-card.is-collapsed');
  const collapsedHeight = (await page.locator('.tf-score-card').boundingBox()).height;
  assert.ok(collapsedHeight < 48, `collapsed card stays one row (${collapsedHeight}px)`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tf-score-card.is-collapsed', { timeout: 20_000 });
  await page.locator('.tf-score-card.is-collapsed').click();
  await page.waitForSelector('.tf-score-card h2', { timeout: 20_000 });

  assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
  console.log('e2e ok:', { url, canvas, clock: Math.round(state.clock), combo: state.combo });
} finally {
  await browser.close();
}
