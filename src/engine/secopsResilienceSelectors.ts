import type {
  AgentFleetNode,
  GateStatus,
  KillSwitchTierId,
  SupplyChainGate
} from '../contracts/secopsContract';

export type GateBadgeClass = 'badge-blue' | 'badge-emerald' | 'badge-crimson' | 'badge';

export interface GateBadgeMeta {
  className: GateBadgeClass;
  label: string;
}

export function getGateBadgeMeta(status: GateStatus): GateBadgeMeta {
  switch (status) {
    case 'CHECKING':
      return { className: 'badge-blue', label: 'CHECKING' };
    case 'PASS':
      return { className: 'badge-emerald', label: 'PASS' };
    case 'BLOCK':
      return { className: 'badge-crimson', label: 'BLOCK' };
    default:
      return { className: 'badge', label: 'WAITING' };
  }
}

export function countBlockedGates(gates: SupplyChainGate[]): number {
  return gates.filter((g) => g.status === 'BLOCK').length;
}

export function countQuarantinedNodes(fleet: AgentFleetNode[]): number {
  return fleet.filter((node) => node.status !== 'ACTIVE').length;
}

export function isKillSwitchEscalated(tier: KillSwitchTierId): boolean {
  return tier !== 'NONE';
}

export function isCisoCosignRequired(
  tier: KillSwitchTierId,
  cisoCosignVerified: boolean
): boolean {
  return tier === 'TIER_3_GLOBAL_BREAKER' && !cisoCosignVerified;
}
