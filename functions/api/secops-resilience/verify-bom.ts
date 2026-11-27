export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SecOpsEnv {
  STATE_KV?: KVNamespace;
  ENVIRONMENT?: string;
}

export interface VerifyBomRequest {
  sessionId?: string;
  model_id?: string;
  model_digest?: string;
  system_prompt_sha256?: string;
  mcp_schema_hash?: string;
  cosign_verified?: boolean;
  enforce_hash_pinning?: boolean;
}

interface SecOpsKvRecord {
  session_id: string;
  bom_status: string;
  enforce_hash_pinning: boolean;
  last_canary_status?: string;
  kill_switch_tier?: string;
  updated_at: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const KV_TTL_SECONDS = 3600;
const MAX_EPHEMERAL_ENTRIES = 256;

export const EXPECTED_MODEL_DIGEST =
  'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
export const EXPECTED_PROMPT_SHA256 =
  'sha256:4a7d1ed414474e4033ac29ccb8653d9b4a7d1ed414474e4033ac29ccb8653d9b';
export const EXPECTED_MCP_SCHEMA_HASH =
  'sha256:7c211433f02071597741e6ff5a8ea34789abbf433f02071597741e6ff5a8ea347';

const ephemeralBomStore = new Map<string, { value: SecOpsKvRecord; expiresAt: number }>();

function getEphemeralBom(key: string): SecOpsKvRecord | null {
  const entry = ephemeralBomStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    ephemeralBomStore.delete(key);
    return null;
  }
  return entry.value;
}

function setEphemeralBom(key: string, value: SecOpsKvRecord): void {
  const now = Date.now();
  for (const [k, v] of ephemeralBomStore) {
    if (v.expiresAt <= now) ephemeralBomStore.delete(k);
  }
  if (!ephemeralBomStore.has(key) && ephemeralBomStore.size >= MAX_EPHEMERAL_ENTRIES) {
    const oldestKey = ephemeralBomStore.keys().next().value;
    if (oldestKey !== undefined) ephemeralBomStore.delete(oldestKey);
  }
  ephemeralBomStore.delete(key);
  ephemeralBomStore.set(key, { value, expiresAt: now + KV_TTL_SECONDS * 1000 });
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

  let body: VerifyBomRequest = {};
  if (rawText.trim().length > 0) {
    try {
      body = JSON.parse(rawText) as VerifyBomRequest;
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

  const modelId = (body.model_id || 'anthropic.claude-3-5-sonnet-20241022-v2:0').slice(0, 128);
  const modelDigest = (body.model_digest || EXPECTED_MODEL_DIGEST).slice(0, 128);
  const promptSha256 = (body.system_prompt_sha256 || EXPECTED_PROMPT_SHA256).slice(0, 128);
  const mcpSchemaHash = (body.mcp_schema_hash || EXPECTED_MCP_SCHEMA_HASH).slice(0, 128);
  const cosignVerified = body.cosign_verified === true;
  const enforceHashPinning = body.enforce_hash_pinning === true;

  const promptMatches = promptSha256 === EXPECTED_PROMPT_SHA256;
  const modelMatches = modelDigest === EXPECTED_MODEL_DIGEST;
  const mcpMatches = mcpSchemaHash === EXPECTED_MCP_SCHEMA_HASH;
  const hasDrift = !promptMatches || !modelMatches || !mcpMatches || !cosignVerified;

  let existing: SecOpsKvRecord | null = null;
  if (context.env.STATE_KV) {
    try {
      const raw = await context.env.STATE_KV.get(kvKey);
      if (raw) existing = JSON.parse(raw) as SecOpsKvRecord;
    } catch {
      existing = null;
    }
  } else {
    existing = getEphemeralBom(kvKey);
  }

  let statusCode = 200;
  let bomStatus: 'AI_BOM_ATTESTED' | 'AI_BOM_HASH_MISMATCH' | 'AI_BOM_TAG_ONLY_BYPASS' =
    'AI_BOM_ATTESTED';
  let message =
    'CycloneDX AI-BOM verified: model digest, system prompt SHA-256, MCP schema hash, and Sigstore Cosign OIDC attestation match.';

  if (enforceHashPinning && hasDrift) {
    statusCode = 403;
    bomStatus = 'AI_BOM_HASH_MISMATCH';
    const reasons: string[] = [];
    if (!promptMatches) reasons.push('system_prompt_sha256 mismatch');
    if (!modelMatches) reasons.push('model_digest mismatch');
    if (!mcpMatches) reasons.push('mcp_schema_hash mismatch');
    if (!cosignVerified) reasons.push('Sigstore Cosign OIDC signature missing/invalid');
    message = `Fail-closed Admission Block (403): ${reasons.join('; ')}.`;
  } else if (!enforceHashPinning && hasDrift) {
    statusCode = 200;
    bomStatus = 'AI_BOM_TAG_ONLY_BYPASS';
    message =
      'WARNING (Trap 3A): Naive tag-only check allowed mutated system prompt / unpinned build into runtime!';
  }

  const nextRecord: SecOpsKvRecord = {
    ...(existing || { session_id: sessionId }),
    session_id: sessionId,
    bom_status: bomStatus,
    enforce_hash_pinning: enforceHashPinning,
    updated_at: timestamp
  };

  if (context.env.STATE_KV) {
    await context.env.STATE_KV.put(kvKey, JSON.stringify(nextRecord), {
      expirationTtl: KV_TTL_SECONDS
    });
  } else {
    setEphemeralBom(kvKey, nextRecord);
  }

  return jsonResponse(
    {
      status: bomStatus,
      error: statusCode === 403 ? 'AI_BOM_HASH_MISMATCH' : undefined,
      http_status: statusCode,
      enforce_hash_pinning: enforceHashPinning,
      drift_detected: hasDrift,
      checks: {
        model_digest_ok: modelMatches,
        system_prompt_sha256_ok: promptMatches,
        mcp_schema_hash_ok: mcpMatches,
        cosign_oidc_ok: cosignVerified
      },
      cyclonedx_ai_bom: {
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        serialNumber: 'urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79',
        model_id: modelId,
        model_digest: modelDigest,
        system_prompt_sha256: promptSha256,
        mcp_schema_hash: mcpSchemaHash,
        rekor_log_index: cosignVerified ? 148920412 : null
      },
      storage: storageMode,
      kv_ttl_seconds: KV_TTL_SECONDS,
      timestamp,
      message
    },
    statusCode
  );
}
