import React, { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  KeyRound,
  Lock,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Zap
} from 'lucide-react';
import {
  BomBuildPresetId,
  CognitivePhase,
  GateStatus,
  RuntimeScenarioId,
  SecOpsResilienceState,
  SecOpsSeatId
} from '../contracts/secopsContract';
import {
  callCanaryProbeApi,
  callKillSwitchApi,
  callVerifyBomApi,
  createInitialSecOpsState,
  EXPECTED_PROMPT_SHA256,
  MUTATED_PROMPT_SHA256
} from '../engine/secopsResilienceEngine';
import { RoleSeatItem, RoleSwitcherBar } from '../components/RoleSwitcherBar';
import { XRayDecodedProofSection, XRayTelemetryDrawer } from '../components/XRayTelemetryDrawer';
import { ObservabilitySpan } from '../types';

export interface SecOpsResiliencePageProps {
  onBack: () => void;
}

function getGateBadge(status: GateStatus): React.ReactElement {
  switch (status) {
    case 'CHECKING':
      return <span className="badge badge-blue">CHECKING</span>;
    case 'PASS':
      return <span className="badge badge-emerald">PASS</span>;
    case 'BLOCK':
      return <span className="badge badge-crimson">BLOCK</span>;
    default:
      return <span className="badge">WAITING</span>;
  }
}

