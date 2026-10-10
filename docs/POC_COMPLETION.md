# Test Reality POC — completion seal

**POC STATUS: COMPLETE / PASS**

**Technically frozen for executive demo.** The validated product release remains `5c3dc3c3454fb8a8241a5afb5b2a4dd9c9aceff7`, running at `/opt/test-reality-poc`. The final seal commit changes preservation tooling and documentation only. Its identity is recorded remotely in `SEAL-COMMIT.txt`; `COMMIT.txt` continues to identify the deployed product release.

## Deterministic engine

- 130 fingerprint metrics and 31 findings.
- Data-state coverage: 44/70; 26 missing states and two underrepresented states.
- 2,023 data-health candidates in TEST, compared with zero in PROD.
- 45-day PROD-to-TEST business freshness gap.
- All original deterministic values remained unchanged; the remote overview exactly matched the pre-deployment snapshot.

## LLM and RAG

CPU-only Ollama runs `qwen2.5:0.5b` with the validated model and parameters. Generation is asynchronous, with a 120-second background request bound, deterministic template fallback and immediate structured evidence. PostgreSQL persists explanation state and cached results. The UI polls every four seconds and stops polling when the detail closes or reaches a terminal status.

Micro RAG uses BM25 over 15 curated local/on-prem chunks, with no external embedding API. It retrieves applicable business-rule, glossary and definition context. Representation-gap validation retrieved definitions only and fabricated no business rule. RAG supplies explanation context; it does not discover findings or change the deterministic engine.

## Fresh remote async measurements

These measurements are retained from the successful product validation; generation was not rerun for this seal.

| Case | Immediate detail | BM25 retrieval | Background generation | Cached detail | Final status |
|---|---:|---:|---:|---:|---|
| Health | 487 ms | 6.755 ms | 79.01 s | 46 ms | GENERATED |
| Long missing-state (734 PROD / 0 TEST) | 17 ms | 0.405 ms | 85.57 s | 80 ms | GENERATED |
| Representation gap | 13 ms | 0.333 ms | 74.11 s | 14 ms | GENERATED |

All three uncached requests returned PENDING with evidence and retrieved context immediately. The remote browser confirmed visible evidence/context while AI generation remained pending. Twenty duplicate health requests shared one cache row and one background job. The executor has one worker and zero queued jobs; a different finding requested while busy received an immediate persisted fallback.

## Validation record

Previously completed validation passed: Java 29/29, Python 12/12 against real PostgreSQL, 12 additional real JDBC/PostgreSQL persistence assertions, frontend TypeScript/Vite build, 11 local browser tests, both remote live browser tests, a real remote PENDING/evidence/context UI check, local and remote SQL/API smoke, Micro RAG grounding and async generation validation. The disabled-provider fix preserved the original no-provider-interaction contract.

This seal session ran the corrected preservation audit exactly once, with a read-only runtime snapshot. No full product validation or image rebuild was repeated.

## Runtime snapshot

Captured 2026-10-10T11:33:28.633885+00:00.

- PostgreSQL, analysis, backend, frontend and Ollama: all five running and healthy; zero restarts and zero OOM kills.
- Host RAM: 3.82 GiB total, 2.73 GiB available, 638 MiB free; no swap.
- During the three async probes: at least 2.21 GiB host RAM available; peak Ollama working set 651.53 MiB under its unchanged 1,024 MiB cap.
- CPU: two vCPUs; approximately 95% idle over the two fresh one-second intervals. Prior generation averaged 0.477–0.484 CPU cores under the unchanged 0.50 CPU limit.
- Root disk: 61.02 GiB free.
- Backend/frontend were the only product containers replaced during the completed release. PostgreSQL, analysis and Ollama container IDs remained unchanged.

## Preservation — PASS

The original pre-POC baseline is retained byte-for-byte in `infra/preservation-baseline.json`. Its directory/service records also match the pre-async-deployment capture.

Baseline SHA-256: `eac90b62515807ecd872fe17b9bb99987d634535e10d525abb50f733a3ba1c82`.

The corrected audit checks baseline identities rather than global inventory equality:

- `/opt/binancebot`, `/opt/liquidation-pilot-v1` and `/opt/liquidation-recorder-v1`: unchanged digest, entry count, file contents, modes, sizes, modification times and symlink targets.
- Retained Binance image tag and image ID: present and unchanged.
- All five pre-existing networks: names and IDs present and unchanged, including Binance-related `app_default` and `forward-observe_default` and the baseline Docker built-in networks.
- Recorded liquidation recorder service state: unchanged.
- No protected resource deleted or replaced. Additional Test Reality image tags and Compose resources are permitted.

Result: **PASS**, zero differences; three protected directories, one protected image, five protected networks. Audit captured at 2026-10-10T11:33:28.633885+00:00.

```sh
cd /opt/test-reality-poc
python3 infra/preserved-audit.py --baseline infra/preservation-baseline.json
```

Binance resources remain unchanged. The earlier global-image assertion failed on expected POC image additions; the semantic assertion resolves that audit-scope issue.

## Exploratory ML

Exploratory ML was not integrated because it failed the distinct-value quality gate: it did not demonstrate an acceptable distinct discovery beyond the deterministic findings. This is an exploration outcome; the validated POC is complete and passes its scope. Experiment artifacts remain separate from product data and behavior.

## Freeze

The remote deployment remains running. This seal introduces no product functionality, data, model, RAG, async behavior or resource-limit changes. Further product work requires a separate explicitly approved scope. Executive demo uses the frozen release and the documented demo flow.
