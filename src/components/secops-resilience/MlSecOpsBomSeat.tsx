import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { BomBuildPresetId } from '../../contracts/secopsContract';

export interface MlSecOpsBomSeatProps {
  enforceHashPinning: boolean;
  busy: boolean;
  onToggleHashPinning: (checked: boolean) => void;
  onRunPipeline: (preset: BomBuildPresetId) => void;
}

export function MlSecOpsBomSeat({
  enforceHashPinning,
  busy,
  onToggleHashPinning,
  onRunPipeline
}: MlSecOpsBomSeatProps): React.ReactElement {
  return (
    <section className="surface-card" style={{ padding: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <ShieldCheck size={16} />
          MLSecOps · AI-BOM Admission Gate
        </h2>
        <span className={`badge ${enforceHashPinning ? 'badge-emerald' : 'badge-amber'}`}>
          {enforceHashPinning ? 'Hash Pinning ON' : 'Tag-Only (Vulnerable)'}
        </span>
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          padding: '10px',
          borderRadius: '8px',
          backgroundColor: 'var(--bg-elevated)',
          cursor: 'pointer',
          marginBottom: '12px'
        }}
      >
        <input
          type="checkbox"
          checked={enforceHashPinning}
          onChange={(e) => onToggleHashPinning(e.target.checked)}
        />
        <span>Enforce CycloneDX AI-BOM Prompt SHA-256 &amp; Cosign Pinning</span>
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <button
          type="button"
          disabled={busy}
          className="btn-secondary"
          onClick={() => onRunPipeline('MUTATED_PROMPT_3A')}
        >
          Test Trap 3A (Mutated Prompt)
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-primary"
          onClick={() => onRunPipeline('VERIFIED_PINNED')}
        >
          Deploy Attested Build
        </button>
      </div>
    </section>
  );
}
