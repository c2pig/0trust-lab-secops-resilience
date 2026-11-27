import type { SecOpsEnv } from './verify-bom';

export type CanaryProbeScenario =
  | 'CLEAN_TICKET'
  | 'INDIRECT_INJECTION_CANARY'
  | 'RUNAWAY_COST_LOOP';

export interface CanaryProbeRequest {
  sessionId?: string;
  scenario?: CanaryProbeScenario;
  payload_text?: string;
  token_velocity_usd_per_min?: number;
  agent_id?: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const KV_TTL_SECONDS = 3600;
const MAX_EPHEMERAL_ENTRIES = 256;
const VALID_SCENARIOS = new Set<CanaryProbeScenario>([
  'CLEAN_TICKET',
  'INDIRECT_INJECTION_CANARY',
  'RUNAWAY_COST_LOOP'
]);

const ephemeralCanaryStore = new Map<string, { value: Record<string, unknown>; expiresAt: number }>();

function setEphemeralCanary(key: string, value: Record<string, unknown>): void {
  const now = Date.now();
  for (const [k, v] of ephemeralCanaryStore) {
    if (v.expiresAt <= now) ephemeralCanaryStore.delete(k);
  }
  if (!ephemeralCanaryStore.has(key) && ephemeralCanaryStore.size >= MAX_EPHEMERAL_ENTRIES) {
    const oldestKey = ephemeralCanaryStore.keys().next().value;
    if (oldestKey !== undefined) ephemeralCanaryStore.delete(oldestKey);
  }
  ephemeralCanaryStore.delete(key);
  ephemeralCanaryStore.set(key, { value, expiresAt: now + KV_TTL_SECONDS * 1000 });
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

  let body: CanaryProbeRequest = {};
  if (rawText.trim().length > 0) {
    try {
      body = JSON.parse(rawText) as CanaryProbeRequest;
    } catch {
      return jsonResponse(
        { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
        400
      );
    }
  }

  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || body.sessionId
  );
  const kvKey = `lab3:secops:${sessionId}`;
  const storageMode = context.env.STATE_KV ? 'cloudflare-kv' : 'ephemeral-edge';
  const timestamp = new Date().toISOString();

  const scenario: CanaryProbeScenario =
    body.scenario && VALID_SCENARIOS.has(body.scenario) ? body.scenario : 'CLEAN_TICKET';
  const payloadText = (body.payload_text || '').slice(0, 4096);
  const velocity =
    typeof body.token_velocity_usd_per_min === 'number' && Number.isFinite(body.token_velocity_usd_per_min)
      ? Math.max(0, Math.min(10000, body.token_velocity_usd_per_min))
      : scenario === 'RUNAWAY_COST_LOOP'
        ? 84.5
        : 1.25;
  const agentId = (body.agent_id || 'agent-erp-support-01').slice(0, 64);

  const canaryTriggered =
    scenario === 'INDIRECT_INJECTION_CANARY' || payloadText.includes('CUST-CANARY-999');
  const dlpTriggered =
    /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\b/.test(payloadText) ||
    /\b\d{3}-\d{2}-\d{4}\b/.test(payloadText) ||
    /(?:api_key|token|bearer|secret)\s*[:=]\s*[a-zA-Z0-9_.-]{16,}/i.test(payloadText);
  const velocityExceeded = scenario === 'RUNAWAY_COST_LOOP' || velocity > 50;

  const tripped = canaryTriggered || dlpTriggered || velocityExceeded;
  const statusCode = tripped ? 423 : 200;
  const statusLabel = tripped ? 'CANARY_TRIPWIRE_TRIGGERED' : 'RUNTIME_TELEMETRY_CLEAN';

  const matchedRules: string[] = [];
  if (canaryTriggered) matchedRules.push('TRIPWIRE-CUST-CANARY-999');
  if (dlpTriggered) matchedRules.push('DLP-001..003');
  if (velocityExceeded) matchedRules.push('VELOCITY-GUARD-50USD-MIN');

  const record = {
    session_id: sessionId,
    last_canary_status: statusLabel,
    scenario,
    matched_rules: matchedRules,
    token_velocity_usd_per_min: velocity,
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
      // Fall back silently if KV write fails
    }
  } else {
    setEphemeralCanary(kvKey, record);
  }

  return jsonResponse(
    {
      status: statusLabel,
      error: tripped ? 'CANARY_TRIPWIRE_TRIGGERED' : undefined,
      http_status: statusCode,
      agent_id: agentId,
      scenario,
      canary_record: canaryTriggered ? 'CUST-CANARY-999' : null,
      matched_rules: matchedRules,
      token_velocity_usd_per_min: velocity,
      containment_latency_ms: tripped ? 42 : 8,
      recommended_tier: velocityExceeded
        ? 'TIER_2_IAM_DENY'
        : canaryTriggered
          ? 'TIER_1_MCP_FREEZE'
          : 'NONE',
      storage: storageMode,
      kv_ttl_seconds: KV_TTL_SECONDS,
      timestamp,
      message: tripped
        ? `Locked (423): Runtime tripwire triggered (${matchedRules.join(', ')}). SOC War Room alerted in 42ms.`
        : 'Runtime probe clean: no canary token exfiltration, DLP violation, or runaway cost velocity detected.'
    },
    statusCode
  );
}
