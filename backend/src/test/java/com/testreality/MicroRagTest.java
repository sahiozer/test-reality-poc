package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import java.net.InetSocketAddress;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MicroRagTest {
    final ObjectMapper mapper=new ObjectMapper();
    final DomainContextRetriever retrieval=new DomainContextRetriever(mapper);
    JsonNode cases() throws Exception { return mapper.readTree(getClass().getResourceAsStream("/rag-quality.json")); }
    ExplanationInput input(JsonNode f) {return ExplanationInput.from(f,mapper).withContext(retrieval.retrieve(f),retrieval.version());}
    String observation(ExplanationInput i) {return "PROD ortamında "+i.subject()+" için "+i.prodText()+" görülüyor. TEST ortamında "+i.testText()+" görülüyor.";}
    @Test void fiveCaseTopThreeRetrievalQualityAndDeterminism() throws Exception {
        assertEquals(15,retrieval.chunkCount());
        for (JsonNode c:cases()) {
            var f=c.get("finding");var before=f.deepCopy();var chunks=retrieval.retrieve(f);
            assertEquals(chunks,retrieval.retrieve(f));assertTrue(chunks.size()<=3);
            if(c.path("expectedChunk").isNull()) assertTrue(chunks.isEmpty());
            else assertEquals(c.path("expectedChunk").asText(),chunks.get(0).path("id").asText());
            for(var chunk:chunks) {
                assertTrue(chunk.path("relevanceScore").asDouble()>0);assertFalse(chunk.path("content").asText().isBlank());
                if(!f.path("finding_type").asText().equals("DATA_HEALTH_ISSUE")) assertNotEquals("BUSINESS_RULE",chunk.path("sourceType").asText());
            }
            assertEquals(before,f);
        }
    }
    @Test void lexicalBusinessRuleWordsCannotAttachWrongRule() throws Exception {
        ObjectNode wrong=cases().get(0).get("finding").deepCopy();
        ((ObjectNode)wrong.get("evidence")).put("metric","other_health_metric");
        assertTrue(retrieval.retrieve(wrong).isEmpty());
        wrong.put("finding_type","REPRESENTATION_GAP");
        ((ObjectNode)wrong.get("evidence")).put("query","CLOSED customer active account BR-CUSTOMER-001");
        for(var chunk:retrieval.retrieve(wrong)) assertNotEquals("BUSINESS_RULE",chunk.path("sourceType").asText());
        assertTrue(retrieval.retrieve(mapper.createObjectNode()).isEmpty());
    }
    @Test void promptContainsExactChunksAndEvidenceRemainsUnchanged() throws Exception {
        var f=cases().get(0).get("finding");var before=f.deepCopy();var i=input(f);
        var ollama=new OllamaFindingExplanationService(mapper,"http://unused","test-model",3);
        var prompt=mapper.readTree(ollama.request(i,false).path("prompt").asText());
        assertEquals(retrieval.retrieve(f),prompt.get("retrievedContext"));
        assertTrue(prompt.path("contextReference").asText().startsWith("BR-CUSTOMER-001:"));
        assertEquals(f.get("evidence"),i.evidence().get("sourceEvidence"));assertEquals(before,f);
        assertTrue(OllamaFindingExplanationService.SYSTEM.contains("İş kuralı uydurma"));
        assertTrue(OllamaFindingExplanationService.SYSTEM.contains("retrievedContext"));
    }
    @Test void modelMustReturnSuppliedReferenceAndCannotInventRule() throws Exception {
        var i=input(cases().get(0).get("finding"));var returned=new AtomicReference<String>(i.contextReference());
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/api/generate",exchange->{
            exchange.getRequestBody().readAllBytes();
            var output=mapper.createObjectNode().put("observation",observation(i)).put("contextReference",returned.get());
            byte[] bytes=mapper.createObjectNode().put("done",true).put("done_reason","stop").put("response",output.toString()).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });server.start();
        try {
            var ollama=new OllamaFindingExplanationService(mapper,"http://127.0.0.1:"+server.getAddress().getPort(),"test-model",3);
            var text=ollama.explain(i);assertTrue(text.contains(i.contextReference()));assertTrue(text.split("\\s+").length<=140);
            returned.set("BR-UNTRUSTED-999: Mandatory repair.");assertThrows(IllegalStateException.class,()->ollama.explain(i));
        } finally {server.stop(0);}
    }
    @Test void retrievalFailureStillUsesEvidenceOnlyModel() throws Exception {
        var failed=mock(DomainContextRetriever.class);when(failed.retrieve(any())).thenThrow(new IllegalStateException("unavailable"));
        when(failed.version()).thenReturn("unavailable");
        var model=mock(OllamaFindingExplanationService.class);when(model.explain(any())).thenReturn("evidence-only explanation");
        var coordinator=new FindingExplanationCoordinator(mapper,new TemplateFindingExplanationService(),model,true,failed,new MemoryExplanations());
        try {
            var f=cases().get(0).get("finding");var before=f.deepCopy();var detail=coordinator.detail(f);
            assertFalse(detail.path("contextUsed").asBoolean());assertEquals(0,detail.path("retrievedChunkCount").asInt());
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
            while(coordinator.detail(f).path("aiExplanationStatus").asText().equals("PENDING") && System.nanoTime()<deadline) Thread.sleep(10);
            assertEquals("GENERATED",coordinator.detail(f).path("aiExplanationStatus").asText());
            var captured=org.mockito.ArgumentCaptor.forClass(ExplanationInput.class);verify(model).explain(captured.capture());
            assertTrue(captured.getValue().contextReference().isEmpty());assertEquals(before,f);
        } finally {coordinator.close();}
    }
    @Test void modelFailureRetainsContextInTemplateAndPreservesEveryFindingField() throws Exception {
        var model=mock(OllamaFindingExplanationService.class);when(model.explain(any())).thenThrow(new java.net.ConnectException("unavailable"));
        var coordinator=new FindingExplanationCoordinator(mapper,new TemplateFindingExplanationService(),model,true,retrieval,new MemoryExplanations());
        try {
            var f=cases().get(0).get("finding");coordinator.detail(f);
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
            while(coordinator.detail(f).path("aiExplanationStatus").asText().equals("PENDING") && System.nanoTime()<deadline) Thread.sleep(10);
            var detail=coordinator.detail(f);assertEquals("FALLBACK",detail.path("aiExplanationStatus").asText());
            assertTrue(detail.path("aiExplanation").asText().contains("BR-CUSTOMER-001"));assertTrue(detail.path("contextUsed").asBoolean());
            f.fields().forEachRemaining(field->assertEquals(field.getValue(),detail.get(field.getKey())));
        } finally {coordinator.close();}
    }
    @Test void exportRemoteRequestsAndBenchmarkTinyIndex() throws Exception {
        var ollama=new OllamaFindingExplanationService(mapper,"http://unused","qwen2.5:0.5b",75);
        var requests=mapper.createArrayNode();
        for(var c:cases()) if(!c.path("expectedChunk").isNull()) {
            var i=input(c.get("finding"));var item=requests.addObject();item.set("name",c.get("name"));item.set("source",c.get("source"));
            item.set("request",ollama.request(i,true));item.put("template",new TemplateFindingExplanationService().explain(i));
        }
        mapper.writerWithDefaultPrettyPrinter().writeValue(new java.io.File("target/rag-requests.json"),requests);
        var f=cases().get(0).get("finding");for(int n=0;n<1000;n++)retrieval.retrieve(f);
        long[] samples=new long[5000];long cpuStart=java.lang.management.ManagementFactory.getThreadMXBean().getCurrentThreadCpuTime();
        for(int n=0;n<samples.length;n++){long start=System.nanoTime();retrieval.retrieve(f);samples[n]=System.nanoTime()-start;}
        long cpu=java.lang.management.ManagementFactory.getThreadMXBean().getCurrentThreadCpuTime()-cpuStart;
        Arrays.sort(samples);var result=mapper.createObjectNode();result.put("chunks",retrieval.chunkCount());result.put("iterations",samples.length);
        result.put("medianMs",samples[2500]/1_000_000.0);result.put("p95Ms",samples[4750]/1_000_000.0);result.put("cpuPerRetrievalMs",cpu/5000.0/1_000_000);
        System.gc();long before=Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory();
        var secondIndex=new DomainContextRetriever(mapper);System.gc();long after=Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory();
        result.put("approximateAdditionalIndexHeapBytes",Math.max(0,after-before));assertEquals(15,secondIndex.chunkCount());
        mapper.writerWithDefaultPrettyPrinter().writeValue(new java.io.File("target/rag-benchmark.json"),result);
    }
    @Test @EnabledIfEnvironmentVariable(named="RAG_QUALITY_RESULTS",matches=".+")
    void actualRemoteRagResponsesUseOnlyRetrievedReferences() throws Exception {
        var results=mapper.readTree(new java.io.File(System.getenv("RAG_QUALITY_RESULTS")));assertEquals(4,results.size());
        for(int n=0;n<4;n++) {
            var i=input(cases().get(n).get("finding"));var output=mapper.readTree(results.get(n).path("response").asText());
            assertEquals("stop",results.get(n).path("done_reason").asText());assertEquals(2,output.size());
            OllamaFindingExplanationService.validate(output.path("observation").asText(),i);
            assertEquals(i.contextReference(),output.path("contextReference").asText());
            assertTrue((output.path("observation").asText()+" "+i.contextReference()+" "+i.assessmentText()).split("\\s+").length<=140);
        }
        // Inference runs in a bounded background worker; detail requests do not wait.
        assertTrue(results.get(3).path("wall_seconds").asDouble()<120,
                "Warm RAG generation exceeds the 120-second background budget");
    }
}
