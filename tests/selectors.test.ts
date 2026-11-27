import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countBlockedGates,
  countQuarantinedNodes,
  getGateBadgeMeta,
  isCisoCosignRequired,
  isKillSwitchEscalated
} from '../src/engine/secopsResilienceSelectors';
import {
  createInitialFleet,
  createInitialGates
} from '../src/engine/secopsResilienceEngine';

describe('Lab 3 Pure UI Selectors (secopsResilienceSelectors)', () => {
  it('maps GateStatus to expected badge className and label', () => {
    assert.deepEqual(getGateBadgeMeta('CHECKING'), { className: 'badge-blue', label: 'CHECKING' });
    assert.deepEqual(getGateBadgeMeta('PASS'), { className: 'badge-emerald', label: 'PASS' });
    assert.deepEqual(getGateBadgeMeta('BLOCK'), { className: 'badge-crimson', label: 'BLOCK' });
    assert.deepEqual(getGateBadgeMeta('WAITING'), { className: 'badge', label: 'WAITING' });
  });

  it('counts blocked gates and quarantined fleet nodes', () => {
    const gates = createInitialGates();
    assert.equal(countBlockedGates(gates), 0);
    gates[1].status = 'BLOCK';
    gates[2].status = 'BLOCK';
    assert.equal(countBlockedGates(gates), 2);

    const fleet = createInitialFleet();
    assert.equal(countQuarantinedNodes(fleet), 0);
    fleet[0].status = 'MCP_FROZEN';
    assert.equal(countQuarantinedNodes(fleet), 1);
  });

  it('evaluates kill-switch escalation and CISO dual-custody requirement', () => {
    assert.equal(isKillSwitchEscalated('NONE'), false);
    assert.equal(isKillSwitchEscalated('TIER_1_MCP_FREEZE'), true);
    assert.equal(isKillSwitchEscalated('TIER_3_GLOBAL_BREAKER'), true);

    assert.equal(isCisoCosignRequired('TIER_2_IAM_DENY', false), false);
    assert.equal(isCisoCosignRequired('TIER_3_GLOBAL_BREAKER', false), true);
    assert.equal(isCisoCosignRequired('TIER_3_GLOBAL_BREAKER', true), false);
  });
});
