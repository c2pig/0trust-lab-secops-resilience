# Lab 3 Architecture: AI Supply Chain & Runtime Kill Switch (`0trust-lab-secops-resilience`)

Standalone Model 1 lab hosted on Cloudflare Pages (`0trust-lab-secops-resilience.pages.dev`) and routed via `0trust-lab-router` at `https://lab.0trust.dev/secops-resilience`.

## Architecture Overview

![AI Supply Chain & Runtime Kill Switch Architecture](diagrams/secops_resilience_architecture.svg)

## Components & Contracts

1. **Persona Seats (3)**:
   - `mlsecops` (**Kieran Patel**): CI/CD & CycloneDX AI-BOM Gate (Model Digest, System Prompt SHA-256, MCP Schema Hash, Sigstore Cosign OIDC).
   - `soc-commander` (**Nadia Morales**): Runtime War Room operating `CUST-CANARY-999` tripwire probes, runaway velocity guards (`>$50/min`), and the 3-Tier Kill Switchboard.
   - `ciso-cosigner` (**Morgan Vance**): Dual-custody hardware FIDO2 WebAuthn co-signer required for Tier 3 Global Fleet Circuit Breaker.

2. **Edge API Endpoints (`functions/api/secops-resilience/`)**:
   - `POST /api/secops-resilience/verify-bom`: Evaluates CycloneDX AI-BOM hashes and Cosign OIDC attestation; fails closed (`403 AI_BOM_HASH_MISMATCH`) on Trap 3A when hash pinning is enabled.
   - `POST /api/secops-resilience/canary-probe`: Detects `CUST-CANARY-999` exfiltration (Trap 3B), DLP-001..003 violations, and `>$50/min` runaway cost loops (Trap 3C) with `423 CANARY_TRIPWIRE_TRIGGERED`.
   - `POST /api/secops-resilience/kill-switch`: Executes `TIER_1_MCP_FREEZE`, `TIER_2_IAM_DENY` (AWS IAM `Deny *`), `TIER_3_GLOBAL_BREAKER` (fails closed `403 DUAL_CUSTODY_REQUIRED` without CISO FIDO2 assertion), and `RESET`.

3. **State & Observability**:
   - Session-scoped `STATE_KV` (`lab3:secops:<sessionId>`, `1h TTL`) with ephemeral-edge `Map` fallback and `$0/mo` deterministic client-side fallback in `vite dev`.
   - `functions/api/_middleware.ts` injects W3C `traceparent` and `_telemetry` spans into JSON responses for `XRayTelemetryDrawer`.
