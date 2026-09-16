// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';
import viteConfig from '../vite.config';
import { createResponseWorkflowsRouter } from '../server/routes/responseWorkflows';
import { ResponseWorkflowStore } from '../server/lib/responseWorkflowStore';

afterEach(() => vi.unstubAllEnvs());

it('preserves browser origin through the real development proxy without allowing a foreign origin', async () => {
  vi.stubEnv('AEGISOPS_OPERATOR_TOKEN', '');
  vi.stubEnv('AEGISOPS_OPERATOR_OIDC_ISSUER', '');
  vi.stubEnv('AEGISOPS_OPERATOR_OIDC_AUDIENCE', '');
  vi.stubEnv('AEGISOPS_OPERATOR_ALLOWED_ROLES', '');
  const directory = await mkdtemp(path.join(tmpdir(), 'aegisops-proxy-'));
  const api = express();
  api.use('/api/response-workflows', createResponseWorkflowsRouter(new ResponseWorkflowStore(directory)));
  const backend = api.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => backend.once('listening', resolve));
  const backendOrigin = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  const configured = viteConfig({ command: 'serve', mode: 'test' });
  const originalProxy = configured.server!.proxy!['/api'];
  const proxy = typeof originalProxy === 'string' ? backendOrigin : { ...originalProxy, target: backendOrigin };
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  try {
    vite = await createViteServer({
      ...configured, configFile: false, logLevel: 'silent', appType: 'custom',
      cacheDir: path.join(directory, 'vite-cache'),
      server: { ...configured.server, port: 0, host: '127.0.0.1', watch: null, proxy: { '/api': proxy } },
    });
    await vite.listen();
    const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
    const submission = await readFile(path.join(process.cwd(), 'samples/response-workflow.synthetic.json'), 'utf8');
    const response = await fetch(`${origin}/api/response-workflows`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin }, body: submission,
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.createdBy).toEqual({ kind: 'local-demo' });
    expect(created.state).toEqual({ kind: 'draft' });
    const rejected = await fetch(`${origin}/api/response-workflows`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' }, body: submission,
    });
    expect(rejected.status).toBe(403);
  } finally {
    await vite?.close();
    await new Promise<void>((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
