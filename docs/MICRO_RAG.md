# Micro RAG: trusted context for explanations

**Status: COMPLETE / PASS — deployed and technically frozen for executive demo.** See the [completion seal](POC_COMPLETION.md) for final remote timings, runtime and preservation audit.

RAG does not discover the finding. It retrieves relevant domain context for the finding explanation.

The deterministic engine calculates the existing metrics, coverage and findings. Micro RAG answers where the domain interpretation comes from: a small, reviewed local glossary. Ollama receives structured evidence plus retrieved context and phrases a short Turkish explanation. Human review decides whether to act. RAG never creates findings, changes severity, calculates metrics or authorizes repair.

## Corpus

`docs/domain-knowledge/knowledge.json` contains 15 short synthetic/demo-safe chunks: seven glossary entries, seven domain definitions and one business rule. Each has a stable ID, title, content, source type, lexical keywords and eligible finding types. The single rule is **BR-CUSTOMER-001**: “If customer status is CLOSED, active account count must be 0.” Turkish: “Kapalı müşteri statüsündeki müşterilerin aktif hesabı bulunmamalıdır.”

The customer glossary follows the actual schema: customer statuses are **OPEN/CLOSED**, whereas account statuses are **ACTIVE/CLOSED**. The rule is explicit demo knowledge, not a real bank policy. Adding this explanation context does not change the existing engine health predicate, saved findings or raw evidence. A rule retrieved from the glossary is labeled `curated_demo_knowledge`; it is separate from any rule originally supplied by engine evidence.

The corpus is packaged in the backend JAR from this documentation directory. It loads once at startup, with a version and SHA-256 digest. There is no runtime editing, upload endpoint or ingestion pipeline. A reviewed source change and backend deployment are required to replace it.

## Retrieval

One method: **BM25 lexical retrieval**, implemented in Java inside the existing backend. Constants are k1=1.2 and b=0.75; top-k=3. Unicode tokenization and stable ID tie-breaking make retrieval deterministic. Scores are relevance scores, not probabilities or confidence.

Lexical retrieval fits this tiny corpus and its explicit schema terms. Local embeddings would add another model, dependencies, memory, model-version management and harder-to-audit semantic matches without a demonstrated need. No vector database, scikit-learn dependency or additional service is introduced.

A query is built from known finding type, metric and allowlisted state feature names, never raw customer records or user-provided prose. Eligible finding types filter all chunks before scoring. Business rules additionally require the exact allowlisted metric: BR-CUSTOMER-001 is eligible only for DATA_HEALTH_ISSUE with `closed_customers_with_active_accounts`. A lexical match to “CLOSED customer” cannot attach this rule to a representation gap, unrelated finding or other health metric. At most three positive-score chunks are returned with ID, title, content, sourceType and relevanceScore. Relevance scores are API/debug metadata and are absent from the normal UI.

## Prompt and output

The existing evidence contract remains intact. Additional fields contain `retrievedContext`, `knowledgeVersion`, `contextReference` and explicit retrieved-rule provenance. The model receives the retrieved chunks in its prompt and instructions to use only supplied evidence/context, avoid invented rules/numbers, preserve engine assessment boundaries, stay conservative without a rule and reference a retrieved source briefly.

The small CPU model retains constrained surface generation. Its `observation` describes exact supplied PROD/TEST values. With context, it also emits `contextReference`, constrained to the exact source sentence selected from the highest-ranked chunk. The backend validates both fields and appends the conservative assessment. This is auditable phrasing of retrieved facts, not open-ended reasoning or a claim that the model inferred a rule. Both generated and template explanations show source context; only actual successful model output is labeled **Local on-prem model**.

The detail API adds `retrievedContext`, `contextUsed`, `retrievedChunkCount` and `retrievalLatencyMs`. The **Context used** section shows titles, source types and source text. No context is added to the overview or deterministic finding list. Existing PENDING/GENERATED/FALLBACK/FAILED status contracts remain.

## Failure behavior and security

Missing/malformed corpus or retrieval exceptions return no context and preserve evidence-only model explanations. Ollama timeouts, failures or invalid output use the deterministic template. Busy workers retain the existing bounded fallback behavior. Unsupported findings retain their original explanation. No failure disables the dashboard or deterministic analysis.

Knowledge is trusted only as a curated demo corpus, with explicit applicability gates. Model text outside the supplied observation grammar or exact context sentence is rejected. No raw records, private banking terminology, cloud embedding API or external inference is used. The existing remote CPU-only Ollama deployment, SSH-only dashboard access and resource limits remain. No local Ollama inference is invoked.

## Validation and resources

