# Validation and deployment

Recorded 10 October 2026, Istanbul time. **All validation gates PASS. The isolated vertical slice is deployed and healthy at `/opt/test-reality-poc` on `root@167.172.168.122`.**

## Exact mobile validation fix

The compact `Analysis saved` badge is intentionally hidden below 1200 px. The mobile UX still provides a completed-run status message, database-derived populated results, and a visible **Last analysis** timestamp after loading/refreshing. No UI change was needed.

`frontend/tests/dashboard.spec.cjs` now validates the missing-state card against the actual overview API, scrolls to the saved timestamp, checks visibility and its exact browser-formatted value, and verifies no horizontal page overflow at 390 × 844. The old hidden-badge visibility assertion was removed. Desktop behavior, responsive CSS, generator and calculation semantics are unchanged.

The original failed gate remains documented as the reason for this continuation: the test incorrectly required a deliberately hidden compact badge. No speculative product repairs were performed.

## Complete validation

| Gate | Result |
|---|---|
| Analysis/generator tests with Python 3.12 and real PostgreSQL | PASS; 12 tests |
| Java 21 / Maven backend endpoint tests | PASS; 6 tests; package succeeds |
| TypeScript / React production build | PASS |
| Local browser suite | PASS; 3 tests: desktop, mobile, executive flow; 16.9 seconds |
| Local independent SQL/API checks | PASS; exact deterministic expectations |
| Remote release archive checksums | PASS |
| Remote seeded PostgreSQL / four-container health | PASS |
| Remote Spring analysis execution | PASS; initial run 23.7 seconds |
| Remote SQL/API consistency | PASS; all eight table counts, business metrics, persistence, detail and frontend proxy |
| Remote browser suite through SSH tunnel | PASS; same 3 tests; 47.0 seconds |
| Remote runtime isolation/limits/ports | PASS; dedicated network and volume; loopback-only listeners |
| Preserved Binance-related resources | PASS; hashes and resource IDs unchanged |

## Product-flow evidence

- Overview loads persisted backend results for the two database schemas.
- The browser suite clicked **Run analysis**, observed completion, and confirmed a new run ID.
- Representation-gap, health and freshness findings were opened from the real table, and each displayed its SQL calculation evidence.
- The coverage view displayed **44 / 70**; selecting Missing produced exactly **26 rows**. Opening a state showed positive PROD support and zero TEST matches.
- Refresh loaded the persisted rerun. Before/after business metrics matched exactly; the freshness difference stayed 45 days.
- Independent SQL queries matched API values and all eight source-table row counts. Persisted finding rows matched the API's 31 findings.
- Source review found no generated customer/account/health counts hard-coded in the frontend, backend product source or analysis engine. Golden numbers occur only in regression validation and documentation.
- Mobile visual inspection and browser checks confirmed saved-result timestamp feedback and no page overflow. Tables retain their own horizontal scrolling.

Latest validated local run: `f792115d-ec01-4956-b76b-b314798a321a`. First validated remote run: `289c2a93-1e5a-4b7e-b590-ee0589ed7ca0`. Latest remote run after browser rerun: `c46357e4-a375-4da6-81f7-de166ce8806e`.

## Actual calculated metrics

Fixed seed `20261010`, generator version `1`; no deterministic deviations.

| Metric | PROD | TEST |
|---|---:|---:|
| Customers | 120,000 | 120,000 |
| Accounts | 272,523 | 233,715 |
| Loans | 120,000 | 120,000 |
| Cards | 120,000 | 120,000 |
| Customers with 0 ACTIVE accounts | 18,121 | 18,013 |
| Customers with 1 ACTIVE account | 62,916 | 92,974 |
| Customers with 2+ ACTIVE accounts | 38,963 | 9,013 |
| 2+ ACTIVE-account prevalence | 32.4692% | 7.5108% |
| Customers with FX accounts | 33,716 | 31,567 |
| Customers with ACTIVE loans | 35,969 | 33,528 |
| Customers with ACTIVE cards | 72,030 | 64,871 |
| CLOSED customers with ACTIVE accounts | 0 | 2,023 |
| Latest business timestamp (UTC) | 2026-10-10 00:00 | 2026-08-26 00:00 |

