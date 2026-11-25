import React from 'react';
import { ArrowRight, KeyRound, Lock } from 'lucide-react';

export interface CisoDualCustodySeatProps {
  cisoCosignVerified: boolean;
  fido2AssertionId: string | null;
  busy: boolean;
  onCisoCosign: () => void;
  onViewReflection: () => void;
}

export function CisoDualCustodySeat({
  cisoCosignVerified,
  fido2AssertionId,
  busy,
  onCisoCosign,
  onViewReflection
}: CisoDualCustodySeatProps): React.ReactElement {
  return (
    <section className="surface-card" style={{ padding: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <KeyRound size={16} />
          CISO · Tier-3 Break-Glass Vault
        </h2>
        <span className={`badge ${cisoCosignVerified ? 'badge-emerald' : 'badge-amber'}`}>
          {cisoCosignVerified ? 'Co-Signed' : 'Dual-Custody Gate'}
        </span>
      </div>

      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Tier 3 Global Fleet Circuit Breaker fails closed (<code className="mono">403 DUAL_CUSTODY_REQUIRED</code>) until Morgan Vance signs with a hardware FIDO2 key.
      </p>

      <button
        type="button"
        disabled={busy || cisoCosignVerified}
        className="btn-primary"
        onClick={onCisoCosign}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
      >
        <Lock size={14} />
        <span>
          {cisoCosignVerified
            ? `Co-Signed (${fido2AssertionId})`
            : 'Sign Tier-3 FIDO2 Dual-Custody Challenge'}
        </span>
      </button>

      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={onViewReflection}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <span>View Reflection &amp; Timeline</span>
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
