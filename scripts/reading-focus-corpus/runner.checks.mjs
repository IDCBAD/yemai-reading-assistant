import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRunnerProduction, runCase } from '../run-reading-focus-workos.mjs';

const snapshot = { url: 'https://example.org/research', title: 'Research', paragraphs: [{ id: 'p0', text: 'If the cache is missing, do not overwrite the original page.' }] };
const connection = { schemaVersion: 2, transport: 'internal-v2', agentUuid: 'ba724f77-b2da-4701-8445-35e2dd8995e1', publicApiToken: 'secret-public-token',
  internalV2: { accessToken: 'secret-access-token', userUuid: 'secret-user-value', organizationUuid: 'secret-organization-value' } };
const response = JSON.stringify({ paragraphs: [{ id: 'p0', groups: [{ text: 'If the cache is missing', kind: 'condition' }, { text: 'do not overwrite the original page', kind: 'core' }] }] });

test('real production modules load; one submission, reuse, dry run and safe evidence', async () => {
  const production = await loadRunnerProduction();
  const outputRoot = await mkdtemp(join(tmpdir(), 'reading-workos-runner-'));
  let creates = 0; let submits = 0;
  const transport = { async createConversation() { creates++; return 'test-conversation'; }, async executeStream(uuid, request, callbacks) {
    submits++; assert.ok(request.content.includes(snapshot.paragraphs[0].text)); callbacks.onText(response); callbacks.onComplete();
  } };
  try {
    const args = { id: 'one', snapshot, connection, production, outputRoot, transport };
    const dry = await runCase(args);
    assert.equal(dry.status, 'dry-run'); assert.equal(creates, 0);
    const first = await runCase({ ...args, execute: true });
    assert.equal(first.status, 'ready'); assert.equal(creates, 1); assert.equal(submits, 1);
    const again = await runCase({ ...args, execute: true });
    assert.equal(again.reused, true); assert.equal(again.status, 'ready'); assert.equal(submits, 1);
    const alias=await runCase({...args,id:'renamed-case',execute:true});
    assert.equal(alias.reused,true); assert.equal(alias.directory,first.directory); assert.equal(submits,1);
    const state = JSON.parse(await readFile(join(first.directory, 'run.json'), 'utf8'));
    assert.equal(state.rawResponse, response); assert.equal(state.result.readyCount, 1);
    for (const file of await readdir(first.directory)) {
      const content = await readFile(join(first.directory, file), 'utf8');
      for (const secret of ['secret-public-token', 'secret-access-token', 'secret-user-value', 'secret-organization-value']) assert.ok(!content.includes(secret));
    }
  } finally { await production.close(); await rm(outputRoot, { recursive: true, force: true }); }
});

test('EOF, disconnect, tools, artifacts, interrupts and deadline stay unknown without retries or remote stop', async () => {
  const production = await loadRunnerProduction();
  const outputRoot = await mkdtemp(join(tmpdir(), 'reading-workos-unknown-'));
  try {
    for (const scenario of ['eof', 'disconnect', 'activity', 'artifact', 'interrupt', 'timeout', 'remote-error', 'invalid']) {
      let submits = 0; let creates = 0; let stops = 0;
      const transport = { async createConversation() { creates++; return 'conversation'; }, async abortConversation() { stops++; },
        async executeStream(uuid, request, callbacks, signal) {
          submits++;
          if (scenario === 'disconnect') { const error = new Error('secret-access-token'); error.name = 'WorkosProgressDisconnected'; error.runId = 'test-run'; error.conversationUuid = uuid; throw error; }
          if (scenario === 'activity') callbacks.onActivity({});
          if (scenario === 'artifact') callbacks.onArtifact({});
          if (scenario === 'interrupt') callbacks.onInterrupt({});
          if (scenario === 'remote-error') callbacks.onError('secret-access-token');
          if (scenario === 'invalid') { callbacks.onText('not json'); callbacks.onComplete(); }
          if (scenario === 'timeout') await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        } };
      const args = { id: scenario, snapshot: {...snapshot,paragraphs:[{...snapshot.paragraphs[0],text:`${snapshot.paragraphs[0].text} Scenario ${scenario}.`}]}, connection, production, outputRoot, transport, execute: true, timeoutMs: 25 };
      const first = await runCase(args);
      assert.equal(first.status, ['remote-error', 'invalid'].includes(scenario) ? 'failed' : 'unknown', scenario);
      const reused = await runCase(args); assert.equal(reused.reused, true);
      assert.equal(creates, 1); assert.equal(submits, 1); assert.equal(stops, 0);
      const saved = await readFile(join(first.directory, 'run.json'), 'utf8'); assert.ok(!saved.includes('secret-access-token'));
      if (scenario === 'disconnect') assert.equal(JSON.parse(saved).runId, 'test-run');
    }
  } finally { await production.close(); await rm(outputRoot, { recursive: true, force: true }); }
});

test('concurrent claims submit once and create errors never leak raw exceptions', async () => {
  const production = await loadRunnerProduction();
  const outputRoot = await mkdtemp(join(tmpdir(), 'reading-workos-race-'));
  let creates = 0;
  const transport = { async createConversation() { creates++; throw new Error('secret-access-token'); } };
  try {
    const args = { id: 'race', snapshot, connection, production, outputRoot, transport, execute: true };
    const results = await Promise.all([runCase(args), runCase({...args,id:'race-alias'})]);
    assert.equal(creates, 1); assert.equal(results.filter((item) => item.reused).length, 1);
    const saved = await readFile(join(results[0].directory, 'run.json'), 'utf8');
    assert.equal(JSON.parse(saved).status, 'unknown'); assert.ok(!saved.includes('secret-access-token'));
  } finally { await production.close(); await rm(outputRoot, { recursive: true, force: true }); }
});