Multi-account gap: **24.9583 percentage points**. Freshness difference: **45 days**. TEST age at the latest remote analysis: **44.9839 days**, which advances with analysis time; the fixed business reference is UTC midnight on 10 October. All orphan counts are zero.

Coverage: **70 significant PROD states; 44 represented; 26 missing; 2 underrepresented**. Underrepresented is a subset of represented. Thresholds remain support ≥100, PROD prevalence ≥0.1%, and underrepresentation when TEST prevalence is below 50% of PROD.

**130 fingerprint metrics; 31 findings**: 3 representation gaps, 26 missing states, 1 data-health issue, 1 freshness gap.

## Remote runtime and resources

| Service | Health | Memory usage / cap | Sampled CPU | Restarts |
|---|---|---|---|---|
| postgres | healthy | 122.7MiB / 384MiB | 0.14% | 0 |
| analysis | healthy | 49.78MiB / 384MiB | 0.24% | 0 |
| backend | healthy | 169.3MiB / 640MiB | 0.20% | 0 |
| frontend | healthy | 3.348MiB / 64MiB | 0.00% | 0 |

All four containers report `OOMKilled=false`. Combined working-set memory is approximately **345 MiB**, with aggregate limits of **1.44 GiB RAM and 0.95 vCPU**. The five one-second host CPU samples averaged **94.8% idle**; these are short observations, not load-test guarantees.

Host RAM: 3.82 GiB total, **2.81 GiB available**, 431 MiB completely free, no swap. Root filesystem: 5.95 GiB used and **70.48 GiB free**.

Docker reports 5 images / 1.992 GB total (including the preserved 516.3 MB Binance image), 4 project containers, 1 project volume / 401.3 MB, and zero build cache. Release archives are retained only under the new project path. All project images were built on the Mac and loaded on the droplet.

Only frontend `127.0.0.1:18080` and backend `127.0.0.1:18081` are published. PostgreSQL and analysis have no published ports. SSH 22, local DNS 53 and time-service UDP 323 remain unchanged. No public HTTP or firewall change was made.

Isolation checks confirmed exactly the dedicated `test-reality-poc_backend` network, the `test-reality-poc_postgres_data` volume, and project-only mounts. No host networking, privileged containers or Docker socket mounts are present. Memory and CPU caps were inspected on each running container.

## Preservation

Read-only before/after SHA-256 inventories of file contents, paths, modes, sizes and modification timestamps match for:

- `/opt/binancebot`
- `/opt/liquidation-pilot-v1`
- `/opt/liquidation-recorder-v1`

Every pre-existing Docker image and network ID remains present and unchanged. The liquidation recorder remains disabled/inactive with the same service state. No preserved files, services, images, networks or volumes were modified, deleted or restarted.

## Demo access and evidence

Remote dashboard: **http://127.0.0.1:28080** through the established SSH tunnel. Remote backend health: **http://127.0.0.1:28081/actuator/health**. Local stack remains at http://127.0.0.1:18080.

To re-establish the tunnel when needed:

```sh
/usr/bin/ssh -o UseKeychain=yes -o ExitOnForwardFailure=yes -N \
  -L 28080:127.0.0.1:18080 -L 28081:127.0.0.1:18081 root@167.172.168.122
```

Local evidence artifacts are ignored by Git: `.local/local-smoke.json`, `.local/remote-smoke.json`, `.local/remote-result.json`, `.local/remote-analysis-summary.json`, `.local/remote-browser.log`, `.local/deployment-preflight.json`, `.local/remote-audit.json`, and local/remote dashboard screenshots. Database snapshots/findings are also persisted remotely in the `metadata` schema.

