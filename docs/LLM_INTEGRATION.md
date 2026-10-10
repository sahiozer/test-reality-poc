# Optional local explanation layer

**Test Reality is LLM-enhanced, not LLM-dependent.**

The SQL/Python engine calculates fingerprints, coverage and findings. Ollama receives a bounded structured finding and phrases two Turkish observation sentences. The backend appends the engine-derived, conservative assessment. The LLM does not calculate metrics, select findings, change validity/severity, infer business rules, or perform repair. No overview or analysis endpoint calls Ollama.

## Contract and trust boundary

`ExplanationInput` includes version, finding type, original source evidence and exact PROD/TEST values. State inputs preserve all six attributes, including false flags and blocked-account presence. Raw prevalence fractions remain unchanged; the backend supplies display percentages rounded to two decimals. Model output must copy these displays and the evidence-derived Turkish state description. Counts use ungrouped digits and decimals use Turkish commas. No original finding is modified.

The model receives a compact structured projection (all state flags, exact counts/prevalences and supplied display values); duplicate full evidence remains in the API contract, outside the phrasing prompt. Without retrieved context, the model returns JSON containing only `observation`. With Micro RAG, it additionally returns an exact validated `contextReference` from the supplied source; see [Micro RAG](MICRO_RAG.md). A data-derived JSON Schema pattern fixes the exact subject and PROD/TEST displays while allowing equivalent neutral Turkish connectors and verbs. This is intentionally **constrained surface generation**, not free interpretation. The tiny model proved unreliable with unconstrained prose, so it never gets authority to add new claims. The grammar is derived from each finding, without hard-coded demo counts or attributes; Ollama still generates the observation tokens. Acceptance checks require the subject, exact PROD/TEST displays in the correct sentence, only permitted numerical tokens, two short sentences, and absence of unsupported assessment/risk/repair wording. The backend supplies the final assessment, so the model cannot upgrade it. Bad, truncated or malformed text falls back. These checks constrain this narrow contract; they are not a general semantic correctness guarantee for arbitrary future findings.

The persisted closed-customer/active-account evidence remains unchanged and has no explicit configured rule source. Micro RAG supplies the separate, explicit demo rule BR-CUSTOMER-001 as `curated_demo_knowledge`. Its explanation references that source and still says **incelemeye aday**, without increasing the engine assessment. A configured-rule statement requires both `ruleSource=configured_business_rule` and nonempty `ruleText` in evidence. A labeled validation fixture tests that path; it does not configure a production business rule.

## Runtime and fallback

GET `/api/findings/{id}` preserves every original field and returns structured evidence, deterministic summary and retrieved context immediately. An uncached enabled-provider result is PENDING; one background worker makes one HTTP request bounded to 120 seconds. The UI polls every four seconds until GENERATED or FALLBACK, and stops polling on close. The worker has one thread and zero queued jobs: busy new findings receive an immediate persisted template fallback. There are no retries. Disabled providers receive no interactions, including metadata getters.

`metadata.finding_explanation` persists PENDING/GENERATED/FALLBACK state separately from deterministic findings. Its unique SHA-256 cache key includes finding ID, complete original evidence, knowledge version and retrieved context, model identity, system prompt and explanation version. Atomic insertion prevents duplicate jobs; only PENDING rows can be completed. Generated/fallback results survive backend restarts. Startup recovers interrupted PENDING rows to their stored template fallback. The deployment uses a single backend instance; this recovery policy is not designed for multiple concurrent backend instances. Store failure returns an immediate template without blocking evidence/context.

The UI labels successful text **Local on-prem model** and fallback **Template fallback**. Transport failures also keep finding evidence usable. Generated observations contain at most 70 words; evidence-only explanations stay within 100 words in the original validation set; the RAG quality set is bounded to 140 words including the source reference.

## Remote-only deployment

The base Compose file never includes Ollama. Do not install or run Ollama on the Mac. Only on the droplet, use the base file plus `infra/compose.ollama.yml`. The service joins `test-reality-poc_backend` and stores its one model in `test-reality-poc_ollama_models`. It has no published ports, GPU, host network, privileged mode or Docker socket; capabilities are dropped and the root filesystem is read-only. Limits: 1,024 MiB RAM with no additional swap and 0.50 CPU. One model, one concurrent request, 2,048-token context, 224 output tokens, 64-token prompt batches, one CPU inference thread, temperature zero, fixed seed, two-minute keep-alive, and cloud features disabled.

