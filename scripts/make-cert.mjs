/**
 * Generate a local self-signed certificate for HTTPS on the LAN.
 *
 * WebCodecs (used by the video exporter) requires a secure context. localhost
 * is considered secure, a LAN IP over plain HTTP is not. This certificate is
 * intentionally self-signed: the browser will show a warning once, then treat
 * the origin as HTTPS/secure.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDir = path.join(appDir, 'certs');
mkdirSync(certDir, { recursive: true });

const addresses = ['127.0.0.1'];
for (const entries of Object.values(networkInterfaces())) {
  for (const entry of entries ?? []) {
    if (entry.family === 'IPv4' && !entry.internal && !addresses.includes(entry.address)) {
      addresses.push(entry.address);
    }
  }
}
const san = ['DNS:localhost', ...addresses.map((address) => `IP:${address}`)].join(',');
const cert = path.join(certDir, 'dev-cert.pem');
const key = path.join(certDir, 'dev-key.pem');

console.log(`Generating self-signed certificate for ${san}`);
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', key, '-out', cert,
  '-days', '3650',
  '-subj', '/CN=TABFALL',
  '-addext', `subjectAltName=${san}`,
], { stdio: 'inherit' });

console.log(`\nCertificate: ${cert}\nKey:         ${key}`);
console.log('Start with: npm start   (HTTPS starts automatically when certs/ exists)');
