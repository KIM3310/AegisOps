import { execFile } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { request, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';

export type LocalProofCertificate = {
  keyPath: string;
  certPath: string;
  certificate: string;
  spki: string;
};

/** Fresh, one-day loopback identity, trusted only by this proof's clients. */
export async function createLocalProofCertificate(directory: string): Promise<LocalProofCertificate> {
  await mkdir(directory, { mode: 0o700 });
  const keyPath = path.join(directory, 'key.pem');
  const certPath = path.join(directory, 'cert.pem');
  const config = path.join(directory, 'openssl.cnf');
  await writeFile(config, [
    '[req]', 'distinguished_name = subject', 'x509_extensions = extensions', 'prompt = no',
    '[subject]', 'CN = 127.0.0.1', '[extensions]',
    'subjectAltName = IP:127.0.0.1', 'basicConstraints = critical,CA:FALSE',
    'keyUsage = critical,digitalSignature,keyEncipherment', 'extendedKeyUsage = serverAuth', '',
  ].join('\n'));
  await promisify(execFile)('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '1', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-config', config,
  ]);
  await chmod(keyPath, 0o600);
  const certificate = await readFile(certPath, 'utf8');
  const publicKey = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' });
  return { keyPath, certPath, certificate, spki: createHash('sha256').update(publicKey).digest('base64') };
}

export function verifiedLocalHttpsRequest(
  url: string,
  certificate: string,
  options: Pick<RequestOptions, 'method' | 'headers'>,
  onResponse: (response: IncomingMessage) => void,
) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error('Local proof HTTPS requests require a loopback HTTPS URL');
  }
  return request(target, {
    method: options.method, headers: options.headers,
    ca: certificate, rejectUnauthorized: true, agent: false,
  }, onResponse);
}