Central backend settings: `LLM_ENABLED` (default false), `OLLAMA_URL`, `LLM_MODEL` and `LLM_TIMEOUT_SECONDS` (120). `FindingExplanationService` separates the template and Ollama adapters; changing provider requires only a new adapter and controlled validation, not analysis changes.

Remote commands (run from `/opt/test-reality-poc`):

```sh
docker compose --env-file infra/.env -f infra/compose.yml -f infra/compose.ollama.yml up -d --no-deps ollama
docker compose --env-file infra/.env -f infra/compose.yml -f infra/compose.ollama.yml exec -T ollama ollama pull qwen2.5:0.5b
```

Pull exactly that one model. Do not run these commands on the Mac. Subsequent application release commands include both Compose files; PostgreSQL and analysis need no recreation. No Binance path, image, network, volume or service belongs to this deployment.

## Quality and resource validation

`backend/src/test/resources/explanation-quality.json` contains three actual missing states, two actual representation gaps, the actual health finding, one explicitly labeled configured-rule fixture, actual freshness evidence and one actual represented state mapped to a validation-only healthy case. These fixtures are not new calculated findings.

Local Java tests use a small HTTP stub, not Ollama. They export `backend/target/explanation-requests.json`. Copy requests to the droplet and run `infra/validate-ollama.py` there; it uses the existing analysis container to call the internal Ollama API sequentially and records streaming first-token latency, total/load durations, cgroup working memory, CPU and concurrent backend/frontend HTTP responsiveness. It stops if available RAM falls below 1 GiB, working memory (excluding reclaimable inactive file cache) exceeds 95% of its limit, or Ollama is OOM-killed. It never changes limits or shared services. Validate captured responses with `OLLAMA_QUALITY_RESULTS=/absolute/results.json mvn -f backend/pom.xml test`.

Measured nine-case constrained validation on the droplet: **9/9 accepted**; average 34.36 s (warm average 31.31 s), first cold/configuration-load request 58.81 s, load duration 6.56 s, first-token latency 35.74 s cold and 12.42 s warm average. Ollama CPU averaged 0.483 cores under the 0.50-core cap. Both API and frontend probes remained successful, with the slowest at 93 ms.

Exact model: `qwen2.5:0.5b`, Q4_K_M, 494.03M parameters, 397,821,319 bytes, digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`; Ollama container image `ollama/ollama:0.40.2`. Only this one model was downloaded, only on the droplet. Model API reports CPU-only inference, 2,048 context and zero VRAM.

Idle service working memory before loading was 117.07 MiB. Selected-configuration loaded working memory was 643.28 MiB, steady-operation peak 652.00 MiB. The first configuration transition included the previous default-batch runner and peaked at 755.05 MiB. Host available RAM never fell below 2.14 GiB during the constrained set. No OOM or restart occurred. Raw cgroup memory included reclaimable model file cache and reached its limit; Linux reclaimed cache normally. The initial probe incorrectly treated that as unsafe RSS pressure. Read-only counter checks showed no OOM, about 693 MiB working memory and 2.20 GiB host RAM available; the probe was corrected to use working memory, without changing RAM/CPU/swap limits.

Unconstrained wording was rejected rather than published. The final grammar-bound model produces simple neutral observations; the deterministic assessment is appended. This tiny model is validated for this narrow contract, not general Turkish reasoning.

Accepted representation example:

> PROD ortamında birden fazla aktif hesabı olan müşteriler için 38963 müşteri (%32,47) görülüyor. TEST ortamında 9013 müşteri (%7,51) görülüyor. Bu veri durumu TEST ortamında daha az temsil ediliyor; kapsam açısından incelenebilir.

Postdeployment runtime and browser verification are recorded in [validation](VALIDATION.md).

## Bank deployment

Keep inference inside the bank's network and send only approved aggregate evidence, not customer rows or credentials. Start with deterministic explanations; enable a replaceable local provider after Turkish quality, governance and resource validation. A future bank adapter can use an approved internal model endpoint with the same contract and fallback. RAG, fine-tuning, agents, natural-language SQL and repair are outside this POC.

Sources: [Ollama model](https://ollama.com/library/qwen2.5:0.5b), [official Qwen model card](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct), [Ollama Docker](https://docs.ollama.com/docker), [resource configuration](https://docs.ollama.com/faq), [generation API](https://docs.ollama.com/api/generate).
