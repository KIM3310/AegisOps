// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createLocalProofCertificate, verifiedLocalHttpsRequest, type LocalProofCertificate } from '../scripts/local-proof-tls';

let directory: string;
let trusted: LocalProofCertificate;
let unrelated: LocalProofCertificate;
let server: Server;
let port: number;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'aegisops-tls-test-'));
  trusted = await createLocalProofCertificate(path.join(directory, 'trusted'));
  unrelated = await createLocalProofCertificate(path.join(directory, 'unrelated'));
  server = createServer({ key: await readFile(trusted.keyPath), cert: trusted.certificate }, (_request, response) => response.end('verified'));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, resolve); });
  port = (server.address() as AddressInfo).port;
}, 15000);

afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

function get(host: string, certificate: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outgoing = verifiedLocalHttpsRequest(`https://${host}:${port}`, certificate, {}, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('proof TLS uses an isolated trust anchor and normal certificate validation', () => {
  it('accepts the exact generated loopback certificate over a real TLS connection', async () => {
    await expect(get('127.0.0.1', trusted.certificate)).resolves.toBe('verified');
  });
  it('rejects a certificate signed by an unrelated key', async () => {
    await expect(get('127.0.0.1', unrelated.certificate)).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  });
  it('still rejects a hostname outside the certificate SAN', async () => {
    await expect(get('localhost', trusted.certificate)).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  });
  it('generates independent keys and refuses a remote or cleartext target', () => {
    expect(trusted.spki).not.toBe(unrelated.spki);
    expect(() => verifiedLocalHttpsRequest('https://example.com', trusted.certificate, {}, () => {})).toThrow('loopback HTTPS');
    expect(() => verifiedLocalHttpsRequest('http://127.0.0.1', trusted.certificate, {}, () => {})).toThrow('loopback HTTPS');
  });
});
