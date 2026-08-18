/* ═══════════════════════════════════════════════════════════════
   CrisisConnect — IndexedDB Sovereign Persistence Layer
   Local persistence is real; external dispatch is NOT implied.
   KPGS vNext: APU → progressive update → #NB → CRUD → SWFUS.
   I_AM_STATELESS_RENTER_NOT_LANDLORD
   ═══════════════════════════════════════════════════════════════ */

const CCDB = (function () {
  'use strict';

  const DB_NAME = 'CrisisConnectDB';
  const DB_VERSION = 2;

  const STORES = {
    INCIDENTS: 'incidents',
    QUEUE: 'offline_queue',
    EVIDENCE: 'evidence_ledger',
    PROJECTIONS: 'swfus_projections'
  };

  let _db = null;
  let _progressiveRuntimePromise = null;

  async function _ensureProgressiveRuntime() {
    if (typeof KPGSProgressive !== 'undefined') return KPGSProgressive;
    if (!_progressiveRuntimePromise) {
      _progressiveRuntimePromise = import('./kpgs_progressive.js');
    }
    await _progressiveRuntimePromise;
    if (typeof KPGSProgressive === 'undefined') {
      throw new Error('KPGS progressive runtime failed to initialize');
    }
    return KPGSProgressive;
  }

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) { resolve(_db); return; }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;

        if (!db.objectStoreNames.contains(STORES.INCIDENTS)) {
          const incStore = db.createObjectStore(STORES.INCIDENTS, { keyPath: 'id' });
          incStore.createIndex('severity', 'severity', { unique: false });
          incStore.createIndex('type', 'type', { unique: false });
          incStore.createIndex('trust', 'trust', { unique: false });
          incStore.createIndex('timestamp', 'timestamp', { unique: false });
          incStore.createIndex('synced', 'synced', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.QUEUE)) {
          const qStore = db.createObjectStore(STORES.QUEUE, { keyPath: 'id' });
          qStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        let evidenceStore;
        if (!db.objectStoreNames.contains(STORES.EVIDENCE)) {
          evidenceStore = db.createObjectStore(STORES.EVIDENCE, { keyPath: 'entry_id', autoIncrement: true });
          evidenceStore.createIndex('incident_id', 'incident_id', { unique: false });
          evidenceStore.createIndex('gate', 'gate', { unique: false });
          evidenceStore.createIndex('timestamp', 'timestamp', { unique: false });
        } else {
          evidenceStore = tx.objectStore(STORES.EVIDENCE);
        }
        if (!evidenceStore.indexNames.contains('update_id')) {
          evidenceStore.createIndex('update_id', 'update_id', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.PROJECTIONS)) {
          const projectionStore = db.createObjectStore(STORES.PROJECTIONS, { keyPath: 'node_id' });
          projectionStore.createIndex('version', 'version', { unique: false });
          projectionStore.createIndex('update_id', 'update_id', { unique: false });
          projectionStore.createIndex('state_class', 'state_class', { unique: false });
        }

        console.log('[CCDB] Schema upgraded to v' + DB_VERSION);
      };

      req.onsuccess = (e) => {
        _db = e.target.result;
        _db.onversionchange = () => {
          _db.close();
          _db = null;
        };
        console.log('[CCDB] Database opened — local persistence active');
        resolve(_db);
      };

      req.onerror = (e) => {
        console.error('[CCDB] Open failed:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  function _tx(storeName, mode) {
    return _db.transaction(storeName, mode).objectStore(storeName);
  }

  function _promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function _transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function _stableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(_stableJson).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + _stableJson(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  async function _sha256(value) {
    const data = new TextEncoder().encode(String(value));
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  async function _putIncidentLegacy(incident) {
    await open();
    return _promisify(_tx(STORES.INCIDENTS, 'readwrite').put(incident));
  }

  async function putIncident(incident) {
    if (!incident || typeof incident !== 'object' || !incident.id) {
      throw new Error('incident with stable id is required');
    }
    const runtime = await _ensureProgressiveRuntime();
    incident.synced = false;
    incident.local_swfus = false;
    const update = runtime.createIncidentUpdate(incident, {
      updateId: 'incident:create:' + incident.id,
      idempotencyKey: 'incident:create:' + incident.id,
      evidenceRef: 'report-form-valid:' + incident.id
    });
    const result = await executeProgressiveIncidentUpdate(update);
    if (result.receipt.disposition !== 'APPLIED') {
      throw new Error('incident persistence blocked: ' + result.receipt.disposition);
    }
    incident.local_swfus = true;
    incident.swfus_receipt_id = result.receipt.receipt_id;

    // Every real user report remains pending external distribution until an
    // actual remote sink returns evidence. Network availability alone cannot
    // erase that obligation.
    await enqueue({
      ...incident,
      progressive_update: update,
      local_swfus_receipt_id: result.receipt.receipt_id,
      external_dispatch_status: 'PENDING'
    });
    return result;
  }

  async function getIncident(id) {
    await open();
    return _promisify(_tx(STORES.INCIDENTS, 'readonly').get(id));
  }

  async function getAllIncidents() {
    await open();
    return _promisify(_tx(STORES.INCIDENTS, 'readonly').getAll());
  }

  async function deleteIncident(id) {
    await open();
    return _promisify(_tx(STORES.INCIDENTS, 'readwrite').delete(id));
  }

  async function countIncidents() {
    await open();
    return _promisify(_tx(STORES.INCIDENTS, 'readonly').count());
  }

  async function getIncidentsBySeverity(severity) {
    await open();
    return _promisify(_tx(STORES.INCIDENTS, 'readonly').index('severity').getAll(severity));
  }

  async function getIncidentsByTrust(trust) {
    await open();
    return _promisify(_tx(STORES.INCIDENTS, 'readonly').index('trust').getAll(trust));
  }

  async function getProjection(nodeId) {
    await open();
    return _promisify(_tx(STORES.PROJECTIONS, 'readonly').get(nodeId));
  }

  async function getEvidenceByUpdateId(updateId) {
    await open();
    const store = _tx(STORES.EVIDENCE, 'readonly');
    if (!store.indexNames.contains('update_id')) return [];
    return _promisify(store.index('update_id').getAll(updateId));
  }

  async function _finalizeReceipt(evaluation) {
    const stateDigest = evaluation.nextProjection === null
      ? null
      : await _sha256(_stableJson(evaluation.nextProjection));
    const receiptSeed = [
      evaluation.update.update_id,
      evaluation.receipt.disposition,
      stateDigest || 'none',
      evaluation.update.correlation_id
    ].join(':');
    return {
      ...evaluation.receipt,
      receipt_id: 'swfus_' + (await _sha256(receiptSeed)).slice(0, 24),
      state_digest: stateDigest,
      created_at: new Date().toISOString(),
      scope: 'crisisconnect_local_projection'
    };
  }

  async function executeProgressiveIncidentUpdate(rawUpdate) {
    await open();
    const runtime = await _ensureProgressiveRuntime();
    const update = runtime.normalize(rawUpdate);
    const priorReceipts = await getEvidenceByUpdateId(update.update_id);
    const replay = priorReceipts.find(entry => entry.swfus_receipt && entry.update_id === update.update_id);
    if (replay) {
      return {
        receipt: { ...replay.swfus_receipt, replayed: true },
        projection: await getProjection(update.node_id),
        distribution: replay.swfus_distribution || null,
        replayed: true
      };
    }

    const currentProjection = await getProjection(update.node_id);
    const evaluation = runtime.evaluate(update, currentProjection);
    const finalReceipt = await _finalizeReceipt(evaluation);
    const distribution = evaluation.distribution
      ? { ...evaluation.distribution, state_digest: finalReceipt.state_digest }
      : null;

    const stores = evaluation.receipt.disposition === 'APPLIED'
      ? [STORES.INCIDENTS, STORES.PROJECTIONS, STORES.EVIDENCE]
      : [STORES.EVIDENCE];
    const tx = _db.transaction(stores, 'readwrite');

    if (evaluation.receipt.disposition === 'APPLIED') {
      const incidentStore = tx.objectStore(STORES.INCIDENTS);
      const projectionStore = tx.objectStore(STORES.PROJECTIONS);
      if (update.operation === 'DELETE') {
        const incidentId = update.node_id.replace(/^incident:/, '');
        incidentStore.delete(incidentId);
        projectionStore.delete(update.node_id);
      } else {
        incidentStore.put({
          ...evaluation.nextProjection.value,
          synced: false,
          local_swfus: true,
          swfus_receipt_id: finalReceipt.receipt_id
        });
        projectionStore.put(evaluation.nextProjection);
      }
    }

    tx.objectStore(STORES.EVIDENCE).put({
      incident_id: update.node_id.replace(/^incident:/, ''),
      update_id: update.update_id,
      gate: 'KPGS_VNEXT_SWFUS',
      action: update.operation,
      verdict: finalReceipt.disposition,
      detail: 'APU → progressive update → #NB → bounded CRUD → local SWFUS projection',
      swfus_receipt: finalReceipt,
      swfus_distribution: distribution,
      timestamp: finalReceipt.created_at,
      constraint: 'I_AM_STATELESS_RENTER_NOT_LANDLORD',
      external_dispatch_claimed: false
    });

    await _transactionDone(tx);
    return {
      receipt: finalReceipt,
      projection: evaluation.nextProjection,
      distribution,
      replayed: false
    };
  }

  async function enqueue(item) {
    await open();
    if (!item || typeof item !== 'object' || !item.id) throw new Error('queued item requires stable id');
    const existing = await _promisify(_tx(STORES.QUEUE, 'readonly').get(item.id));
    const record = existing ? { ...item, ...existing } : item;
    return _promisify(_tx(STORES.QUEUE, 'readwrite').put(record));
  }

  async function dequeue(id, externalReceipt) {
    if (!externalReceipt || externalReceipt.external_dispatched !== true) {
      throw new Error('EXTERNAL_DISTRIBUTION_RECEIPT_REQUIRED');
    }
    await open();
    return _promisify(_tx(STORES.QUEUE, 'readwrite').delete(id));
  }

  async function getQueue() {
    await open();
    return _promisify(_tx(STORES.QUEUE, 'readonly').getAll());
  }

  function clearQueue(externalReceipt) {
    if (!externalReceipt || externalReceipt.external_dispatched !== true) {
      // Deliberately synchronous so legacy callers cannot continue to clear
      // their in-memory queue and announce a fabricated success after catching
      // an asynchronous rejection.
      throw new Error('EXTERNAL_DISTRIBUTION_RECEIPT_REQUIRED');
    }
    return open().then(() => _promisify(_tx(STORES.QUEUE, 'readwrite').clear()));
  }

  async function queueSize() {
    await open();
    return _promisify(_tx(STORES.QUEUE, 'readonly').count());
  }

  async function logEvidence(entry) {
    await open();
    const record = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
      constraint: 'I_AM_STATELESS_RENTER_NOT_LANDLORD'
    };
    return _promisify(_tx(STORES.EVIDENCE, 'readwrite').put(record));
  }

  async function getEvidenceForIncident(incidentId) {
    await open();
    return _promisify(_tx(STORES.EVIDENCE, 'readonly').index('incident_id').getAll(incidentId));
  }

  async function getAllEvidence() {
    await open();
    return _promisify(_tx(STORES.EVIDENCE, 'readonly').getAll());
  }

  async function getEvidenceByGate(gate) {
    await open();
    return _promisify(_tx(STORES.EVIDENCE, 'readonly').index('gate').getAll(gate));
  }

  async function seedIfEmpty(demoIncidents) {
    await open();
    const count = await countIncidents();
    if (count > 0) {
      console.log('[CCDB] Data already exists (' + count + ' incidents) — skip seed');
      return false;
    }

    const tx = _db.transaction(STORES.INCIDENTS, 'readwrite');
    const store = tx.objectStore(STORES.INCIDENTS);
    for (const inc of demoIncidents) {
      store.put({
        ...inc,
        timestamp: inc.timestamp || new Date().toISOString(),
        synced: false,
        local_swfus: false,
        demo: true
      });
    }

    await _transactionDone(tx);
    for (const inc of demoIncidents) {
      await logEvidence({
        incident_id: inc.id,
        gate: 'SEED',
        action: 'DEMO_DATA_LOADED',
        verdict: 'POC',
        detail: 'Initial demo incident loaded into IndexedDB; external dispatch not claimed'
      });
    }
    console.log('[CCDB] Seeded ' + demoIncidents.length + ' demo incidents');
    return true;
  }

  return {
    open,
    STORES,
    _putIncidentLegacy,
    putIncident,
    getIncident,
    getAllIncidents,
    deleteIncident,
    countIncidents,
    getIncidentsBySeverity,
    getIncidentsByTrust,
    getProjection,
    executeProgressiveIncidentUpdate,
    enqueue,
    dequeue,
    getQueue,
    clearQueue,
    queueSize,
    logEvidence,
    getEvidenceForIncident,
    getAllEvidence,
    getEvidenceByGate,
    getEvidenceByUpdateId,
    seedIfEmpty
  };
})();
