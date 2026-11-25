import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXPECTED_MCP_SCHEMA_HASH,
  EXPECTED_MODEL_DIGEST,
  EXPECTED_PROMPT_SHA256
} from '../functions/api/secops-resilience/verify-bom';
import { createCloudRunApp, verifyRouterSecret } from '../server/app';
import {
  buildKvDocId,
  FirestoreKvAdapter,
  MemoryKvAdapter,
  type FirestoreCollectionLike,
  type FirestoreKvDoc
} from '../server/kvAdapter';
import { resolvePublicOrigin } from '../server/origin';

const TEST_ROUTER_SECRET = 'test-router-secret-value-0123456789';

function createMockFirestoreCollection(): {
  collection: FirestoreCollectionLike;
  store: Map<string, FirestoreKvDoc>;
} {
  const store = new Map<string, FirestoreKvDoc>();
  const collection: FirestoreCollectionLike = {
    doc(id: string) {
      return {
        async get() {
          const data = store.get(id);
          return {
            exists: Boolean(data),
            data: () => data
          };
        },
        async set(data: FirestoreKvDoc) {
          store.set(id, data);
        },
        async delete() {
          store.delete(id);
        }
      };
    }
  };
  return { collection, store };
}

describe('Lab 3 Cloud Run Adapter — Security Invariants & API Flow', () => {
  it('blocks direct *.run.app /api/* requests without or with invalid X-Lab-Router-Secret (fail-closed 403)', async () => {
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'secops-resilience',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET
      },
      kv: new MemoryKvAdapter({ labSlug: 'secops-resilience' })
    });

    // Missing header
    const resMissing = await app.request(
      'https://0trust-lab-secops-resilience-abc.run.app/api/secops-resilience/verify-bom',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cosign_verified: true, enforce_hash_pinning: true })
      }
    );
    assert.equal(resMissing.status, 403);
    assert.deepEqual(await resMissing.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    // Wrong secret (same length & different length)
    const resWrongSameLen = await app.request(
      'https://0trust-lab-secops-resilience-abc.run.app/api/secops-resilience/verify-bom',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-router-secret': 'wrong-router-secret-value-987654321'
        },
        body: JSON.stringify({ cosign_verified: true, enforce_hash_pinning: true })
      }
    );
    assert.equal(resWrongSameLen.status, 403);
    assert.deepEqual(await resWrongSameLen.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    const resWrongDiffLen = await app.request(
      'https://0trust-lab-secops-resilience-abc.run.app/api/secops-resilience/verify-bom',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-router-secret': 'short'
        },
        body: JSON.stringify({})
      }
    );
    assert.equal(resWrongDiffLen.status, 403);

    // Fail-closed when LAB_ROUTER_SECRET is unset in production
    const appUnconfigured = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'secops-resilience'
      },
      kv: new MemoryKvAdapter({ labSlug: 'secops-resilience' })
    });
    const resUnconfigured = await appUnconfigured.request(
      'https://0trust-lab-secops-resilience-abc.run.app/api/secops-resilience/verify-bom',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-router-secret': TEST_ROUTER_SECRET
        },
        body: JSON.stringify({})
      }
    );
    assert.equal(resUnconfigured.status, 403);
    assert.deepEqual(await resUnconfigured.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    // Valid secret succeeds
    const resValid = await app.request(
      'https://0trust-lab-secops-resilience-abc.run.app/api/secops-resilience/verify-bom',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-router-secret': TEST_ROUTER_SECRET
        },
        body: JSON.stringify({ cosign_verified: true, enforce_hash_pinning: true })
      }
    );
    assert.equal(resValid.status, 200);
    assert.equal(verifyRouterSecret(TEST_ROUTER_SECRET, TEST_ROUTER_SECRET), true);
  });

  it('serves GET /healthz without X-Lab-Router-Secret (Cloud Run probe)', async () => {
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'secops-resilience',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET
      },
      kv: new MemoryKvAdapter({ labSlug: 'secops-resilience' })
    });

    const res = await app.request('https://0trust-lab-secops-resilience-abc.run.app/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, lab: 'secops-resilience' });
  });

  it('synchronously returns null on expired TTL docs in FirestoreKvAdapter & MemoryKvAdapter', async () => {
    let nowMs = 1_700_000_000_000;
    const { collection, store } = createMockFirestoreCollection();
    const firestoreKv = new FirestoreKvAdapter({
      labSlug: 'secops-resilience',
      collectionRef: collection,
      nowFn: () => nowMs
    });

    await firestoreKv.put('lab3:secops:s1', '{"bom_status":"AI_BOM_ATTESTED"}', {
      expirationTtl: 3600
    });
    const expectedDocId = buildKvDocId('secops-resilience', 'lab3:secops:s1');
    assert.equal(expectedDocId, 'secops-resilience:lab3%3Asecops%3As1');

    const storedDoc = store.get(expectedDocId);
    assert.ok(storedDoc);
    assert.equal(storedDoc.labSlug, 'secops-resilience');
    assert.equal(storedDoc.expireAt?.toMillis(), nowMs + 3_600_000);

    // Before expiry
    assert.equal(await firestoreKv.get('lab3:secops:s1'), '{"bom_status":"AI_BOM_ATTESTED"}');

    // Advance clock past TTL without deleting the doc from Firestore
    nowMs += 3_600_000;
    assert.equal(store.has(expectedDocId), true);
    assert.equal(await firestoreKv.get('lab3:secops:s1'), null);

    // MemoryKvAdapter parity
    let memNow = 1_700_000_000_000;
    const memKv = new MemoryKvAdapter({ labSlug: 'secops-resilience', nowFn: () => memNow });
    await memKv.put('lab3:secops:s2', 'ok', { expirationTtl: 10 });
    assert.equal(await memKv.get('lab3:secops:s2'), 'ok');
    memNow += 10_000;
    assert.equal(await memKv.get('lab3:secops:s2'), null);
  });

  it('rejects forged X-Forwarded-Host headers and allows lab.0trust.dev and localhost:5178', () => {
    const forgedReq = new Request(
      'https://0trust-lab-secops-resilience-abc.run.app/api/secops-resilience/verify-bom',
      {
        headers: {
          'x-forwarded-host': 'evil.com',
          'x-forwarded-proto': 'https'
        }
      }
    );
    assert.equal(
      resolvePublicOrigin(forgedReq),
      'https://0trust-lab-secops-resilience-abc.run.app'
    );

    const localReq = new Request('http://127.0.0.1:8080/api/secops-resilience/verify-bom', {
      headers: {
        'x-forwarded-host': 'localhost:5178',
        'x-forwarded-proto': 'http'
      }
    });
    assert.equal(resolvePublicOrigin(localReq), 'http://localhost:5178');
  });

  it('redacts JWT signatures in _telemetry and never leaks X-Lab-Router-Secret or OTLP_AUTH_HEADER', async () => {
    const otlpAuthSecret = 'Bearer otlp-super-secret-header-token';
    const capturedOtlpBodies: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedOtlpBodies.push(String(init?.body || ''));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const app = createCloudRunApp({
        env: {
          ENVIRONMENT: 'production',
          LAB_SLUG: 'secops-resilience',
          LAB_ROUTER_SECRET: TEST_ROUTER_SECRET,
          OTLP_ENDPOINT: 'https://otlp.example.com',
          OTLP_AUTH_HEADER: otlpAuthSecret
        },
        kv: new MemoryKvAdapter({ labSlug: 'secops-resilience' })
      });

      const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJraWVyYW4ifQ.SuperSecretSignatureXYZ123';
      const res = await app.request(
        'https://0trust-lab-secops-resilience-abc.run.app/api/secops-resilience/verify-bom',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-lab-router-secret': TEST_ROUTER_SECRET,
            authorization: `Bearer ${fakeJwt}`,
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
          },
          body: JSON.stringify({ cosign_verified: true, enforce_hash_pinning: true })
        }
      );

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('traceparent')?.startsWith('00-4bf92f3577b34da6a3ce929d0e0e4736-'));
      assert.ok(res.headers.get('X-Edge-Latency-Ms'));

      const bodyText = await res.text();
      assert.ok(!bodyText.includes('SuperSecretSignatureXYZ123'), 'JWT signature must be redacted');
      assert.ok(!bodyText.includes(TEST_ROUTER_SECRET), 'Router secret must never appear in response');
      assert.ok(!bodyText.includes(otlpAuthSecret), 'OTLP auth header must never appear in response');

      const parsed = JSON.parse(bodyText) as {
        _telemetry: { redacted_auth_header: string; redaction_applied: boolean };
      };
      assert.equal(parsed._telemetry.redaction_applied, true);
      assert.equal(
        parsed._telemetry.redacted_auth_header,
        'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJraWVyYW4ifQ.***REDACTED***'
      );

      await new Promise((r) => setTimeout(r, 10));
      assert.equal(capturedOtlpBodies.length, 2);
      for (const body of capturedOtlpBodies) {
        assert.ok(body.includes('zerotrust-lab-secops-resilience'));
        assert.ok(!body.includes(TEST_ROUTER_SECRET));
        assert.ok(!body.includes('SuperSecretSignatureXYZ123'));
        assert.ok(!body.includes(otlpAuthSecret));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('executes full Lab 3 happy-path flow (verify-bom → canary-probe → kill-switch dual-custody)', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'secops-resilience' });
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'development',
        LAB_SLUG: 'secops-resilience'
      },
      kv
    });

    const sessionId = 'lab3-e2e-session';

    // 1. Verify CycloneDX AI-BOM (attested)
    const bomOkRes = await app.request('http://127.0.0.1:8080/api/secops-resilience/verify-bom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({
        model_digest: EXPECTED_MODEL_DIGEST,
        system_prompt_sha256: EXPECTED_PROMPT_SHA256,
        mcp_schema_hash: EXPECTED_MCP_SCHEMA_HASH,
        cosign_verified: true,
        enforce_hash_pinning: true
      })
    });
    assert.equal(bomOkRes.status, 200);
    const bomOkData = (await bomOkRes.json()) as { status: string; drift_detected: boolean };
    assert.equal(bomOkData.status, 'AI_BOM_ATTESTED');
    assert.equal(bomOkData.drift_detected, false);

    // 2. Canary probe triggers 423 on CUST-CANARY-999
    const canaryRes = await app.request(
      'http://127.0.0.1:8080/api/secops-resilience/canary-probe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
        body: JSON.stringify({ scenario: 'INDIRECT_INJECTION_CANARY' })
      }
    );
    assert.equal(canaryRes.status, 423);
    const canaryData = (await canaryRes.json()) as { status: string; recommended_tier: string };
    assert.equal(canaryData.status, 'CANARY_TRIPWIRE_TRIGGERED');
    assert.equal(canaryData.recommended_tier, 'TIER_1_MCP_FREEZE');

    // 3. Tier 3 Global Breaker fails closed (403) without CISO FIDO2 assertion, succeeds (200) with it
    const t3BlockedRes = await app.request(
      'http://127.0.0.1:8080/api/secops-resilience/kill-switch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
        body: JSON.stringify({ action: 'TIER_3_GLOBAL_BREAKER', ciso_cosign_verified: false })
      }
    );
    assert.equal(t3BlockedRes.status, 403);
    const t3BlockedData = (await t3BlockedRes.json()) as { error: string };
    assert.equal(t3BlockedData.error, 'DUAL_CUSTODY_REQUIRED');

    const t3OkRes = await app.request('http://127.0.0.1:8080/api/secops-resilience/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({
        action: 'TIER_3_GLOBAL_BREAKER',
        ciso_cosign_verified: true,
        fido2_assertion_id: 'fido2-ciso-assertion-001'
      })
    });
    assert.equal(t3OkRes.status, 200);
    const t3OkData = (await t3OkRes.json()) as { status: string; fido2_assertion_id: string };
    assert.equal(t3OkData.status, 'TIER_3_GLOBAL_BREAKER_ACTIVE');
    assert.equal(t3OkData.fido2_assertion_id, 'fido2-ciso-assertion-001');
  });
});
