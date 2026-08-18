import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../kpgs_progressive.js', import.meta.url), 'utf8');
const context = vm.createContext({ navigator: { onLine: true } });
vm.runInContext(source, context, { filename: 'kpgs_progressive.js' });
const engine = context.KPGSProgressive;

function incident(id = 'INC-900') {
  return {
    id,
    type: 'flood',
    severity: 'high',
    title: 'Validation incident',
    location: 'Cape Town',
    description: 'Canonical contract proof only',
    trust: 'unverified',
    timestamp: '2026-08-19T00:00:00.000Z',
    synced: false,
  };
}

test('CREATE traverses canonical stage order and emits non-authoritative distribution', () => {
  const update = engine.createIncidentUpdate(incident(), {
    updateId: 'incident:create:INC-900',
    idempotencyKey: 'incident:create:INC-900',
  });
  const result = engine.evaluate(update, null);

  assert.equal(update.schema, 'kpgs.progressive-update.v1');
  assert.equal(update.boundary_marker, '#NB');
  assert.equal(result.receipt.disposition, 'APPLIED');
  assert.equal(result.receipt.synchronized, true);
  assert.deepEqual(Array.from(result.receipt.stages, item => item.stage), [
    'TELEMETRY',
    'CLASSIFICATION',
    'ROUTING',
    'PROTOCOL_SELECTION',
    'INVARIANT_AUDIT',
    'POC_FOC_CHECK',
    'STATE_UPDATE',
    'DISTRIBUTION',
  ]);
  assert.equal(result.nextProjection.version, 1);
  assert.equal(result.nextProjection.authority_effect, 'none');
  assert.equal(result.distribution.canonical, false);
  assert.equal(result.distribution.transport_grants_authority, false);
  assert.equal(result.distribution.scope, 'crisisconnect_local_projection');
});

test('YELLOW holds before state update and distribution', () => {
  const update = engine.createIncidentUpdate(incident('INC-901'), {
    updateId: 'incident:create:INC-901',
    apuStatus: 'YELLOW',
  });
  const result = engine.evaluate(update, null);
  assert.equal(result.receipt.disposition, 'HELD');
  assert.equal(result.distribution, null);
  assert.equal(result.receipt.stages.find(item => item.stage === 'POC_FOC_CHECK').status, 'HOLD');
  assert.equal(result.receipt.stages.find(item => item.stage === 'STATE_UPDATE').status, 'NOT_REACHED');
});

test('stale optimistic UPDATE is held instead of overwriting projection', () => {
  const update = engine.createIncidentUpdate(incident('INC-902'), {
    operation: 'UPDATE',
    updateId: 'incident:update:INC-902:v3',
    expectedVersion: 3,
  });
  const current = {
    node_id: 'incident:INC-902',
    value: incident('INC-902'),
    version: 4,
    state_class: 'pending_proposal',
    authority_effect: 'none',
    update_id: 'incident:update:INC-902:v4',
  };
  const result = engine.evaluate(update, current);
  assert.equal(result.receipt.disposition, 'HELD');
  assert.equal(result.nextProjection.version, 4);
  assert.equal(result.receipt.stages.find(item => item.stage === 'STATE_UPDATE').status, 'HOLD');
});

test('READ observes without mutation or distribution', () => {
  const raw = engine.createIncidentUpdate(incident('INC-903'), {
    updateId: 'incident:create:INC-903',
  });
  const read = engine.normalize({
    ...raw,
    update_id: 'incident:read:INC-903',
    operation: 'READ',
    poc_validated: false,
    evidence_refs: [],
  });
  const current = {
    node_id: 'incident:INC-903',
    value: incident('INC-903'),
    version: 2,
    state_class: 'pending_proposal',
    authority_effect: 'none',
    update_id: 'older',
  };
  const result = engine.evaluate(read, current);
  assert.equal(result.receipt.disposition, 'OBSERVED');
  assert.equal(result.distribution, null);
  assert.equal(result.nextProjection.version, 2);
});

test('schema rejects missing #NB, authoritative state classes and FOC mutation claims', () => {
  const valid = engine.createIncidentUpdate(incident('INC-904'), {
    updateId: 'incident:create:INC-904',
  });
  assert.throws(() => engine.normalize({ ...valid, boundary_marker: 'NB' }), /#NB/);
  assert.throws(() => engine.normalize({ ...valid, state_class: 'authoritative' }), /not admitted/);
  assert.throws(() => engine.normalize({ ...valid, foc_detected: true }), /POC evidence/);
});