The quality set covers closed-customer health, representation gap, freshness, missing state and an unrelated finding. Tests check correct first/top-three retrieval, exact reproducibility, rejection of wrong business rules, empty retrieval, prompt inclusion, evidence preservation, unavailable retrieval/model fallbacks and desktop/mobile source display. Remote model validation checks source sentences, numbers, bounded length and actual live detail generation.

The initial local benchmark over 5,000 warmed retrievals measured median **0.0046 ms**, p95 **0.0056 ms**, and **0.0048 ms CPU per retrieval**. A second index added approximately **49,976 bytes** of retained Java heap in that process; GC-based heap estimates are approximate. There are no new dependencies, threads or services for retrieval. Remote measurements and release validation are recorded below after the deployment gate.

## POC positioning

Stats/rules measure known metrics and rules deterministically. RAG retrieves relevant local domain/business context. LLM phrases structured evidence and retrieved facts. ML was explored separately and was not integrated: neither controlled experiment produced an acceptable distinct ML-discovered gap. Experiment artifacts remain in ignored `.local/ml-final/`; no synthetic correlation was added to the product dataset.

## Stopped release validation — 10 October 2026

Local Java validation: 22 passed, two remote-only checks skipped. Python: 12 passed. Frontend TypeScript/Vite build passed. Browser: eight passed, two remote-only live checks skipped. Independent SQL/API smoke passed with all original deterministic counts.

Four real remote Ollama outputs preserved exact evidence, valid source sentences, bounded length and no invented rule. Timings: health 80.28 seconds (cold); representation 67.76; freshness 51.55; missing state 78.95 (warm). The additional remote quality test failed on the warm missing-state deadline assertion after all four grounding checks passed. The failure is retained in `.local/rag-remote-quality-tests.log`. There was no retry or attempt to increase resource limits/deadlines. Fresh remote browser tests and deployment were not performed after this failure.

Retrieval itself is small: the final local warmed benchmark measured median 0.0056 ms, p95 0.0086 ms, CPU 0.0059 ms per retrieval and approximately 50,008 bytes of additional retained index heap. Full prompt generation adds substantial latency on this CPU-limited tiny model; no paired causal latency estimate was completed because validation stopped. The prior evidence-only health measurement was 17.44 seconds, but comparing it to the cold 80.28-second RAG call mixes warming and prompt/output changes.

Remote safety checks passed during model validation: maximum Ollama working set 654.44 MiB under the unchanged 1,024 MiB cap, approximately 0.49 CPU cores under the 0.50 cap, and minimum host available RAM 2.22 GiB. Final audit: all five containers healthy, zero restarts/OOM; deployed image IDs and overview identical to preflight; protected Binance/other project inventories unchanged; available RAM 2.26 GiB, no swap, root disk free 61.20 GiB, mean CPU idle 94.6% over five one-second intervals. Only request/result probe artifacts were written under the existing POC remote directory; no application release was uploaded or deployed.


The stopped experiment above preceded the async follow-up. Local inference remains disabled.

## Async release validation — 10 October 2026

The disabled-provider regression was fixed with one conditional: use the cache model identity `disabled` without invoking `modelName()`. The original no-provider-interaction assertion remains intact. No retrieval corpus/method, model, model parameters, retries or deterministic calculations changed in this fix.

Complete local validation passed: Java 29/29 (including eight Micro RAG and five async tests, plus recorded remote-output grounding checks); Python 12/12 against real PostgreSQL; frontend TypeScript/Vite build; browser 11/11 with two remote-only live tests deferred; independent SQL/API smoke. A separate real JDBC/PostgreSQL lifecycle harness passed 12 assertions in a temporary database and removed that database afterward: atomic duplicate prevention, PENDING creation, GENERATED/FALLBACK durability across repository reconstruction, immutable terminal results and interrupted-job startup recovery. It used the actual production repository and SQL migration.

The current 5,000-iteration warmed retrieval benchmark measured median 0.005792 ms, p95 0.007542 ms, CPU 0.0061498 ms/retrieval and approximately 49,976 bytes retained index heap. These are local retrieval measurements, not LLM timings. All original deterministic values remain: 120,000 customers per environment; 38,963/9,013 multi-account customers; 0/2,023 closed customers with active accounts; coverage 44/70 with 26 missing and two underrepresented; 45-day snapshot gap; 31 findings and 130 fingerprints.

Explanations now persist independently in PostgreSQL. A single worker with zero queue runs one generation bounded to 120 seconds; detail HTTP does not wait. Four-second polling stops at a terminal status or when the detail closes. Unique cache insertion prevents duplicate jobs, and terminal results survive restart. See [LLM integration](LLM_INTEGRATION.md) for cache identity and restart recovery.
