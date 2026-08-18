/* ═══════════════════════════════════════════════════════════════
   CrisisConnect — Adaptive Progressive Update (APU) contract

   Canonical lifecycle preserved from Introduction-to-MCP:
   S0_CONCEPT → S1_IMPLEMENTED → S2_POC → S3_SYNCED → S4_PSO → S5_GOVERNED

   CrisisConnect is currently permitted to author only S1 and S2 locally.
   S3 requires a separately witnessed SWFUS/server receipt.
   ═══════════════════════════════════════════════════════════════ */

const CCAPU = (function () {
  'use strict';

  const SCHEMA = 'crisisconnect.apu.progressive-update.v1';
  const STAGES = Object.freeze({
    CONCEPT: 'S0_CONCEPT',
    IMPLEMENTED: 'S1_IMPLEMENTED',
    POC: 'S2_POC',
    SYNCED: 'S3_SYNCED',
    PSO: 'S4_PSO',
    GOVERNED: 'S5_GOVERNED'
  });
  const CRUD = Object.freeze(['create', 'read', 'update', 'delete']);
  const CRUD_SET = new Set(CRUD);
  const ORDER = Object.freeze([
    STAGES.CONCEPT,
    STAGES.IMPLEMENTED,
    STAGES.POC,
    STAGES.SYNCED,
    STAGES.PSO,
    STAGES.GOVERNED
  ]);

  function requiredString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(field + ' must be a non-empty string.');
    }
    return value.trim();
  }

  function normalize(update) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new Error('APU update must be an object.');
    }

    const schema = update.schema || SCHEMA;
    if (schema !== SCHEMA) throw new Error('Unsupported APU schema: ' + schema);

    const operation = requiredString(update.operation, 'operation').toLowerCase();
    if (!CRUD_SET.has(operation)) {
      throw new Error('operation must be one of: ' + CRUD.join(', ') + '.');
    }

    const stage = update.stage || STAGES.IMPLEMENTED;
    if (!ORDER.includes(stage)) throw new Error('Unsupported APU stage: ' + stage);

    const receipts = Array.isArray(update.receipts) ? update.receipts.map((receipt, index) => ({
      receipt_id: requiredString(receipt && receipt.receipt_id, 'receipts[' + index + '].receipt_id'),
      kind: requiredString(receipt && receipt.kind, 'receipts[' + index + '].kind'),
      evidence: requiredString(receipt && receipt.evidence, 'receipts[' + index + '].evidence'),
      at: requiredString(receipt && receipt.at, 'receipts[' + index + '].at')
    })) : [];

    return {
      schema: SCHEMA,
      update_id: requiredString(update.update_id, 'update_id'),
      resource: requiredString(update.resource, 'resource'),
      resource_id: typeof update.resource_id === 'string' && update.resource_id.trim()
        ? update.resource_id.trim()
        : null,
      operation,
      stage,
      receipts
    };
  }

  function createUpdate({ updateId, resource, resourceId = null, operation } = {}) {
    return normalize({
      schema: SCHEMA,
      update_id: updateId,
      resource,
      resource_id: resourceId,
      operation,
      stage: STAGES.IMPLEMENTED,
      receipts: []
    });
  }

  function promote(update, nextStage, receipt) {
    const current = normalize(update);
    const currentIndex = ORDER.indexOf(current.stage);
    const nextIndex = ORDER.indexOf(nextStage);
    if (nextIndex !== currentIndex + 1) {
      throw new Error('APU transition must be progressive: ' + current.stage + ' -> ' + nextStage + '.');
    }

    return normalize({
      ...current,
      stage: nextStage,
      receipts: [...current.receipts, receipt]
    });
  }

  function markLocalPoc(update, { receiptId, at = new Date().toISOString() } = {}) {
    const current = normalize(update);
    if (current.stage !== STAGES.IMPLEMENTED) {
      throw new Error('Local queue proof requires ' + STAGES.IMPLEMENTED + ', received ' + current.stage + '.');
    }

    return promote(current, STAGES.POC, {
      receipt_id: requiredString(receiptId, 'receiptId'),
      kind: 'crud-local-persistence',
      evidence: 'IndexedDB persisted the exact crisis update proposal for later synchronization.',
      at
    });
  }

  function assertSwfusReceipt(update, receipt) {
    const current = normalize(update);
    if (current.stage !== STAGES.POC) {
      throw new Error('SWFUS receipt requires ' + STAGES.POC + ', received ' + current.stage + '.');
    }
    if (!receipt || receipt.schema !== 'crisisconnect.swfus.receipt.v1') {
      throw new Error('Missing canonical CrisisConnect SWFUS receipt.');
    }
    if (receipt.update_id !== current.update_id || receipt.verdict !== 'SYNCED') {
      throw new Error('SWFUS receipt does not match this update proposal.');
    }
    if (!receipt.receipt_id || !receipt.observed_at) {
      throw new Error('SWFUS receipt is missing provenance.');
    }

    return promote(current, STAGES.SYNCED, {
      receipt_id: receipt.receipt_id,
      kind: 'swfus-server-persistence',
      evidence: 'A separately configured synchronization boundary witnessed the exact update proposal.',
      at: receipt.observed_at
    });
  }

  return {
    SCHEMA,
    STAGES,
    CRUD,
    normalize,
    createUpdate,
    promote,
    markLocalPoc,
    assertSwfusReceipt
  };
})();
