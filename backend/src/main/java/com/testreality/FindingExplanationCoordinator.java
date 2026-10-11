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
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Service
public class FindingExplanationCoordinator {
    private final ObjectMapper mapper;
    private final FindingExplanationService template;
    private final OllamaFindingExplanationService ollama;
    private final boolean enabled;
    private final DomainContextRetriever retrieval;
    private final ExplanationRepository repository;
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new SynchronousQueue<>(), runnable -> {
        Thread thread=new Thread(runnable,"finding-explanation");thread.setDaemon(true);return thread;
    });
    public FindingExplanationCoordinator(ObjectMapper mapper,TemplateFindingExplanationService template,
            OllamaFindingExplanationService ollama,@Value("${explanation.enabled:false}") boolean enabled,
            DomainContextRetriever retrieval,ExplanationRepository repository) {
        this.mapper=mapper;this.template=template;this.ollama=ollama;this.enabled=enabled;
        this.retrieval=retrieval;this.repository=repository;
    }
    private static String hash(String text) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    }
    public synchronized JsonNode detail(JsonNode finding) {
        ObjectNode detail=finding.deepCopy();
        try {
            ExplanationInput original=ExplanationInput.from(finding,mapper);
            var contexts=mapper.createArrayNode();
            long retrievalStart=System.nanoTime();
            try {contexts=retrieval.retrieve(finding);} catch(Exception unavailable) { /* evidence-only */ }
            double retrievalMs=(System.nanoTime()-retrievalStart)/1_000_000.0;
            String knowledgeVersion="CARDS".equals(finding.path("domain").asText())?retrieval.cardsVersion():retrieval.version();
            ExplanationInput input=original.withContext(contexts,knowledgeVersion);
            String summary=template.explain(input);
            String evidenceHash=hash(finding.toString());
            String contextHash=hash(knowledgeVersion+"|"+contexts);
            String model=enabled ? String.valueOf(ollama.modelName()) : "disabled";
            // Context, model, prompt and evidence changes each invalidate the durable result.
            String key=hash(finding.path("finding_id").asText()+"|"+evidenceHash+"|"+contextHash+"|"+model+"|"+OllamaFindingExplanationService.SYSTEM+"|rag-async-1");
            ExplanationRepository.Result result;
            try {
                result=repository.find(key);
                if(result==null) {
                    boolean created=repository.createPending(key,finding.path("finding_id").asText(),evidenceHash,contextHash,model,summary);
                    if(created) {
                        result=new ExplanationRepository.Result(null,"PENDING",null);
                        if(enabled) {
                            try {worker.execute(()->generate(key,input,summary));}
                            catch(java.util.concurrent.RejectedExecutionException busy) {
                                repository.complete(key,summary,"FALLBACK",0);
                                result=new ExplanationRepository.Result(summary,"FALLBACK",0.0);
                            }
                        } else {
                            repository.complete(key,summary,"FALLBACK",0);
                            result=new ExplanationRepository.Result(summary,"FALLBACK",0.0);
                        }
                    } else result=repository.find(key);
                }
                if(result==null) throw new IllegalStateException("Explanation lifecycle unavailable");
            } catch(RuntimeException unavailable) {
                result=new ExplanationRepository.Result(summary,"FALLBACK",null);
                org.slf4j.LoggerFactory.getLogger(getClass()).warn("Explanation store unavailable; returning template");
            }
            detail.put("deterministicSummary",summary);
            detail.put("aiExplanation",result.status().equals("PENDING")?"":result.text());
            detail.put("aiExplanationStatus",result.status());
            if(result.generationLatencyMs()!=null) detail.put("generationLatencyMs",result.generationLatencyMs());
            detail.put("explanationCacheKey",key);
            detail.set("explanationInput",input.evidence());
            detail.set("retrievedContext",contexts);
            detail.put("contextUsed",!contexts.isEmpty());
            detail.put("retrievedChunkCount",contexts.size());
            detail.put("retrievalLatencyMs",retrievalMs);
        } catch(Exception unsupported) {
            detail.put("deterministicSummary",finding.path("explanation").asText());
            detail.put("aiExplanation",finding.path("explanation").asText());
            detail.put("aiExplanationStatus","FALLBACK");
        }
        return detail;
    }
    private void generate(String key,ExplanationInput input,String summary) {
        long start=System.nanoTime();String text,status;
        try {text=ollama.explain(input);status="GENERATED";}
        catch(Exception unavailable) {text=summary;status="FALLBACK";}
        try {repository.complete(key,text,status,(System.nanoTime()-start)/1_000_000.0);}
        catch(RuntimeException unavailable) {org.slf4j.LoggerFactory.getLogger(getClass()).warn("Could not persist explanation; startup recovery will supply fallback");}
    }
    @PreDestroy public void close() {
        worker.shutdownNow();
        try {worker.awaitTermination(5,TimeUnit.SECONDS);} catch(InterruptedException interrupted) {Thread.currentThread().interrupt();}
    }
}
