export type SecOpsSeatId = 'mlsecops' | 'soc-commander' | 'ciso-cosigner';

export type CognitivePhase = 'discovery' | 'understanding' | 'practice' | 'reflection';

export type GateStatus = 'WAITING' | 'CHECKING' | 'PASS' | 'BLOCK';

export type SupplyChainGateId =
  | 'signed_commit'
  | 'cyclonedx_aibom'
  | 'ephemeral_oidc_build'
  | 'sigstore_cosign'
  | 'runtime_admission';

export interface SupplyChainGate {
  id: SupplyChainGateId;
  order: number;
  label: string;
  control: string;
  status: GateStatus;
  detail: string;
}

export type BomBuildPresetId = 'VERIFIED_PINNED' | 'MUTATED_PROMPT_3A';

export type RuntimeScenarioId =
  | 'CLEAN_TICKET'
  | 'INDIRECT_INJECTION_CANARY'
  | 'RUNAWAY_COST_LOOP';

export type KillSwitchTierId = 'NONE' | 'TIER_1_MCP_FREEZE' | 'TIER_2_IAM_DENY' | 'TIER_3_GLOBAL_BREAKER';

export interface AgentFleetNode {
  id: string;
  name: string;
  role: string;
  status: 'ACTIVE' | 'MCP_FROZEN' | 'IAM_QUARANTINED' | 'CIRCUIT_OPEN';
  tokenVelocityUsdPerMin: number;
  lastToolCall: string;
}

export interface ContainmentTimelineEvent {
  id: string;
  timestamp: string;
  tPlusMs: number;
  actor: string;
  action: string;
  outcome: 'DETECTED' | 'CONTAINED' | 'BLOCKED' | 'ATTESTED';
  detail: string;
}

export interface SecOpsResilienceState {
  sessionId: string;
  activeSeat: SecOpsSeatId;
  activePhase: CognitivePhase;
  gates: SupplyChainGate[];
  selectedBuildPreset: BomBuildPresetId;
  enforceHashPinning: boolean;
  bomVerificationStatus: 'IDLE' | 'AI_BOM_ATTESTED' | 'AI_BOM_HASH_MISMATCH' | 'AI_BOM_TAG_ONLY_BYPASS';
  poePrediction: string | null;
  poeObserved: boolean;
  poeExplained: boolean;
  runtimeScenario: RuntimeScenarioId;
  canaryTripped: boolean;
  velocityAlertActive: boolean;
  containmentClockMs: number | null;
  activeKillSwitchTier: KillSwitchTierId;
  cisoCosignRequested: boolean;
  cisoCosignVerified: boolean;
  fido2AssertionId: string | null;
  tier3BlockedWithoutCosign: boolean;
  fleet: AgentFleetNode[];
  timeline: ContainmentTimelineEvent[];
  lastCycloneDxBom: Record<string, unknown> | null;
  lastRekorEntry: Record<string, unknown> | null;
  lastCanaryAlert: Record<string, unknown> | null;
  lastIamDenyPolicy: Record<string, unknown> | null;
}
