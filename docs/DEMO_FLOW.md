# Five-minute executive demo

Use the running dashboard. For the droplet, establish the SSH tunnel in the README and open http://127.0.0.1:28080.

1. **0:00–0:20 — Open the dashboard.** Use the remote SSH tunnel or local port 18080. The overview loads the latest saved backend snapshot; it does not use sample dashboard values.
2. **0:20–0:40 — Environments.** Show `prod_snapshot` and `test_env`, each with 120,000 synthetic customers. Separate schemas represent the production reference and the test environment. Click **Run analysis** if a fresh calculation is desired.
3. **0:40–1:15 — Representation.** Show **32.47% PROD vs 7.51% TEST** for customers with at least two ACTIVE accounts: 38,963 vs 9,013. The gap is 24.96 percentage points.
4. **1:15–1:30 — Interpretation.** A distribution difference alone is not automatically a defect. PROD is a reference; these findings identify cases to review against the intended test scope. The deterministic thresholds are explicit in the evidence.
5. **1:30–2:00 — Coverage.** Open **State coverage** and show **44 / 70** significant PROD states represented. There are **26 missing** and **2 underrepresented**; underrepresented is a subset of represented. Explain the six features and support/prevalence thresholds.
6. **2:00–2:50 — Missing examples.** Select **Missing**. Open several rows, including a retail multi-account state with FX, one with an active loan, or a blocked-account state with an active card. Read the exact features: presence/absence of every feature is part of the state. Show positive PROD support and zero TEST matches.
7. **2:50–3:25 — Data health.** Return to Overview and select **Health**. Show **2,023 CLOSED TEST customers with ACTIVE accounts**, compared with zero in PROD. This combination remains a review candidate. The detail retrieves the explicit demo rule BR-CUSTOMER-001; show its source without changing the engine finding or claiming a real bank policy. Foreign keys remain valid.
8. **3:25–3:55 — Freshness.** Select **All findings** and open the freshness finding. Show the **45-day** business timestamp gap: PROD latest 10 October 2026 UTC; TEST latest 26 August 2026 UTC. This measures business dates, not an extraction timestamp.
9. **3:55–4:35 — Evidence.** Open a finding and show structured evidence, denominators/prevalences, rule/calculation method, severity, and calculation timestamp. Optionally open **Fingerprints** for row counts, completeness and relationship health. Refresh to show that the same run is persisted; rerun to create a new database-derived snapshot.
10. **4:35–5:00 — Optional explanation layer.** Findings are calculated and persisted before any LLM request. The local model only phrases the evidence; repair remains future scope.
11. Open a missing state from the 26 current missing states.
12. Show raw structured evidence: all six state attributes, PROD support/prevalence, zero TEST support and assessment.
13. Show **AI Explanation** loading while evidence stays visible; then show the concise Turkish explanation and **Local on-prem model** label. Repeat for three different missing states, then the representation gap and health finding.
14. Explain: **“The engine found the state; the LLM only explains it.”** The conservative final assessment is appended by the backend. For health, show the actual 2,023 TEST count and “incelemeye aday.”
15. Optional safe fallback demo: use the local dashboard, where LLM_ENABLED defaults to false and the explanation provider is disabled, to open a finding. This simulates the unavailable-provider path without stopping remote or shared services.
16. Show **Template fallback**, raw evidence, overview and analysis remaining usable. Fallback is not labeled AI-generated.

The seed is fixed and the business reference cutoff is 10 October 2026 UTC. The latest TEST business date is intentionally older. TEST data age advances with real time; the PROD-to-TEST date gap is stable until source data changes.

On mobile, the compact `Analysis saved` badge is intentionally hidden to save width. A completed run shows the completion message. After loading/refreshing, populated database-derived results and the visible **Last analysis** timestamp provide saved-result feedback. Desktop presentation is unchanged.

## Final AI context demonstration

See [Micro RAG](MICRO_RAG.md) for the current validation and release status.

1. Open a DATA_HEALTH finding and show the unchanged structured evidence: PROD zero, TEST 2,023 CLOSED customers with ACTIVE accounts.
2. Show **Context used**, including **BR-CUSTOMER-001 — Business Rule** and the relevant glossary chunks. Read the explicit demo rule and explain that it comes from the local curated corpus.
3. Show the Turkish **AI Explanation** and its source reference. Say: **“Engine buldu, RAG ilgili kuralı getirdi, LLM açıkladı.”** The model phrases retrieved facts; review still decides next steps.
4. Open the aggregate representation gap: PROD 32.47%, TEST 7.51%. Show the representation-gap definition and PROD context. Confirm that no business rule is fabricated or attached.
5. Show the local template fallback if needed; the evidence and retrieved context remain visible. Do not stop remote/shared services to demonstrate failure.
6. Position the POC honestly: deterministic stats/rules calculate; RAG retrieves trusted context; LLM explains. ML was explored separately and was not integrated because it failed to add an acceptable distinct discovery in this dataset.

## Async demo flow

1. Open a finding: title, PROD/TEST values and structured evidence appear immediately.
2. Show **Context used** once the immediate detail response arrives.
3. Say: **“Engine bulguyu üretti; RAG ilgili kurum bilgisini getirdi.”**
4. Show PENDING and **“Local on-prem AI explanation is being generated…”**
5. Continue discussing the evidence while the single background worker generates text.
6. The open detail polls every four seconds until GENERATED or FALLBACK; closing it stops polling.
7. Say: **“LLM yalnızca bu kanıt ve bağlamı insan diline çeviriyor.”**

Warm/cached findings show their persisted explanation immediately. A busy worker or failed generation supplies a labeled template fallback; evidence and context remain usable.
