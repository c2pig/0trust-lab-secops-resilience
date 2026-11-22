# Agent & Contributor Instructions (`0trust-lab-secops-resilience`)

## Two-Way Architecture Diagram Sync (Global <-> Local)

This repository powers **Lab 3 (`AI Supply Chain & Runtime Kill Switch` — `/secops-resilience`)** on [`0trust.dev`](https://github.com/c2pig/0trust.dev/blob/main/docs/ECOSYSTEM_MAP.md), hosted at `https://lab.0trust.dev/secops-resilience`.

Whenever you modify code, edge functions, or infrastructure under `src/`, `functions/`, `infra/`, or `.github/workflows/`:
1. **Local Sync**: Update [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/diagrams/secops_resilience_architecture.svg`](docs/diagrams/secops_resilience_architecture.svg) in the same Pull Request (enforced by [`.github/workflows/diagram-check.yml`](.github/workflows/diagram-check.yml)).
2. **Global Sync**: If public contracts (`lab.manifest.json`, `seats`, `apiEndpoints`, `kvPrefixes`), CycloneDX AI-BOM admission rules, `CUST-CANARY-999` tripwire detectors, or 3-Tier Kill Switch dual-custody interfaces change, also update `docs/labs/secops-resilience.md` (or `docs/ARCHITECTURE.md`), `docs/diagrams/platform_capability_zoomin.svg`, and `src/contracts/labManifest.ts` in [`c2pig/0trust.dev`](https://github.com/c2pig/0trust.dev).
