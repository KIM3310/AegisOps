import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { chromium, type Page } from 'playwright-core';
import type { ResponseCase } from '../shared/responseCase';

export async function verifyResponseBrowser(options: {
  origin: string; output: string; mode: 'cloud' | 'static' | 'configuration' | 'native'; token?: string;
  failWrites?: (enabled: boolean) => Promise<void>;
}): Promise<void> {
  const { origin, output, mode, token, failWrites } = options;
  await mkdir(output, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(output, 'isolated-profile'), {
    executablePath: process.env.AEGISOPS_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, ignoreHTTPSErrors: true, acceptDownloads: true, viewport: { width: 1280, height: 1000 },
  });
  const errors: string[] = [];
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const card = page.getByRole('region', { name: '공공 대응 검토', exact: true });
  const status = (revision: number) => card.getByRole('status').filter({ hasText: new RegExp('revision ' + revision) }).waitFor();
  const sample = async () => {
    await page.getByRole('button', { name: '합성 지연 사례 불러오기', exact: true }).click();
    await page.getByRole('button', { name: 'Run incident analysis', exact: true }).click();
    await card.getByRole('button', { name: '대응 검토 시작', exact: true }).waitFor();
  };
  const screenshot = (name: string) => page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  const read = async (id: string) => {
    const response = await page.request.get(`${origin}/api/response-workflows/${id}`);
    assert.equal(response.status(), 200);
    return await response.json() as ResponseCase;
  };
  const beginOutside = async (current: ResponseCase) => {
    const response = await page.request.post(`${origin}/api/response-workflows/${current.id}/review`, {
      headers: { Origin: origin }, data: { expectedRevision: current.revision, command: { kind: 'begin' } },
    });
    assert.equal(response.status(), 200);
  };
  const lastId = async () => {
    const id = await page.evaluate(() => localStorage.getItem('aegisops:last-response-case-id'));
    assert(id); return id;
  };
  try {
    await page.goto(origin);
    if (mode === 'static' || mode === 'configuration') {
      await card.getByRole('status').filter({ hasText: mode === 'static' ? '정적' : '설정' }).waitFor();
      assert.equal(await page.locator('option[value="oidc"]').count(), 0);
      assert.equal(await page.locator('input[type=password]').count(), 0);
      await sample();
      assert.equal(await card.getByRole('button', { name: '대응 검토 시작', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Save API key', exact: true }).count(), 0);
      await screenshot(mode + '-analysis-no-review');
      await writeFile(path.join(output, 'results.json'), JSON.stringify({ mode, syntheticAnalysis: true, saveDisabled: true, errors }, null, 2));
      assert.deepEqual(errors, []);
      return;
    }
    if (mode === 'cloud') {
      assert(token);
      await card.getByLabel('운영자 자격 증명', { exact: true }).waitFor();
      assert.equal(await page.locator('option[value="oidc"]').count(), 0);
      assert((await page.locator('body').innerText()).includes('공유 D1'));
      await screenshot('cloud-token-only');
      await card.getByLabel('운영자 자격 증명', { exact: true }).fill(token);
      await card.getByRole('button', { name: '로그인', exact: true }).click();
      await card.getByRole('button', { name: '로그아웃', exact: true }).waitFor();
      const cookies = await context.cookies(origin);
      const session = cookies.find((entry) => entry.name === '__Host-aegisops_review_session');
      assert(session?.secure && session.httpOnly && session.sameSite === 'Strict' && session.path === '/');
      assert.equal(await page.evaluate(() => document.cookie.includes('__Host-aegisops_review_session')), false);
    } else {
      await card.getByText('검토 API 기능은 아직 확인되지 않았습니다.', { exact: false }).waitFor();
      assert.equal(await page.locator('option[value="oidc"]').count(), 1);
    }
    await sample();
    await card.getByRole('button', { name: '대응 검토 시작', exact: true }).click();
    await status(1);
    const id = await lastId();
    const draft = await read(id);
    assert.equal(draft.createdBy.kind, mode === 'cloud' ? 'shared-token' : 'local-demo');
    assert.equal(draft.content.sources[0]?.contentHash, 'cf34172f84e9cf23ef4f14e591cfef4948e7cc8771063cc9c8a6141b57753aed');
    assert((await card.innerText()).includes(draft.content.sources[0]!.quote));
    await card.getByRole('button', { name: '검토 시작', exact: true }).click();
    await status(2);
    await card.getByRole('checkbox').first().check();
    await card.getByLabel('검토 메모 (필수, 최대 2000자)', { exact: true }).fill('격리된 브라우저 합성 검토. 시간 구간과 담당자 확인 계획 인계.');
    await card.getByRole('button', { name: '계획 검토 완료', exact: true }).click();
    await status(3);
    const reviewed = await read(id);
    assert.equal(reviewed.state.kind, 'reviewed');
    const documents: Record<string, string> = {};
    for (const [name, format] of [['Markdown 다운로드', 'markdown'], ['JSON 다운로드', 'json'], ['한컴 치환 JSON 다운로드', 'hancom-json']]) {
      const downloading = page.waitForEvent('download');
      await card.getByRole('button', { name, exact: true }).click();
      const download = await downloading;
      const filename = path.join(output, download.suggestedFilename());
      await download.saveAs(filename);
      const text = await readFile(filename, 'utf8');
      if (format === 'json') assert.deepEqual(JSON.parse(text).responseCase, reviewed);
      if (format === 'markdown') assert(text.includes('상태: **검토 완료**'));
      if (format === 'hancom-json') assert.equal(JSON.parse(text).templateValidated, false);
      documents[format!] = path.basename(filename);
    }
    await screenshot(mode + '-reviewed');
    await page.reload();
    await page.getByRole('button', { name: 'Start New', exact: true }).click();
    await card.getByRole('button', { name: '최근 검토 서버에서 다시 열기', exact: true }).click();
    await status(3);
    assert.equal(await lastId(), id);
    if (mode === 'native') {
      assert((await card.innerText()).includes('다중 프로세스 동시성'));
      await screenshot('native-reopened');
      await writeFile(path.join(output, 'results.json'), JSON.stringify({ mode, id, revision: 3, createdBy: reviewed.createdBy.kind, documents, errors }, null, 2));
      assert.deepEqual(errors, []);
      return;
    }
    await page.goto(origin); await sample();
    await card.getByRole('button', { name: '대응 검토 시작', exact: true }).click(); await status(1);
    const conflictId = await lastId();
    await beginOutside(await read(conflictId));
    await card.getByRole('button', { name: '검토 시작', exact: true }).click(); await status(2);
    await card.getByRole('alert').filter({ hasText: '최신 상태를 다시 불러왔습니다' }).waitFor();
    assert.equal((await read(conflictId)).reviewEvents.length, 1);
    await screenshot('cloud-conflict-reload');
    assert(failWrites);
    await failWrites(true);
    await card.getByRole('checkbox').first().check();
    await card.getByLabel('검토 메모 (필수, 최대 2000자)', { exact: true }).fill('합성 쓰기 장애 확인');
    await card.getByRole('button', { name: '계획 검토 완료', exact: true }).click();
    await card.getByRole('alert').filter({ hasText: '저장 결과를 확인할 수 없습니다' }).waitFor();
    await status(2);
    assert.equal((await read(conflictId)).revision, 2);
    await screenshot('cloud-storage-unconfirmed');
    await failWrites(false);
    await card.getByRole('button', { name: '서버 상태 새로고침', exact: true }).click(); await status(2);

    await page.goto(origin); await sample();
    await card.getByRole('button', { name: '대응 검토 시작', exact: true }).click(); await status(1);
    const lostId = await lastId();
    let writes = 0;
    await page.route(`**/api/response-workflows/${lostId}/review`, async (route) => {
      writes += 1;
      const committed = await route.fetch(); assert.equal(committed.status(), 200);
      await route.abort('failed');
    });
    await card.getByRole('button', { name: '검토 시작', exact: true }).click();
    await card.getByRole('alert').filter({ hasText: '저장 결과를 확인할 수 없습니다' }).waitFor();
    await status(1);
    assert.equal(writes, 1); assert.equal((await read(lostId)).revision, 2);
    await screenshot('cloud-committed-response-lost');
    await page.unroute(`**/api/response-workflows/${lostId}/review`);
    await card.getByRole('button', { name: '서버 상태 새로고침', exact: true }).click(); await status(2);
    assert.equal(writes, 1);
    const browserStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
    assert(!browserStorage.includes(token!));
    assert(!browserStorage.includes('__Host-aegisops_review_session'));
    assert(!browserStorage.includes('"reviewEvents"'));
    await card.getByRole('button', { name: '로그아웃', exact: true }).click();
    await card.getByLabel('운영자 자격 증명', { exact: true }).waitFor();
    assert.equal((await context.cookies(origin)).filter((entry) => entry.name === '__Host-aegisops_review_session').length, 0);
    assert.equal(await card.getByRole('button', { name: '서버 상태 새로고침', exact: true }).isDisabled(), true);
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ mode, id, revision: reviewed.revision, documents,
      conflictRevision: 2, writeFailureRevision: 2, lostReplyStoredRevision: 2, lostReplyVisibleRevision: 1, automaticRetries: 0, cookiesHttpOnlySecure: true, errors }, null, 2));
    assert.deepEqual(errors, []);
  } catch (error) {
    await screenshot(mode + '-failure');
    throw error;
  } finally {
    await context.close();
    await rm(path.join(output, 'isolated-profile'), { recursive: true, force: true });
  }
}
