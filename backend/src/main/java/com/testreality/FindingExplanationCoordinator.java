package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Service
public class FindingExplanationCoordinator {
    private record Result(String text,String status) {}
    private final ObjectMapper mapper;
    private final FindingExplanationService template, ollama;
    private final boolean enabled;
    private final LinkedHashMap<String,Result> cache = new LinkedHashMap<>(128,0.75f,true);
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new SynchronousQueue<>(), runnable -> {
        Thread thread = new Thread(runnable,"finding-explanation"); thread.setDaemon(true); return thread;
    });
    public FindingExplanationCoordinator(ObjectMapper mapper, TemplateFindingExplanationService template,
            OllamaFindingExplanationService ollama, @Value("${explanation.enabled:false}") boolean enabled) {
        this.mapper=mapper; this.template=template; this.ollama=ollama; this.enabled=enabled;
    }
    public synchronized JsonNode detail(JsonNode finding) {
        ObjectNode detail = finding.deepCopy();
        try {
            ExplanationInput input = ExplanationInput.from(finding,mapper);
            String summary = template.explain(input);
            // Include the full finding, model configuration lives for the lifetime of this process.
            String key = finding.path("finding_id").asText() + ":" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(finding.toString().getBytes(StandardCharsets.UTF_8)));
            Result result = cache.get(key);
            if (result==null) {
                result = new Result(summary,enabled ? "PENDING" : "FALLBACK");
                cache.put(key,result);
                if (enabled) {
                    try { worker.execute(() -> generate(key,input,summary)); }
                    catch (java.util.concurrent.RejectedExecutionException busy) { result = new Result(summary,"FALLBACK"); cache.put(key,result); }
                }
                if (cache.size()>128) cache.remove(cache.keySet().iterator().next());
            }
            detail.put("deterministicSummary",summary);
            detail.put("aiExplanation",result.status().equals("PENDING") ? "" : result.text());
            detail.put("aiExplanationStatus",result.status());
            detail.set("explanationInput",input.evidence());
        } catch (Exception unsupported) {
            detail.put("deterministicSummary",finding.path("explanation").asText());
            detail.put("aiExplanation",finding.path("explanation").asText());
            detail.put("aiExplanationStatus","FALLBACK");
        }
        return detail;
    }
    private void generate(String key,ExplanationInput input,String summary) {
        Result result;
        try { result = new Result(ollama.explain(input),"GENERATED"); }
        catch (Exception unavailable) { result = new Result(summary,"FALLBACK"); }
        synchronized(this) { if (cache.containsKey(key)) cache.put(key,result); }
    }
    @PreDestroy public void close() { worker.shutdownNow(); }
}
