import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createInitialFleet,
  createInitialGates,
  createInitialSecOpsState,
  createSecOpsSessionId,
  createSecOpsSpan,
  generateTraceparent
} from '../src/engine/secopsResilienceEngine';

describe('Lab 3 Engine (secopsResilienceEngine)', () => {
  it('generates valid session IDs and W3C traceparent headers', () => {
    const sid = createSecOpsSessionId();
    assert.match(sid, /^vis_lab3_[0-9a-f]{10}$/);

    const tp = generateTraceparent();
    assert.match(tp, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('creates observability spans preserving trace_id and parent_span_id', () => {
    const parent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const span = createSecOpsSpan({
      sessionId: 'vis_lab3_test000001',
      traceparent: parent,
      method: 'POST',
      path: '/api/secops-resilience/verify-bom',
      status: 200,
      latencyMs: 18,
      origin: 'cloudflare-edge',
      summary: { bom_status: 'AI_BOM_ATTESTED' }
    });

    assert.equal(span.trace_id, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.equal(span.parent_span_id, '00f067aa0ba902b7');
    assert.equal(span.status, 200);
    assert.equal(span.execution_origin, 'cloudflare-edge');
  });

  it('initializes gates, fleet, and SecOpsResilienceState with safe defaults', () => {
    const gates = createInitialGates();
    assert.equal(gates.length, 5);
    assert.ok(gates.every((g) => g.status === 'WAITING'));

    const fleet = createInitialFleet();
    assert.ok(fleet.length >= 2);
    assert.ok(fleet.every((n) => n.status === 'ACTIVE'));

    const state = createInitialSecOpsState('vis_lab3_abcde12345');
    assert.equal(state.sessionId, 'vis_lab3_abcde12345');
    assert.equal(state.activeKillSwitchTier, 'NONE');
    assert.equal(state.enforceHashPinning, false);
  });
});