export function SecOpsResiliencePage({ onBack }: SecOpsResiliencePageProps): React.ReactElement {
  const [state, setState] = useState<SecOpsResilienceState>(() => createInitialSecOpsState());
  const [spans, setSpans] = useState<ObservabilitySpan[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    tone: 'info' | 'success' | 'warn' | 'error';
    text: string;
  } | null>(null);

  const appendSpan = useCallback((span: ObservabilitySpan) => {
    setSpans((prev) => [span, ...prev].slice(0, 40));
  }, []);

  const handleReset = useCallback(() => {
    setState(createInitialSecOpsState());
    setSpans([]);
    setStatusBanner({ tone: 'info', text: 'Sandbox reset to clean baseline ($0.00/mo · 1h TTL).' });
  }, []);

  const seats: RoleSeatItem<SecOpsSeatId>[] = useMemo(() => {
    const mlBadge =
      state.bomVerificationStatus === 'AI_BOM_HASH_MISMATCH'
        ? { text: 'Blocked 3A', tone: 'emerald' as const }
        : state.bomVerificationStatus === 'AI_BOM_TAG_ONLY_BYPASS'
          ? { text: 'Drift Bypass', tone: 'amber' as const, pulse: true }
          : state.bomVerificationStatus === 'AI_BOM_ATTESTED'
            ? { text: 'Attested', tone: 'emerald' as const }
            : state.enforceHashPinning
              ? { text: 'Pinning On', tone: 'blue' as const }
              : { text: 'Tag-Only', tone: 'neutral' as const };

    const socBadge =
      state.activeKillSwitchTier !== 'NONE'
        ? { text: state.activeKillSwitchTier.replace(/_/g, ' '), tone: 'emerald' as const }
        : state.canaryTripped || state.velocityAlertActive
          ? { text: 'CANARY ALERT', tone: 'crimson' as const, pulse: true }
          : { text: 'Monitoring', tone: 'blue' as const };

    const cisoBadge = state.cisoCosignVerified
      ? { text: 'FIDO2 Signed', tone: 'emerald' as const }
      : state.cisoCosignRequested || state.tier3BlockedWithoutCosign
        ? { text: 'Co-Sign Req', tone: 'amber' as const, pulse: true }
        : { text: 'Standby', tone: 'neutral' as const };

    return [
      {
        id: 'mlsecops',
        name: 'Kieran Patel',
        roleLabel: 'MLSecOps · CI/CD & AI-BOM Gate',
        appLabel: 'Supply-Chain Admission Console',
        badge: mlBadge
      },
      {
        id: 'soc-commander',
        name: 'Nadia Morales',
        roleLabel: 'SOC Lead · Runtime War Room',
        appLabel: 'Canary & Kill-Switchboard',
        badge: socBadge
      },
      {
        id: 'ciso-cosigner',
        name: 'Morgan Vance',
        roleLabel: 'CISO · Dual-Custody Co-Signer',
        appLabel: 'Tier-3 Break-Glass Vault',
        badge: cisoBadge
      }
    ];
  }, [state]);

  const runSupplyChainPipeline = useCallback(
    async (presetOverride?: BomBuildPresetId, pinningOverride?: boolean) => {
      const preset = presetOverride ?? state.selectedBuildPreset;
      const enforce = pinningOverride ?? state.enforceHashPinning;
      setBusy(true);

      // Animate WAITING -> CHECKING
      setState((prev) => ({
        ...prev,
        selectedBuildPreset: preset,
        enforceHashPinning: enforce,
        gates: prev.gates.map((g) => ({
          ...g,
          status: 'CHECKING',
          detail: 'Evaluating gate...'
        }))
      }));

      await new Promise((r) => setTimeout(r, 140));
      const res = await callVerifyBomApi({
        sessionId: state.sessionId,
        preset,
        enforceHashPinning: enforce
      });
      appendSpan(res.span);

      const blocked = res.status === 403;
      const bypassed = res.bomStatus === 'AI_BOM_TAG_ONLY_BYPASS';

      setState((prev) => ({
        ...prev,
        bomVerificationStatus: res.bomStatus,
        lastCycloneDxBom: res.cyclonedxBom,
        lastRekorEntry: res.rekorEntry,
        gates: prev.gates.map((g) => {
          if (g.id === 'signed_commit') {
            return { ...g, status: 'PASS', detail: 'GitHub GPG hardware key verified' };
          }
          if (g.id === 'cyclonedx_aibom') {
            return {
              ...g,
              status: blocked ? 'BLOCK' : 'PASS',
              detail: blocked
                ? 'Blocked Trap 3A: system_prompt_sha256 mismatch'
                : bypassed
                  ? 'Naive tag-only check passed despite mutated prompt!'
                  : 'Model, prompt SHA-256 & MCP schema pinned'
            };
          }
          if (g.id === 'ephemeral_oidc_build') {
            return {
              ...g,
              status: blocked ? 'WAITING' : 'PASS',
              detail: blocked ? 'Halted by Gate 2' : 'Ephemeral OIDC workload token issued'
            };
          }
          if (g.id === 'sigstore_cosign') {
            return {
              ...g,
              status: blocked ? 'WAITING' : 'PASS',
              detail: blocked ? 'Halted by Gate 2' : 'Rekor log #148920412 verified'
            };
          }
          return {
            ...g,
            status: blocked ? 'BLOCK' : 'PASS',
            detail: blocked
              ? 'Admission denied (403 AI_BOM_HASH_MISMATCH)'
              : bypassed
                ? 'Admitted with unpinned prompt drift!'
                : 'Admitted to Cloudflare Edge Runtime'
          };
        }),
        timeline: [
          ...prev.timeline,
          {
            id: `tl_${Date.now()}`,
            timestamp: new Date().toISOString(),
            tPlusMs: prev.timeline.length * 45 + 18,
            actor: 'Kieran Patel (MLSecOps)',
            action: `Verify AI-BOM (${preset}, pinning=${String(enforce)})`,
            outcome: blocked ? 'BLOCKED' : 'ATTESTED',
            detail: res.message
          }
        ]
      }));

      setStatusBanner({
        tone: blocked ? 'success' : bypassed ? 'warn' : 'success',
        text: res.message
      });
      setBusy(false);
    },
    [appendSpan, state.enforceHashPinning, state.selectedBuildPreset, state.sessionId]
  );

  const runRuntimeProbe = useCallback(
    async (scenario: RuntimeScenarioId) => {
      setBusy(true);
      const res = await callCanaryProbeApi({
        sessionId: state.sessionId,
        scenario
      });
      appendSpan(res.span);

      setState((prev) => ({
        ...prev,
        runtimeScenario: scenario,
        canaryTripped: res.canaryTriggered,
        velocityAlertActive: res.velocityExceeded,
        containmentClockMs: res.tripped ? res.containmentMs : prev.containmentClockMs,
        lastCanaryAlert: res.alertPayload,
        fleet: prev.fleet.map((node) =>
          node.id === 'agent-erp-support-01'
            ? {
                ...node,
                tokenVelocityUsdPerMin: res.velocityExceeded ? 84.5 : 1.25,
                lastToolCall: res.canaryTriggered
                  ? 'export_ticket(CUST-CANARY-999)'
                  : res.velocityExceeded
                    ? 'recursive_tool_loop(depth=47)'
                    : 'get_order_status(ORD-8821)'
              }
            : node
        ),
        timeline: [
          ...prev.timeline,
          {
            id: `tl_${Date.now()}`,
            timestamp: new Date().toISOString(),
            tPlusMs: prev.timeline.length * 45 + res.containmentMs,
            actor: 'Runtime Canary Guard',
            action: `Runtime Probe (${scenario})`,
            outcome: res.tripped ? 'DETECTED' : 'ATTESTED',
            detail: res.message
          }
        ]
      }));

      setStatusBanner({
        tone: res.tripped ? 'error' : 'success',
        text: res.message
      });
      setBusy(false);
    },
    [appendSpan, state.sessionId]
  );

  const triggerKillSwitch = useCallback(
    async (action: 'TIER_1_MCP_FREEZE' | 'TIER_2_IAM_DENY' | 'TIER_3_GLOBAL_BREAKER' | 'RESET') => {
      setBusy(true);
      const res = await callKillSwitchApi({
        sessionId: state.sessionId,
        action,
        cisoCosignVerified: state.cisoCosignVerified,
        fido2AssertionId: state.fido2AssertionId
      });
      appendSpan(res.span);

      if (!res.allowed) {
        setState((prev) => ({
          ...prev,
          tier3BlockedWithoutCosign: true,
          cisoCosignRequested: true,
          timeline: [
            ...prev.timeline,
            {
              id: `tl_${Date.now()}`,
              timestamp: new Date().toISOString(),
              tPlusMs: prev.timeline.length * 45 + 12,
              actor: 'Nadia Morales (SOC Lead)',
              action: 'Attempt Tier 3 Global Breaker',
              outcome: 'BLOCKED',
              detail: res.message
            }
          ]
        }));
        setStatusBanner({ tone: 'warn', text: res.message });
        setBusy(false);
        return;
      }

      const nextTier = action === 'RESET' ? 'NONE' : action;
      setState((prev) => ({
        ...prev,
        activeKillSwitchTier: nextTier,
        containmentClockMs: action === 'RESET' ? null : res.containmentMs,
        lastIamDenyPolicy: res.iamDenyPolicy ?? prev.lastIamDenyPolicy,
        canaryTripped: action === 'RESET' ? false : prev.canaryTripped,
        velocityAlertActive: action === 'RESET' ? false : prev.velocityAlertActive,
        fleet: prev.fleet.map((node) => {
          if (action === 'RESET') {
            return { ...node, status: 'ACTIVE', tokenVelocityUsdPerMin: 1.25 };
          }
          if (action === 'TIER_1_MCP_FREEZE') {
            return node.id === 'agent-erp-support-01' ? { ...node, status: 'MCP_FROZEN' } : node;
          }
          if (action === 'TIER_2_IAM_DENY') {
            return node.id === 'agent-erp-support-01'
              ? { ...node, status: 'IAM_QUARANTINED', tokenVelocityUsdPerMin: 0 }
              : node;
          }
          return { ...node, status: 'CIRCUIT_OPEN', tokenVelocityUsdPerMin: 0 };
        }),
        timeline: [
          ...prev.timeline,
          {
            id: `tl_${Date.now()}`,
            timestamp: new Date().toISOString(),
            tPlusMs: prev.timeline.length * 45 + res.containmentMs,
            actor:
              action === 'TIER_3_GLOBAL_BREAKER'
                ? 'Nadia Morales + Morgan Vance (2-of-2)'
                : 'Nadia Morales (SOC Lead)',
            action: `Kill Switch: ${action}`,
            outcome: 'CONTAINED',
            detail: res.message
          }
        ]
      }));

      setStatusBanner({ tone: 'success', text: res.message });
      setBusy(false);
    },
    [appendSpan, state.cisoCosignVerified, state.fido2AssertionId, state.sessionId]
  );

  const handleCisoCosign = useCallback(() => {
    const assertionId = `fido2-webauthn-${Math.random().toString(16).slice(2, 10)}`;
    setState((prev) => ({
      ...prev,
      cisoCosignVerified: true,
      cisoCosignRequested: false,
      fido2AssertionId: assertionId,
      timeline: [
        ...prev.timeline,
        {
          id: `tl_${Date.now()}`,
          timestamp: new Date().toISOString(),
          tPlusMs: prev.timeline.length * 45 + 95,
          actor: 'Morgan Vance (CISO)',
          action: 'Hardware FIDO2 Dual-Custody Co-Sign',
          outcome: 'ATTESTED',
          detail: `Signed Tier-3 Break-Glass challenge (${assertionId}).`
        }
      ]
    }));
    setStatusBanner({
      tone: 'success',
      text: `CISO FIDO2 dual-custody assertion recorded (${assertionId}). Tier 3 Global Circuit Breaker unlocked.`
    });
  }, []);

  const decodedProofSections: XRayDecodedProofSection[] = useMemo(() => {
    const sections: XRayDecodedProofSection[] = [
      {
        id: 'cyclonedx-aibom',
        label: 'CycloneDX AI-BOM (Model + Prompt SHA-256 + MCP Schema)',
        payload: state.lastCycloneDxBom
      },
      {
        id: 'sigstore-rekor',
        label: 'Sigstore Cosign Rekor Transparency Entry',
        payload: state.lastRekorEntry
      }
    ];
    if (state.lastCanaryAlert) {
      sections.push({
        id: 'canary-tripwire',
        label: 'Canary Tripwire Alert (CUST-CANARY-999)',
        payload: state.lastCanaryAlert
      });
    }
    if (state.lastIamDenyPolicy || state.timeline.length > 0) {
      sections.push({
        id: 'kill-switch-cascade',
        label: '3-Tier Kill Switch Cascade & AWS IAM Deny * Policy',
        payload: {
          active_tier: state.activeKillSwitchTier,
          containment_ms: state.containmentClockMs,
          ciso_fido2_assertion: state.fido2AssertionId,
          iam_deny_policy: state.lastIamDenyPolicy,
          cascade_events: state.timeline.slice(-5)
        }
      });
    }
    return sections;
  }, [state]);

  const phases: { id: CognitivePhase; label: string }[] = [
    { id: 'discovery', label: '1. Discovery' },
    { id: 'understanding', label: '2. Understanding (POE)' },
    { id: 'practice', label: '3. Practice' },
    { id: 'reflection', label: '4. Reflection' }
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', paddingBottom: '72px' }}>
      {/* Top Bar */}
      <header className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <button
            type="button"
            onClick={onBack}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
          >
            <ArrowLeft size={14} />
            <span>All Labs</span>
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>
              AI Supply Chain &amp; Runtime Kill Switch
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Lab 3 · Guided Sandbox ($0.00/mo) · Session <span className="mono">{state.sessionId}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {state.containmentClockMs !== null && (
            <span className="badge badge-emerald">
              <Clock size={12} style={{ marginRight: 4 }} />
              Containment: {state.containmentClockMs}ms
            </span>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
          >
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '20px 16px' }}>
        {/* 3-Seat Role Switcher Bar */}
        <RoleSwitcherBar
          seats={seats}
          activeSeatId={state.activeSeat}
          onSelectSeat={(seatId) => setState((prev) => ({ ...prev, activeSeat: seatId }))}
          ariaLabel="Lab 3 Persona Seat Switcher"
        />

        {/* Status Banner */}
        {statusBanner && (
          <div
            role="status"
            style={{
              marginTop: '14px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor:
                statusBanner.tone === 'error'
                  ? 'var(--accent-crimson-dim)'
                  : statusBanner.tone === 'warn'
                    ? 'var(--accent-amber-dim)'
                    : statusBanner.tone === 'success'
                      ? 'var(--accent-emerald-dim)'
                      : 'var(--accent-primary-dim)',
              border: `1px solid ${
                statusBanner.tone === 'error'
                  ? 'var(--accent-crimson-border)'
                  : statusBanner.tone === 'warn'
                    ? 'var(--accent-amber-border)'
                    : statusBanner.tone === 'success'
                      ? 'var(--accent-emerald-border)'
                      : 'var(--accent-primary-border)'
              }`,
              color: 'var(--text-primary)'
            }}
          >
            <Activity size={15} />
            <span>{statusBanner.text}</span>
          </div>
        )}

        {/* 4-Phase Cognitive Arc Navigation */}
        <div
          role="tablist"
          aria-label="4-Phase Cognitive Arc"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginTop: '16px',
            marginBottom: '16px'
          }}
        >
          {phases.map((phase) => {
            const active = state.activePhase === phase.id;
            return (
              <button
                key={phase.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setState((prev) => ({ ...prev, activePhase: phase.id }))}
                className={active ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '8px 14px', fontSize: '13px' }}
              >
                {phase.label}
              </button>
            );
          })}
        </div>

        {/* PHASE 1: DISCOVERY */}
        {state.activePhase === 'discovery' && (
          <section className="surface-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '17px', fontWeight: 700 }}>
                  5-Gate AI Path-to-Production &amp; Runtime Agent Fleet
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Inspect how CycloneDX AI-BOM hashes, Sigstore Cosign OIDC attestation, and the runtime agent fleet connect.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => runSupplyChainPipeline('VERIFIED_PINNED', true)}
                className="btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Play size={14} />
                <span>Run Verified 5-Gate Pipeline</span>
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))',
                gap: '12px',
                marginBottom: '20px'
              }}
            >
              {state.gates.map((gate) => (
                <div
                  key={gate.id}
                  style={{
                    padding: '14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-canvas)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{gate.label}</span>
                    {getGateBadge(gate.status)}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    {gate.control}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }} className="mono">
                    {gate.detail}
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>
              Live Runtime Agent Fleet Topology
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '12px'
              }}
            >
              {state.fleet.map((node) => (
                <div
                  key={node.id}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-surface)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Cpu size={14} />
                      {node.name}
                    </span>
                    <span
                      className={`badge ${
                        node.status === 'ACTIVE'
                          ? 'badge-emerald'
                          : node.status === 'MCP_FROZEN'
                            ? 'badge-amber'
                            : 'badge-crimson'
                      }`}
                    >
                      {node.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }} className="mono">
                    {node.id} · ${node.tokenVelocityUsdPerMin.toFixed(2)}/min
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }} className="mono">
                    Last: {node.lastToolCall}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setState((prev) => ({ ...prev, activePhase: 'understanding' }))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <span>Next: Understanding (POE)</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </section>
        )}

        {/* PHASE 2: UNDERSTANDING / POE */}
        {state.activePhase === 'understanding' && (
          <section className="surface-card" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '6px' }}>
              Predict-Observe-Explain (POE): Supply-Chain Drift &amp; Canary Exfiltration
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Predict what happens when an agent build carries a mutated system-prompt SHA-256 against a naive tag-only gate (Trap 3A), or when a support ticket injects <code className="mono">CUST-CANARY-999</code> (Trap 3B).
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>
                  1. Predict Outcome (Trap 3A)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    {
                      id: 'tag-bypass',
                      label: 'Tag-only check passes mutated prompt SHA-256 into production'
                    },
                    {
                      id: 'tag-blocks',
                      label: 'Tag-only check automatically hashes and blocks the system prompt'
                    }
                  ].map((opt) => (
                    <label
                      key={opt.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px',
                        cursor: 'pointer'
                      }}
                    >
                      <input
                        type="radio"
                        name="poe-prediction"
                        checked={state.poePrediction === opt.id}
                        onChange={() => setState((prev) => ({ ...prev, poePrediction: opt.id }))}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>
                  2. Observe Live Traps (3A &amp; 3B)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <button
                    type="button"
                    disabled={busy}
                    className="btn-secondary"
                    onClick={async () => {
                      await runSupplyChainPipeline('MUTATED_PROMPT_3A', false);
                      setState((prev) => ({ ...prev, poeObserved: true }));
                    }}
                  >
                    Trigger Trap 3A (Mutated Prompt, Tag-Only)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="btn-secondary"
                    onClick={async () => {
                      await runRuntimeProbe('INDIRECT_INJECTION_CANARY');
                      setState((prev) => ({ ...prev, poeObserved: true }));
                    }}
                  >
                    Trigger Trap 3B (CUST-CANARY-999)
                  </button>
                </div>
                {state.poeObserved && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--accent-emerald-ink)' }}>
                    Observed: Mutated prompt hash <code className="mono">{MUTATED_PROMPT_SHA256.slice(0, 22)}...</code> vs pinned <code className="mono">{EXPECTED_PROMPT_SHA256.slice(0, 22)}...</code>.
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: '16px', padding: '14px', borderRadius: '8px', backgroundColor: 'var(--bg-elevated)' }}>
              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                3. Explain &amp; Unlock Practice
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Tag-only admission cannot detect prompt/tool tampering inside an approved container tag. CycloneDX AI-BOM hash pinning + runtime <code className="mono">CUST-CANARY-999</code> tripwires close both gaps.
              </p>
              <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      poeExplained: true,
                      activePhase: 'practice'
                    }))
                  }
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>Proceed to Practice (Patch &amp; Kill Switch)</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* PHASE 3: PRACTICE */}
        {state.activePhase === 'practice' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
            {/* Seat 1: MLSecOps AI-BOM Gate */}
            <section className="surface-card" style={{ padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={16} />
                  MLSecOps · AI-BOM Admission Gate
                </h2>
                <span className={`badge ${state.enforceHashPinning ? 'badge-emerald' : 'badge-amber'}`}>
                  {state.enforceHashPinning ? 'Hash Pinning ON' : 'Tag-Only (Vulnerable)'}
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
                  checked={state.enforceHashPinning}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, enforceHashPinning: e.target.checked }))
                  }
                />
                <span>Enforce CycloneDX AI-BOM Prompt SHA-256 &amp; Cosign Pinning</span>
              </label>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  type="button"
                  disabled={busy}
                  className="btn-secondary"
                  onClick={() => runSupplyChainPipeline('MUTATED_PROMPT_3A')}
                >
                  Test Trap 3A (Mutated Prompt)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn-primary"
                  onClick={() => runSupplyChainPipeline('VERIFIED_PINNED')}
                >
                  Deploy Attested Build
                </button>
              </div>
            </section>

            {/* Seat 2: SOC Commander Canary & 3-Tier Kill Switchboard */}
            <section className="surface-card" style={{ padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldAlert size={16} />
                  SOC Lead · Canary &amp; 3-Tier Kill Switch
                </h2>
                <span
                  className={`badge ${
                    state.activeKillSwitchTier !== 'NONE'
                      ? 'badge-emerald'
                      : state.canaryTripped || state.velocityAlertActive
                        ? 'badge-crimson'
                        : 'badge-blue'
                  }`}
                >
                  {state.activeKillSwitchTier !== 'NONE'
                    ? state.activeKillSwitchTier
                    : state.canaryTripped
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
                  onClick={() => runRuntimeProbe('INDIRECT_INJECTION_CANARY')}
                >
                  Trap 3B: CUST-CANARY-999
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn-secondary"
                  onClick={() => runRuntimeProbe('RUNAWAY_COST_LOOP')}
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
                  onClick={() => triggerKillSwitch('TIER_1_MCP_FREEZE')}
                  style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}
                >
                  <span>Tier 1: Surgical MCP Tool Freeze</span>
                  <span className="mono" style={{ fontSize: '11px' }}>38ms</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn-secondary"
                  onClick={() => triggerKillSwitch('TIER_2_IAM_DENY')}
                  style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}
                >
                  <span>Tier 2: Identity Quarantine &amp; IAM Deny *</span>
                  <span className="mono" style={{ fontSize: '11px' }}>112ms</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn-primary"
                  onClick={() => triggerKillSwitch('TIER_3_GLOBAL_BREAKER')}
                  style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Zap size={14} />
                    Tier 3: Global Fleet Circuit Breaker (2-of-2)
                  </span>
                  <span className="mono" style={{ fontSize: '11px' }}>
                    {state.cisoCosignVerified ? 'UNLOCKED' : 'LOCKED'}
                  </span>
                </button>
              </div>
            </section>

            {/* Seat 3: CISO Dual-Custody Vault */}
            <section className="surface-card" style={{ padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <KeyRound size={16} />
                  CISO · Tier-3 Break-Glass Vault
                </h2>
                <span className={`badge ${state.cisoCosignVerified ? 'badge-emerald' : 'badge-amber'}`}>
                  {state.cisoCosignVerified ? 'Co-Signed' : 'Dual-Custody Gate'}
                </span>
              </div>

              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Tier 3 Global Fleet Circuit Breaker fails closed (<code className="mono">403 DUAL_CUSTODY_REQUIRED</code>) until Morgan Vance signs with a hardware FIDO2 key.
              </p>

              <button
                type="button"
                disabled={busy || state.cisoCosignVerified}
                className="btn-primary"
                onClick={handleCisoCosign}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Lock size={14} />
                <span>
                  {state.cisoCosignVerified
                    ? `Co-Signed (${state.fido2AssertionId})`
                    : 'Sign Tier-3 FIDO2 Dual-Custody Challenge'}
                </span>
              </button>

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setState((prev) => ({ ...prev, activePhase: 'reflection' }))}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>View Reflection &amp; Timeline</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </section>
          </div>
        )}

        {/* PHASE 4: REFLECTION */}
        {state.activePhase === 'reflection' && (
          <section className="surface-card" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '8px' }}>
              Containment Timeline &amp; Blast-Radius Delta
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
                marginBottom: '18px'
              }}
            >
              <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-elevated)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>AI-BOM Gate</div>
                <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px' }}>
                  {state.enforceHashPinning ? 'Hash-Pinned (Hardened)' : 'Tag-Only (Exposed)'}
                </div>
              </div>
              <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-elevated)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Containment Clock</div>
                <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px' }}>
                  {state.containmentClockMs !== null ? `${state.containmentClockMs} ms` : 'Not triggered'}
                </div>
              </div>
              <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-elevated)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Blast-Radius Delta</div>
                <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px', color: 'var(--accent-emerald-ink)' }}>
                  {state.activeKillSwitchTier !== 'NONE' ? '100% -> 0% Exfil' : 'Awaiting Containment'}
                </div>
              </div>
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
              Incident &amp; Attestation Audit Log
            </h3>
            {state.timeline.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                No events recorded yet. Run the pipeline or trigger a canary probe in Discovery/Practice.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {state.timeline.map((evt) => (
                  <div
                    key={evt.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                      fontSize: '12px'
                    }}
                  >
                    <div>
                      <span className="mono" style={{ fontWeight: 600 }}>T+{evt.tPlusMs}ms</span> ·{' '}
                      <strong>{evt.actor}</strong> — {evt.action}
                      <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>{evt.detail}</div>
                    </div>
                    <span
                      className={`badge ${
                        evt.outcome === 'DETECTED'
                          ? 'badge-crimson'
                          : evt.outcome === 'BLOCKED'
                            ? 'badge-amber'
                            : 'badge-emerald'
                      }`}
                    >
                      {evt.outcome}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <XRayTelemetryDrawer
        spans={spans}
        decodedProofSections={decodedProofSections}
        onClear={() => setSpans([])}
      />
    </div>
  );
}
