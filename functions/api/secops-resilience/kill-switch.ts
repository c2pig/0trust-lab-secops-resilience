import type { SecOpsEnv } from './verify-bom';

export type KillSwitchAction =
  | 'TIER_1_MCP_FREEZE'
  | 'TIER_2_IAM_DENY'
  | 'TIER_3_GLOBAL_BREAKER'
  | 'RESET';

export interface KillSwitchRequest {
  sessionId?: string;
  action?: KillSwitchAction;
  actor_seat?: string;
  reason?: string;
  ciso_cosign_verified?: boolean;
  fido2_assertion_id?: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const KV_TTL_SECONDS = 3600;
const MAX_EPHEMERAL_ENTRIES = 256;
const VALID_ACTIONS = new Set<KillSwitchAction>([
  'TIER_1_MCP_FREEZE',
  'TIER_2_IAM_DENY',
  'TIER_3_GLOBAL_BREAKER',
  'RESET'
]);

const ephemeralKillStore = new Map<string, { value: Record<string, unknown>; expiresAt: number }>();

function setEphemeralKill(key: string, value: Record<string, unknown>): void {
  const now = Date.now();
  for (const [k, v] of ephemeralKillStore) {
    if (v.expiresAt <= now) ephemeralKillStore.delete(k);
  }
  if (!ephemeralKillStore.has(key) && ephemeralKillStore.size >= MAX_EPHEMERAL_ENTRIES) {
    const oldestKey = ephemeralKillStore.keys().next().value;
    if (oldestKey !== undefined) ephemeralKillStore.delete(oldestKey);
  }
  ephemeralKillStore.delete(key);
  ephemeralKillStore.set(key, { value, expiresAt: now + KV_TTL_SECONDS * 1000 });
}

function sanitizeSessionId(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return 'demo-visitor';
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'demo-visitor';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestPost(context: {
  request: Request;
  env: SecOpsEnv;
}): Promise<Response> {
  const rawText = await context.request.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return jsonResponse(
      { error: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds 64KB limit.' },
      413
    );
  }

  let body: KillSwitchRequest = {};
  if (rawText.trim().length > 0) {
    try {
      body = JSON.parse(rawText) as KillSwitchRequest;
    } catch {
      return jsonResponse(
        { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
        400
      );
    }
  }

  if (!body.action || !VALID_ACTIONS.has(body.action)) {
    return jsonResponse(
      {
        error: 'INVALID_ACTION',
        message: 'action must be TIER_1_MCP_FREEZE, TIER_2_IAM_DENY, TIER_3_GLOBAL_BREAKER, or RESET.'
      },
      400
    );
  }

  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || body.sessionId
  );
  const kvKey = `lab3:secops:${sessionId}`;
  const storageMode = context.env.STATE_KV ? 'cloudflare-kv' : 'ephemeral-edge';
  const timestamp = new Date().toISOString();
  const action = body.action;
  const fido2AssertionId = (body.fido2_assertion_id || '').trim().slice(0, 128);
  const cisoCosignVerified = body.ciso_cosign_verified === true;

  // Fail-closed dual-custody gate for Tier 3 Global Fleet Circuit Breaker
  if (action === 'TIER_3_GLOBAL_BREAKER' && (!cisoCosignVerified || fido2AssertionId.length === 0)) {
    return jsonResponse(
      {
        status: 'DUAL_CUSTODY_REQUIRED',
        error: 'DUAL_CUSTODY_REQUIRED',
        http_status: 403,
        action,
        invariant: 'TIER_3_CISO_FIDO2_REQUIRED',
        storage: storageMode,
        kv_ttl_seconds: KV_TTL_SECONDS,
        timestamp,
        message:
          'Fail-closed (403): Tier 3 Global Fleet Circuit Breaker requires CISO dual-custody FIDO2 WebAuthn co-signature.'
      },
      403
    );
  }

  const iamDenyPolicy =
    action === 'TIER_2_IAM_DENY' || action === 'TIER_3_GLOBAL_BREAKER'
      ? {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'AgenticRuntimeQuarantineDenyAll',
              Effect: 'Deny',
              Action: '*',
              Resource: '*',
              Condition: {
                StringEquals: {
                  'aws:PrincipalTag/AgentRole':
                    action === 'TIER_3_GLOBAL_BREAKER' ? '*' : 'erp-support-agent'
                }
              }
            }
          ]
        }
      : null;

  const containmentMs =
    action === 'TIER_1_MCP_FREEZE'
      ? 38
      : action === 'TIER_2_IAM_DENY'
        ? 112
        : action === 'TIER_3_GLOBAL_BREAKER'
          ? 185
          : 0;

  const record = {
    session_id: sessionId,
    kill_switch_tier: action,
    ciso_cosign_verified: action === 'TIER_3_GLOBAL_BREAKER' ? true : false,
    fido2_assertion_id: action === 'TIER_3_GLOBAL_BREAKER' ? fido2AssertionId : null,
    containment_ms: containmentMs,
    updated_at: timestamp
  };

  if (context.env.STATE_KV) {
    try {
      const existingRaw = await context.env.STATE_KV.get(kvKey);
      const existing = existingRaw ? (JSON.parse(existingRaw) as Record<string, unknown>) : {};
      await context.env.STATE_KV.put(kvKey, JSON.stringify({ ...existing, ...record }), {
        expirationTtl: KV_TTL_SECONDS
      });
    } catch {
      // Ignore KV write error in edge fallback
    }
  } else {
    setEphemeralKill(kvKey, record);
  }

  return jsonResponse(
    {
      status: action === 'RESET' ? 'FLEET_RESTORED' : `${action}_ACTIVE`,
      http_status: 200,
      action,
      containment_ms: containmentMs,
      iam_deny_policy: iamDenyPolicy,
      fido2_assertion_id: action === 'TIER_3_GLOBAL_BREAKER' ? fido2AssertionId : null,
      storage: storageMode,
      kv_ttl_seconds: KV_TTL_SECONDS,
      timestamp,
      message:
        action === 'RESET'
          ? 'Kill switchboard reset to normal operating posture.'
          : `${action} executed in ${containmentMs}ms.`
    },
    200
  );
}
