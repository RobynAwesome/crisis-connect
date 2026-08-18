# CrisisConnect APU → Progressive Update → #NB → CRUD → SWFUS

**Authority origin:** `RobynAwesome/Introduction-to-MCP` current `master`  
**Canonical guidance:** `governance/kpgs-vnext/progressive-updates/README.md`  
**Canonical schema:** `governance/kpgs-vnext/progressive-updates/progressive-update.schema.json`  
**Canonical runtime reference:** `kopano-core/kopano/swfus_engine.py`

CrisisConnect is a critical-service Adaptive PWA. Its local-first behavior must stay useful under degraded connectivity without turning browser availability into a false claim that an incident reached an external responder.

```text
USER REPORT
   ↓
Adaptive PWA form
   ↓
POC-valid local proposal
   ↓
kpgs.progressive-update.v1
   ↓
#NB
   ↓
bounded CRUD
   ↓
SWFUS
State-Wide Framework Universal Synchronization
   ↓
IndexedDB non-authoritative incident projection
+ evidence receipt
   ↓
PENDING EXTERNAL DISTRIBUTION
```

## Local SWFUS scope

`kpgs_progressive.js` implements the current canonical stage order:

```text
TELEMETRY
→ CLASSIFICATION
→ ROUTING
→ PROTOCOL_SELECTION
→ INVARIANT_AUDIT
→ POC_FOC_CHECK
→ STATE_UPDATE
→ DISTRIBUTION
```

The local projection is explicitly `pending_proposal`, `derived_projection`, or `non_authoritative`. `authority_effect` remains `none`, the boundary marker remains the literal `#NB`, and distribution metadata states both `canonical=false` and `transport_grants_authority=false`.

`db.js` persists an admitted incident mutation, SWFUS projection, and evidence receipt in one IndexedDB transaction. A failed transaction does not receive an applied local consequence receipt.

## Live / virtual adaptation

The user can continue to work while offline or under degraded network conditions. The browser renders the locally persisted projection as the live working view, but that view is not promoted into external emergency-service truth.

Network restoration therefore changes transport opportunity, not authority:

```text
OFFLINE / DEGRADED
→ local report remains usable
→ local SWFUS receipt exists
→ external distribution stays PENDING

ONLINE
→ transport becomes possible
→ external distribution still stays PENDING
→ queue may clear only after an external-distribution receipt exists
```

## Anti-FOC correction

The previous service-worker path emitted `SYNC_COMPLETE` without sending queued incidents to any external sink, and the UI force-sync path could clear the local queue after a timer. Those behaviors represented availability as synchronization proof.

The hardened path now refuses that inference:

- the service worker emits `SYNC_HELD_NO_EXTERNAL_SINK` instead of `SYNC_COMPLETE`;
- `CCDB.clearQueue()` and `CCDB.dequeue()` require an explicit receipt with `external_dispatched=true`;
- user-created reports are queued for external distribution even when `navigator.onLine` is true;
- local records carry `synced=false` even after local SWFUS application;
- the evidence ledger records `external_dispatch_claimed=false`.

Until an external transport is actually configured and returns a bounded receipt, CrisisConnect must not say that a submitted report reached SAPS, EMS, municipal responders, shelters, operators, or any other external party.

## Hard laws

```text
CONNECTIVITY != DELIVERY
LOCAL PERSISTENCE != EXTERNAL DISPATCH
LOCAL SWFUS APPLIED != RESPONDER ACKNOWLEDGEMENT
BACKGROUND SYNC EVENT != SYNC COMPLETE
QUEUE TIMER != DELIVERY RECEIPT
CRUD CHANGES BOUNDED STATE
SWFUS ALIGNS GOVERNED SYSTEM REALITY
SYNCHRONIZATION != AUTHORITY
#NB REMAINS LITERAL
FOC / RED => NO MUTATION
YELLOW => HOLD
STALE VERSION => HOLD
EXTERNAL QUEUE DELETE => EXTERNAL RECEIPT REQUIRED
```

## Current proof ceiling

The repository can prove the canonical local progressive membrane and non-authoritative IndexedDB consequence when CI is green on the exact commit SHA. It does **not** currently prove external responder delivery, external acknowledgement, production emergency-service integration, or live-domain deployment of this branch.
