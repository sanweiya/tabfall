/** Minimal static server for dist/; alphaTab needs a real http (or https) origin. */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(appDir, 'dist');
// 4173 is taken by the sibling dynamic-guitar-tab project on this machine, so
// TABFALL deliberately uses 4175 (HTTP) / 4176 (HTTPS). Override with PORT /
// TLS_PORT if those are ever taken too.
const port = Number(process.env.PORT ?? process.argv[2] ?? 4175);
const host = process.env.HOST ?? '0.0.0.0';
const tlsPort = Number(process.env.TLS_PORT ?? 4176);
const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'], ['.otf', 'font/otf'], ['.sf2', 'application/octet-stream'],
  ['.map', 'application/json; charset=utf-8'],
]);

function handle(req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = decodeURIComponent(url.pathname);
    if (file.endsWith('/')) file += 'index.html';
    const resolved = path.resolve(root, `.${path.normalize(file)}`);
    if (!resolved.startsWith(root) || !existsSync(resolved) || !statSync(resolved).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': types.get(path.extname(resolved).toLowerCase()) ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    createReadStream(resolved).pipe(res);
  } catch {
    res.writeHead(500);
    res.end('Server error');
  }
}

function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

createServer(handle).listen(port, host, () => {
  console.log(`TABFALL HTTP : http://${host}:${port}/`);
  const lan = lanAddress();
  if (lan) console.log(`              http://${lan}:${port}/`);
});

const certPath = process.env.TLS_CERT ?? path.join(appDir, 'certs', 'dev-cert.pem');
const keyPath = process.env.TLS_KEY ?? path.join(appDir, 'certs', 'dev-key.pem');
const tlsAvailable = tlsPort > 0 && existsSync(certPath) && existsSync(keyPath);
if (tlsAvailable) {
  https.createServer(
    { cert: readFileSync(certPath), key: readFileSync(keyPath) },
    handle,
  ).listen(tlsPort, host, () => {
    console.log(`TABFALL HTTPS: https://${host}:${tlsPort}/`);
    const lan = lanAddress();
    if (lan) console.log(`               https://${lan}:${tlsPort}/`);
    console.log('Self-signed certificate: accept the browser warning once on each device.');
  });
} else if (tlsPort > 0) {
  console.log(`HTTPS skipped: run "npm run cert" to create ${certPath}.`);
}
console.log('Stop with Ctrl+C.');
