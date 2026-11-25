import React from 'react';
import { ShieldAlert, Zap } from 'lucide-react';
import { KillSwitchTierId, RuntimeScenarioId } from '../../contracts/secopsContract';

export interface SocKillSwitchSeatProps {
  activeKillSwitchTier: KillSwitchTierId;
  canaryTripped: boolean;
  velocityAlertActive: boolean;
  cisoCosignVerified: boolean;
  busy: boolean;
  onRunRuntimeProbe: (scenario: RuntimeScenarioId) => void;
  onTriggerKillSwitch: (
    action: 'TIER_1_MCP_FREEZE' | 'TIER_2_IAM_DENY' | 'TIER_3_GLOBAL_BREAKER' | 'RESET'
  ) => void;
}

export function SocKillSwitchSeat({
  activeKillSwitchTier,
  canaryTripped,
  velocityAlertActive,
  cisoCosignVerified,
  busy,
  onRunRuntimeProbe,
  onTriggerKillSwitch
}: SocKillSwitchSeatProps): React.ReactElement {
  return (
    <section className="surface-card" style={{ padding: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <ShieldAlert size={16} />
          SOC Lead · Canary &amp; 3-Tier Kill Switch
        </h2>
        <span
          className={`badge ${
            activeKillSwitchTier !== 'NONE'
              ? 'badge-emerald'
              : canaryTripped || velocityAlertActive
                ? 'badge-crimson'
                : 'badge-blue'
          }`}
        >
          {activeKillSwitchTier !== 'NONE'
            ? activeKillSwitchTier
            : canaryTripped
              ? 'CANARY TRIPPED'
              : 'ARMED'}
        </span>
      </div>

      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
        Inject Runtime Incident:
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
        <button
          type="button"
          disabled={busy}
          className="btn-secondary"
          onClick={() => onRunRuntimeProbe('INDIRECT_INJECTION_CANARY')}
        >
          Trap 3B: CUST-CANARY-999
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-secondary"
          onClick={() => onRunRuntimeProbe('RUNAWAY_COST_LOOP')}
        >
          Trap 3C: Runaway Loop (&gt;$50/m)
        </button>
      </div>

      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
        3-Tier Kill Switchboard:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          type="button"
          disabled={busy}
          className="btn-secondary"
          onClick={() => onTriggerKillSwitch('TIER_1_MCP_FREEZE')}
          style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}
        >
          <span>Tier 1: Surgical MCP Tool Freeze</span>
          <span className="mono" style={{ fontSize: '11px' }}>38ms</span>
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-secondary"
          onClick={() => onTriggerKillSwitch('TIER_2_IAM_DENY')}
          style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}
        >
          <span>Tier 2: Identity Quarantine &amp; IAM Deny *</span>
          <span className="mono" style={{ fontSize: '11px' }}>112ms</span>
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-primary"
          onClick={() => onTriggerKillSwitch('TIER_3_GLOBAL_BREAKER')}
          style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Zap size={14} />
            Tier 3: Global Fleet Circuit Breaker (2-of-2)
          </span>
          <span className="mono" style={{ fontSize: '11px' }}>
            {cisoCosignVerified ? 'UNLOCKED' : 'LOCKED'}
          </span>
        </button>
      </div>
    </section>
  );
}
