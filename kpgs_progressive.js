/* CrisisConnect adapter for the canonical KPGS vNext progressive-update contract.
 * Authority: RobynAwesome/Introduction-to-MCP
 * governance/kpgs-vnext/progressive-updates/README.md
 *
 * This runtime only governs non-authoritative local projections. It does not
 * claim dispatch, responder acknowledgement, canonical incident truth, or
 * emergency-service delivery.
 */
(function (root) {
  'use strict';

  const SCHEMA = 'kpgs.progressive-update.v1';
  const RECEIPT_SCHEMA = 'kpgs.swfus.receipt.v1';
  const DISTRIBUTION_SCHEMA = 'kpgs.swfus.distribution.v1';
  const BOUNDARY = '#NB';
  const CRUD = Object.freeze(['CREATE', 'READ', 'UPDATE', 'DELETE']);
  const APU = Object.freeze(['GREEN', 'YELLOW', 'RED', 'UNSPECIFIED']);
  const STATE_CLASSES = Object.freeze(['non_authoritative', 'derived_projection', 'pending_proposal']);
  const STAGES = Object.freeze([
    'TELEMETRY',
    'CLASSIFICATION',
    'ROUTING',
    'PROTOCOL_SELECTION',
    'INVARIANT_AUDIT',
    'POC_FOC_CHECK',
    'STATE_UPDATE',
    'DISTRIBUTION'
  ]);

  function requiredString(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(field + ' must be a non-empty string');
    return value.trim();
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('progressive update must be an object');
    const operation = requiredString(raw.operation, 'operation').toUpperCase();
    const apuStatus = requiredString(raw.apu_status || 'UNSPECIFIED', 'apu_status').toUpperCase();
    const stateClass = requiredString(raw.state_class, 'state_class');
    const evidenceRefs = Array.isArray(raw.evidence_refs)
      ? raw.evidence_refs.map((item, index) => requiredString(item, 'evidence_refs[' + index + ']'))
      : [];

    if ((raw.schema || SCHEMA) !== SCHEMA) throw new Error('unsupported progressive-update schema');
    if (!CRUD.includes(operation)) throw new Error('unsupported CRUD operation');
    if (!APU.includes(apuStatus)) throw new Error('unsupported APU status');
    if (!STATE_CLASSES.includes(stateClass)) throw new Error('authoritative state class is not admitted');
    if (raw.authority_effect !== 'none') throw new Error('authority_effect must remain none');
    if (raw.boundary_marker !== BOUNDARY) throw new Error('#NB boundary marker is required');
    if (typeof raw.poc_validated !== 'boolean') throw new Error('poc_validated must be boolean');
    if (typeof raw.foc_detected !== 'boolean') throw new Error('foc_detected must be boolean');
    if (typeof raw.invariant_passed !== 'boolean') throw new Error('invariant_passed must be boolean');
    if (raw.expected_version !== null && raw.expected_version !== undefined &&
        (!Number.isInteger(raw.expected_version) || raw.expected_version < 0)) {
      throw new Error('expected_version must be null or a non-negative integer');
    }
    if (operation !== 'READ' && (!raw.poc_validated || raw.foc_detected || evidenceRefs.length === 0)) {
      throw new Error('mutating updates require POC evidence and foc_detected=false');
    }

    return {
      schema: SCHEMA,
      update_id: requiredString(raw.update_id, 'update_id'),
      node_id: requiredString(raw.node_id, 'node_id'),
      operation,
      lane: requiredString(raw.lane, 'lane'),
      context_route: requiredString(raw.context_route, 'context_route'),
      protocol: requiredString(raw.protocol, 'protocol'),
      idempotency_key: requiredString(raw.idempotency_key, 'idempotency_key'),
      value: raw.value === undefined ? null : raw.value,
      apu_status: apuStatus,
      poc_validated: raw.poc_validated,
      foc_detected: raw.foc_detected,
      invariant_passed: raw.invariant_passed,
      authority_effect: 'none',
      state_class: stateClass,
      evidence_refs: Array.from(new Set(evidenceRefs)),
      correlation_id: typeof raw.correlation_id === 'string' ? raw.correlation_id : '',
      source: typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : 'crisisconnect-apu',
      expected_version: raw.expected_version === undefined ? null : raw.expected_version,
      boundary_marker: BOUNDARY
    };
  }

  function stage(name, status, reason) {
    return { stage: name, status, reason };
  }

  function complete(stages) {
    const seen = new Set(stages.map(item => item.stage));
    STAGES.forEach(name => {
      if (!seen.has(name)) stages.push(stage(name, 'NOT_REACHED', 'prior governance gate stopped progression'));
    });
    return stages;
  }

  function receipt(update, disposition, stages, synchronized) {
    return {
      schema: RECEIPT_SCHEMA,
      receipt_id: null,
      update_id: update.update_id,
      node_id: update.node_id,
      operation: update.operation,
      disposition,
      stages: complete(stages),
      synchronized: Boolean(synchronized),
      canonical_authority_changed: false,
      state_digest: null,
      evidence_refs: [...update.evidence_refs],
      correlation_id: update.correlation_id,
      boundary_marker: BOUNDARY,
      replayed: false,
      created_at: null,
      scope: 'crisisconnect_local_projection'
    };
  }

  function evaluate(raw, currentProjection) {
    const update = normalize(raw);
    const current = currentProjection || null;
    const stages = [
      stage('TELEMETRY', 'PASS', 'update identity accepted'),
      stage('CLASSIFICATION', 'PASS', 'lane=' + update.lane + '; apu=' + update.apu_status),
      stage('ROUTING', 'PASS', 'route=' + update.context_route)
    ];

    if (update.operation === 'READ') {
      stages.push(stage('PROTOCOL_SELECTION', 'SKIP', 'read requires no mutation protocol'));
      stages.push(stage('INVARIANT_AUDIT', 'SKIP', 'observation is not mutation'));
      stages.push(stage('POC_FOC_CHECK', 'SKIP', 'read cannot promote state'));
      stages.push(stage('STATE_UPDATE', 'OBSERVE', 'projection read only'));
      stages.push(stage('DISTRIBUTION', 'SKIP', 'read is not a synchronized mutation'));
      return { update, nextProjection: current, distribution: null, receipt: receipt(update, 'OBSERVED', stages, false) };
    }

    stages.push(stage('PROTOCOL_SELECTION', 'PASS', 'protocol=' + update.protocol));
    if (!update.invariant_passed || update.authority_effect !== 'none' || update.boundary_marker !== BOUNDARY ||
        (typeof update.value === 'number' && !Number.isFinite(update.value))) {
      stages.push(stage('INVARIANT_AUDIT', 'REJECT', 'mutation invariant failed'));
      return { update, nextProjection: current, distribution: null, receipt: receipt(update, 'REJECTED', stages, false) };
    }
    stages.push(stage('INVARIANT_AUDIT', 'PASS', 'authority and mutation invariants preserved'));

    if (update.apu_status === 'RED' || update.foc_detected) {
      stages.push(stage('POC_FOC_CHECK', 'REJECT', 'FOC/RED cannot mutate or distribute'));
      return { update, nextProjection: current, distribution: null, receipt: receipt(update, 'REJECTED', stages, false) };
    }
    if (update.apu_status === 'YELLOW') {
      stages.push(stage('POC_FOC_CHECK', 'HOLD', 'APU YELLOW requires review'));
      return { update, nextProjection: current, distribution: null, receipt: receipt(update, 'HELD', stages, false) };
    }
    stages.push(stage('POC_FOC_CHECK', 'PASS', 'POC evidence admitted; FOC absent'));

    const currentVersion = current ? current.version : 0;
    if (update.expected_version !== null && update.expected_version !== currentVersion) {
      stages.push(stage('STATE_UPDATE', 'HOLD', 'expected_version does not match projection'));
      return { update, nextProjection: current, distribution: null, receipt: receipt(update, 'HELD', stages, false) };
    }

    let nextProjection = null;
    if (update.operation === 'CREATE') {
      if (current) {
        stages.push(stage('STATE_UPDATE', 'HOLD', 'CREATE target already exists'));
        return { update, nextProjection: current, distribution: null, receipt: receipt(update, 'HELD', stages, false) };
      }
      nextProjection = {
        node_id: update.node_id,
        value: update.value,
        version: 1,
        state_class: update.state_class,
        authority_effect: 'none',
        update_id: update.update_id
      };
    } else if (update.operation === 'UPDATE') {
      if (!current) {
        stages.push(stage('STATE_UPDATE', 'HOLD', 'UPDATE target does not exist'));
        return { update, nextProjection: null, distribution: null, receipt: receipt(update, 'HELD', stages, false) };
      }
      nextProjection = {
        node_id: update.node_id,
        value: update.value,
        version: currentVersion + 1,
        state_class: update.state_class,
        authority_effect: 'none',
        update_id: update.update_id
      };
    } else {
      if (!current) {
        stages.push(stage('STATE_UPDATE', 'HOLD', 'DELETE target does not exist'));
        return { update, nextProjection: null, distribution: null, receipt: receipt(update, 'HELD', stages, false) };
      }
      nextProjection = null;
    }

    stages.push(stage('STATE_UPDATE', 'PASS', 'bounded non-authoritative projection prepared'));
    const distribution = {
      schema: DISTRIBUTION_SCHEMA,
      update_id: update.update_id,
      node_id: update.node_id,
      operation: update.operation,
      evidence_refs: [...update.evidence_refs],
      correlation_id: update.correlation_id,
      authority_effect: 'none',
      canonical: false,
      transport_grants_authority: false,
      scope: 'crisisconnect_local_projection'
    };
    stages.push(stage('DISTRIBUTION', 'PASS', 'local framework alignment prepared without authority widening'));
    return { update, nextProjection, distribution, receipt: receipt(update, 'APPLIED', stages, true) };
  }

  function createIncidentUpdate(incident, options) {
    const opts = options || {};
    const operation = (opts.operation || 'CREATE').toUpperCase();
    const updateId = requiredString(opts.updateId || ('incident:update:' + incident.id), 'updateId');
    return normalize({
      schema: SCHEMA,
      update_id: updateId,
      node_id: 'incident:' + incident.id,
      operation,
      lane: 'crisisconnect.incident-projection',
      context_route: navigator && navigator.onLine ? 'crisisconnect.live' : 'crisisconnect.offline',
      protocol: 'KPGS-vNext/APU-CRUD-SWFUS',
      idempotency_key: requiredString(opts.idempotencyKey || updateId, 'idempotencyKey'),
      value: incident,
      apu_status: opts.apuStatus || 'UNSPECIFIED',
      poc_validated: true,
      foc_detected: false,
      invariant_passed: true,
      authority_effect: 'none',
      state_class: 'pending_proposal',
      evidence_refs: [opts.evidenceRef || ('local-form-validation:' + incident.id)],
      correlation_id: opts.correlationId || updateId,
      source: 'crisisconnect-report-form',
      expected_version: opts.expectedVersion === undefined ? null : opts.expectedVersion,
      boundary_marker: BOUNDARY
    });
  }

  root.KPGSProgressive = Object.freeze({
    SCHEMA,
    RECEIPT_SCHEMA,
    DISTRIBUTION_SCHEMA,
    BOUNDARY,
    CRUD,
    STAGES,
    normalize,
    evaluate,
    createIncidentUpdate
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
