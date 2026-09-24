import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const routes = JSON.parse(await readFile('dist/_routes.json', 'utf8'));
assert.deepEqual(routes, { version: 1, include: ['/api', '/api/*'], exclude: [] });
const generated = JSON.parse(await readFile('.wrangler/compiled-routes.json', 'utf8'));
assert.deepEqual(generated.include, ['/api/*']);
assert.deepEqual(generated.exclude, []);
assert.deepEqual(await readdir('functions/api'), ['[[path]].ts']);
assert.deepEqual(await readdir('functions'), ['api']);
const metadata = JSON.parse(await readFile('.wrangler/bundle-meta.json', 'utf8'));
const inputs = Object.keys(metadata.inputs);
assert(inputs.some((name) => name.endsWith('edge/responseWorkspace.ts')));
assert(inputs.some((name) => name.endsWith('edge/responseAuthority.ts')));
assert(inputs.some((name) => name.endsWith('server/lib/responseWorkflow.ts')));
assert(!inputs.some((name) => /server\/(index|routes)|responseWorkflowStore|operatorAccess|operatorSession|node_modules\/(express|openai|@google)/.test(name)));
console.log(JSON.stringify({ routes, generatedRoutes: generated.include, inputs: inputs.length, nativeServerBundled: false }));
