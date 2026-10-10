package com.testreality;

/** Durable lifecycle is separate from immutable deterministic findings. */
public interface ExplanationRepository {
    record Result(String text, String status, Double generationLatencyMs) {}
    Result find(String key);
    boolean createPending(String key, String findingId, String evidenceHash, String contextHash,
                          String model, String fallback);
    void complete(String key, String text, String status, double generationLatencyMs);
}
