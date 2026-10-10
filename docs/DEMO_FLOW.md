# Five-minute executive demo

Use the running dashboard. For the droplet, establish the SSH tunnel in the README and open http://127.0.0.1:28080.

1. **0:00–0:20 — Open the dashboard.** Use the remote SSH tunnel or local port 18080. The overview loads the latest saved backend snapshot; it does not use sample dashboard values.
2. **0:20–0:40 — Environments.** Show `prod_snapshot` and `test_env`, each with 120,000 synthetic customers. Separate schemas represent the production reference and the test environment. Click **Run analysis** if a fresh calculation is desired.
3. **0:40–1:15 — Representation.** Show **32.47% PROD vs 7.51% TEST** for customers with at least two ACTIVE accounts: 38,963 vs 9,013. The gap is 24.96 percentage points.
4. **1:15–1:30 — Interpretation.** A distribution difference alone is not automatically a defect. PROD is a reference; these findings identify cases to review against the intended test scope. The deterministic thresholds are explicit in the evidence.
5. **1:30–2:00 — Coverage.** Open **State coverage** and show **44 / 70** significant PROD states represented. There are **26 missing** and **2 underrepresented**; underrepresented is a subset of represented. Explain the six features and support/prevalence thresholds.
6. **2:00–2:50 — Missing examples.** Select **Missing**. Open several rows, including a retail multi-account state with FX, one with an active loan, or a blocked-account state with an active card. Read the exact features: presence/absence of every feature is part of the state. Show positive PROD support and zero TEST matches.
7. **2:50–3:25 — Data health.** Return to Overview and select **Health**. Show **2,023 CLOSED TEST customers with ACTIVE accounts**, compared with zero in PROD. This combination is a review candidate; no explicit configured business rule is supplied, so do not call it invalid. Foreign keys remain valid.
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