The updated [five-minute demo](DEMO_FLOW.md) explains that distribution differences require interpretation against intended test scope, then shows state coverage, missing-state examples, health, freshness and evidence. AI/LLM explanation remains the next layer. No Ollama, LLM, repair generation, Oracle or authentication was added.

## Optional local LLM explanation release

The earlier results above describe the pre-LLM baseline. This release preserves those analytical semantics and metrics, adding only an optional finding-detail explanation.

Local validation: 15 Java tests pass (one additional remote-response test is deferred until remote inference); 12 Python tests pass; TypeScript/Vite production build passes; six browser tests pass, including the original executive flow, generated/loading and mobile/transport fallback. Independent SQL/API smoke confirms 31 findings, 130 fingerprints, 70 significant states, 44 represented, 26 missing, two underrepresented, 38,963/9,013 multi-account customers, 2,023 TEST health candidates and a 45-day freshness gap.

Java tests use an HTTP stub and never install/run Ollama locally. The nine-case remote model quality set and resource measurements are documented in [LLM integration](LLM_INTEGRATION.md).

Final release checks: **16/16 Java tests**, **12/12 Python tests**, production frontend build, **6/6 local browser tests**, **7/7 remote browser tests** (including one real-model desktop/mobile test), **9/9 constrained remote quality cases**, and independent local/remote SQL/API smoke all pass. The remote browser executive flow reran analysis successfully. Every business metric matched the pre-LLM deployed baseline; table counts, 31 findings, 130 fingerprint metrics, 70/44/26/2 coverage counts and the 45-day freshness gap remain unchanged. The Python engine, generator and SQL source schemas were not changed or reseeded.

The postdeployment cold representation probe took 47.07 s, with 5.44 s model load and 32.58 s first-token latency. Ollama used 117.57 MiB unloaded and 617.77 MiB loaded (618.02 MiB peak); average inference CPU was 0.488 cores. Minimum available host RAM was 2.29 GiB; concurrent backend/frontend HTTP probes succeeded, slowest 461 ms. The real Spring/React missing-state browser flow completed in 40.2 s and showed the generated Turkish text correctly on desktop and mobile. Subsequent cache reads are immediate.

Remote audit: PostgreSQL, analysis, backend, frontend and Ollama are all healthy, with zero restarts and no OOM kills. All use only `test-reality-poc_backend`; storage is the dedicated PostgreSQL/model volumes. Ollama has no published port or Docker socket and is not privileged. Existing loopback ports 18080/18081 remain the only POC host listeners. No new public listeners were added. Caps remain 384/384/640/64/1024 MiB and 0.25/0.30/0.35/0.05/0.50 CPU; swap remains zero.

During the loaded-model final audit, host available RAM was 2.26 GiB and disk free space 61.21 GiB. Docker contains eight images (11.41 GB), five containers and two volumes (~799 MB), with no build cache. PostgreSQL and analysis container IDs stayed unchanged; analysis was only tagged with the new release image name, without rebuilding or restarting it. Only the backend/frontend application images were replaced.

Preservation passed against the original baseline: directory contents, modes, sizes and mtimes under `/opt/binancebot`, `/opt/liquidation-pilot-v1` and `/opt/liquidation-recorder-v1` have identical digest inventories. Every original image and network ID remains present, including the retained Binance image. Recorder stays disabled/inactive. No shared service, SSH, firewall, swap or host package configuration was changed. This release did not install or run Ollama, download a model, or create an Ollama image/volume on the Mac. A final read-only check found a pre-existing `/usr/local/bin/ollama` symlink to `/Applications/Ollama.app/Contents/Resources/ollama` (binary modified 28 August 2026); it was never invoked or changed. No local Ollama Docker image or Test Reality model volume exists.

A quiet post-validation sample measured 2.28 GiB available RAM, 61.21 GiB free disk and **97.6% CPU idle** across five one-second intervals, with the model still resident. Ollama working memory was 620.6 MiB.
