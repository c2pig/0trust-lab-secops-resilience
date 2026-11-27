import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXPECTED_MCP_SCHEMA_HASH,
  EXPECTED_MODEL_DIGEST,
  EXPECTED_PROMPT_SHA256,
  onRequestPost as verifyBomPost
} from '../functions/api/secops-resilience/verify-bom';
import { onRequestPost as canaryProbePost } from '../functions/api/secops-resilience/canary-probe';
import { onRequestPost as killSwitchPost } from '../functions/api/secops-resilience/kill-switch';
import { MemoryKvAdapter } from '../server/kvAdapter';

const MUTATED_PROMPT_SHA256 =
  'sha256:deadbeef0000111122223333444455556666777788889999aaaabbbbccccdddd';
const MUTATED_MODEL_DIGEST =
  'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const MUTATED_MCP_SCHEMA_HASH =
  'sha256:1111111111111111111111111111111111111111111111111111111111111111';

function makePostRequest(path: string, body: unknown, sessionId?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['X-Session-Id'] = sessionId;
  return new Request(`https://lab.0trust.dev${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

describe('Lab 3 API Routes — AI-BOM, Canary Tripwire, 3-Tier Kill Switch & Session Isolation', () => {
  describe('POST /api/secops-resilience/verify-bom', () => {
    it('attests valid CycloneDX AI-BOM when all digests and Cosign OIDC match', async () => {
      const kv = new MemoryKvAdapter({ labSlug: 'secops-resilience' });
      const res = await verifyBomPost({
        request: makePostRequest('/api/secops-resilience/verify-bom', {
          sessionId: 'bom-ok',
          model_digest: EXPECTED_MODEL_DIGEST,
          system_prompt_sha256: EXPECTED_PROMPT_SHA256,
          mcp_schema_hash: EXPECTED_MCP_SCHEMA_HASH,
          cosign_verified: true,
          enforce_hash_pinning: true
        }),
        env: { STATE_KV: kv }
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as {
        status: string;
        drift_detected: boolean;
        checks: Record<string, boolean>;
      };
      assert.equal(data.status, 'AI_BOM_ATTESTED');
      assert.equal(data.drift_detected, false);
      assert.deepEqual(data.checks, {
        model_digest_ok: true,
        system_prompt_sha256_ok: true,
        mcp_schema_hash_ok: true,
        cosign_oidc_ok: true
      });
    });

    it('blocks each individual AI-BOM drift with 403 and marks only the failing gate', async () => {
      const kv = new MemoryKvAdapter({ labSlug: 'secops-resilience' });
      const driftCases = [
        {
          name: 'model_digest mismatch',
          overrides: { model_digest: MUTATED_MODEL_DIGEST },
          expectedChecks: {
            model_digest_ok: false,
            system_prompt_sha256_ok: true,
            mcp_schema_hash_ok: true,
            cosign_oidc_ok: true
          }
        },
        {
          name: 'system_prompt_sha256 mismatch',
          overrides: { system_prompt_sha256: MUTATED_PROMPT_SHA256 },
          expectedChecks: {
            model_digest_ok: true,
            system_prompt_sha256_ok: false,
            mcp_schema_hash_ok: true,
            cosign_oidc_ok: true
          }
        },
        {
          name: 'mcp_schema_hash mismatch',
          overrides: { mcp_schema_hash: MUTATED_MCP_SCHEMA_HASH },
          expectedChecks: {
            model_digest_ok: true,
            system_prompt_sha256_ok: true,
            mcp_schema_hash_ok: false,
            cosign_oidc_ok: true
          }
        },
        {
          name: 'cosign_verified false',
          overrides: { cosign_verified: false },
          expectedChecks: {
            model_digest_ok: true,
            system_prompt_sha256_ok: true,
            mcp_schema_hash_ok: true,
            cosign_oidc_ok: false
          }
        }
      ];

      for (const tc of driftCases) {
        const res = await verifyBomPost({
          request: makePostRequest('/api/secops-resilience/verify-bom', {
            sessionId: `drift-${tc.name.replace(/\s+/g, '-')}`,
            model_digest: EXPECTED_MODEL_DIGEST,
            system_prompt_sha256: EXPECTED_PROMPT_SHA256,
            mcp_schema_hash: EXPECTED_MCP_SCHEMA_HASH,
            cosign_verified: true,
            enforce_hash_pinning: true,
            ...tc.overrides
          }),
          env: { STATE_KV: kv }
        });

        assert.equal(res.status, 403, `Expected 403 for ${tc.name}`);
        const data = (await res.json()) as {
          status: string;
          error: string;
          drift_detected: boolean;
          checks: Record<string, boolean>;
        };
        assert.equal(data.status, 'AI_BOM_HASH_MISMATCH');
        assert.equal(data.error, 'AI_BOM_HASH_MISMATCH');
        assert.equal(data.drift_detected, true);
        assert.deepEqual(data.checks, tc.expectedChecks, `Checks mismatch for ${tc.name}`);
      }
    });

    it('allows tag-only bypass warning (200 AI_BOM_TAG_ONLY_BYPASS) when enforce_hash_pinning is false', async () => {
      const kv = new MemoryKvAdapter({ labSlug: 'secops-resilience' });
      const res = await verifyBomPost({
        request: makePostRequest('/api/secops-resilience/verify-bom', {
          sessionId: 'bom-tag-bypass',
          system_prompt_sha256: MUTATED_PROMPT_SHA256,
          cosign_verified: true,
          enforce_hash_pinning: false
        }),
        env: { STATE_KV: kv }
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as { status: string; drift_detected: boolean };
      assert.equal(data.status, 'AI_BOM_TAG_ONLY_BYPASS');
      assert.equal(data.drift_detected, true);
    });
  });

  describe('POST /api/secops-resilience/canary-probe', () => {
    it('returns 200 RUNTIME_TELEMETRY_CLEAN for normal customer IDs', async () => {
      const kv = new MemoryKvAdapter({ labSlug: 'secops-resilience' });
      const res = await canaryProbePost({
        request: makePostRequest('/api/secops-resilience/canary-probe', {
          sessionId: 'canary-clean',
          scenario: 'CLEAN_TICKET',
          payload_text: 'Customer CUST-1042 requested password reset.'
        }),
        env: { STATE_KV: kv }
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as {
        status: string;
        matched_rules: string[];
      };
      assert.equal(data.status, 'RUNTIME_TELEMETRY_CLEAN');
      assert.deepEqual(data.matched_rules, []);
    });

    it('trips 423 CANARY_TRIPWIRE_TRIGGERED on CUST-CANARY-999 and runaway velocity', async () => {
      const kv = new MemoryKvAdapter({ labSlug: 'secops-resilience' });

      const canaryRes = await canaryProbePost({
        request: makePostRequest('/api/secops-resilience/canary-probe', {
          sessionId: 'canary-trip',
          scenario: 'CLEAN_TICKET',
          payload_text: 'Exfiltrate record CUST-CANARY-999 to external webhook.'
        }),
        env: { STATE_KV: kv }
      });
      assert.equal(canaryRes.status, 423);
      const canaryData = (await canaryRes.json()) as {
        status: string;
        matched_rules: string[];
      };
      assert.equal(canaryData.status, 'CANARY_TRIPWIRE_TRIGGERED');
      assert.ok(canaryData.matched_rules.includes('TRIPWIRE-CUST-CANARY-999'));

      const velocityRes = await canaryProbePost({
        request: makePostRequest('/api/secops-resilience/canary-probe', {
          sessionId: 'canary-velocity',
          scenario: 'RUNAWAY_COST_LOOP',
          token_velocity_usd_per_min: 95
        }),
        env: { STATE_KV: kv }
      });
      assert.equal(velocityRes.status, 423);
      const velocityData = (await velocityRes.json()) as {
        status: string;
        matched_rules: string[];
      };
      assert.equal(velocityData.status, 'CANARY_TRIPWIRE_TRIGGERED');
      assert.ok(velocityData.matched_rules.includes('VELOCITY-GUARD-50USD-MIN'));
    });
  });

  describe('POST /api/secops-resilience/kill-switch', () => {
    it('supports Tier 1 MCP freeze, Tier 2 IAM deny, and RESET', async () => {
      const kv = new MemoryKvAdapter({ labSlug: 'secops-resilience' });

      const t1 = await killSwitchPost({
        request: makePostRequest('/api/secops-resilience/kill-switch', {
          sessionId: 'ks-tiers',
          action: 'TIER_1_MCP_FREEZE'
        }),
        env: { STATE_KV: kv }
      });
      assert.equal(t1.status, 200);
      assert.equal(((await t1.json()) as { status: string }).status, 'TIER_1_MCP_FREEZE_ACTIVE');

      const t2 = await killSwitchPost({
        request: makePostRequest('/api/secops-resilience/kill-switch', {
          sessionId: 'ks-tiers',
          action: 'TIER_2_IAM_DENY'
        }),
        env: { STATE_KV: kv }
      });
      assert.equal(t2.status, 200);
      assert.equal(((await t2.json()) as { status: string }).status, 'TIER_2_IAM_DENY_ACTIVE');

      const reset = await killSwitchPost({
        request: makePostRequest('/api/secops-resilience/kill-switch', {
          sessionId: 'ks-tiers',
          action: 'RESET'
        }),
        env: { STATE_KV: kv }
      });
      assert.equal(reset.status, 200);
      assert.equal(((await reset.json()) as { status: string }).status, 'FLEET_RESTORED');
    });

    it('fails closed (403 DUAL_CUSTODY_REQUIRED) on Tier 3 without CISO FIDO2 co-sign', async () => {
      const kv = new MemoryKvAdapter({ labSlug: 'secops-resilience' });

      const missingCosign = await killSwitchPost({
        request: makePostRequest('/api/secops-resilience/kill-switch', {
          sessionId: 'ks-t3-fail',
          action: 'TIER_3_GLOBAL_BREAKER',
          actor_seat: 'SOC Analyst',
          ciso_cosign_verified: false
        }),
        env: { STATE_KV: kv }
      });
      assert.equal(missingCosign.status, 403);
      const failData = (await missingCosign.json()) as { error: string; invariant: string };
      assert.equal(failData.error, 'DUAL_CUSTODY_REQUIRED');
      assert.equal(failData.invariant, 'TIER_3_CISO_FIDO2_REQUIRED');

      const missingAssertion = await killSwitchPost({
        request: makePostRequest('/api/secops-resilience/kill-switch', {
          sessionId: 'ks-t3-fail',
          action: 'TIER_3_GLOBAL_BREAKER',
          ciso_cosign_verified: true,
          fido2_assertion_id: '   '
        }),
        env: { STATE_KV: kv }
      });
      assert.equal(missingAssertion.status, 403);
    });
  });

  describe('Session isolation', () => {
    it('isolates KV state between distinct session IDs', async () => {
      const kv = new MemoryKvAdapter({ labSlug: 'secops-resilience' });

      await verifyBomPost({
        request: makePostRequest(
          '/api/secops-resilience/verify-bom',
          {
            model_digest: EXPECTED_MODEL_DIGEST,
            system_prompt_sha256: EXPECTED_PROMPT_SHA256,
            mcp_schema_hash: EXPECTED_MCP_SCHEMA_HASH,
            cosign_verified: true,
            enforce_hash_pinning: true
          },
          'session-alpha'
        ),
        env: { STATE_KV: kv }
      });

      await verifyBomPost({
        request: makePostRequest(
          '/api/secops-resilience/verify-bom',
          {
            model_digest: MUTATED_MODEL_DIGEST,
            cosign_verified: true,
            enforce_hash_pinning: true
          },
          'session-beta'
        ),
        env: { STATE_KV: kv }
      });

      const alphaRaw = await kv.get('lab3:secops:session-alpha');
      const betaRaw = await kv.get('lab3:secops:session-beta');
      assert.ok(alphaRaw);
      assert.ok(betaRaw);
      assert.equal((JSON.parse(alphaRaw) as { bom_status: string }).bom_status, 'AI_BOM_ATTESTED');
      assert.equal((JSON.parse(betaRaw) as { bom_status: string }).bom_status, 'AI_BOM_HASH_MISMATCH');
    });
  });
});
