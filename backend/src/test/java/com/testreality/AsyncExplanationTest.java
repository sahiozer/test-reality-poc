package com.testreality;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import java.net.http.HttpTimeoutException;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AsyncExplanationTest {
    final ObjectMapper mapper=new ObjectMapper();
    JsonNode health() throws Exception {return mapper.readTree(getClass().getResourceAsStream("/rag-quality.json")).get(0).get("finding");}
    FindingExplanationCoordinator coordinator(OllamaFindingExplanationService model,DomainContextRetriever rag,ExplanationRepository repo){
        return new FindingExplanationCoordinator(mapper,new TemplateFindingExplanationService(),model,true,rag,repo);
    }
    void terminal(FindingExplanationCoordinator c,JsonNode finding,String expected) throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        while(c.detail(finding).path("aiExplanationStatus").asText().equals("PENDING") && System.nanoTime()<deadline)Thread.sleep(10);
        assertEquals(expected,c.detail(finding).path("aiExplanationStatus").asText());
    }
    @Test void immediatePendingContextAndConcurrentRequestsCreateExactlyOneJob() throws Exception {
        var repo=new MemoryExplanations();var model=mock(OllamaFindingExplanationService.class);
        var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
        when(model.explain(any())).thenAnswer(call->{entered.countDown();release.await(3,TimeUnit.SECONDS);return "grounded";});
        var c=coordinator(model,new DomainContextRetriever(mapper),repo);var clients=Executors.newFixedThreadPool(8);
        try {
            var finding=health();long start=System.nanoTime();var detail=c.detail(finding);
            assertTrue(System.nanoTime()-start<TimeUnit.SECONDS.toNanos(1));assertEquals("PENDING",detail.path("aiExplanationStatus").asText());
            assertEquals("BR-CUSTOMER-001",detail.path("retrievedContext").get(0).path("id").asText());
            assertTrue(entered.await(1,TimeUnit.SECONDS));
            var futures=new java.util.ArrayList<Future<JsonNode>>();for(int n=0;n<20;n++)futures.add(clients.submit(()->c.detail(finding)));
            for(var future:futures)assertEquals("PENDING",future.get(1,TimeUnit.SECONDS).path("aiExplanationStatus").asText());
            assertEquals(1,repo.creations.get());verify(model,times(1)).explain(any());release.countDown();terminal(c,finding,"GENERATED");
            assertEquals("GENERATED",repo.find(detail.path("explanationCacheKey").asText()).status());
        } finally {release.countDown();clients.shutdownNow();c.close();}
    }
    @Test void storedGeneratedSurvivesCoordinatorReplacementWithoutNewGeneration() throws Exception {
        var repo=new MemoryExplanations();var first=mock(OllamaFindingExplanationService.class);when(first.modelName()).thenReturn("same-model");when(first.explain(any())).thenReturn("persisted explanation");
        var c=coordinator(first,new DomainContextRetriever(mapper),repo);var f=health();c.detail(f);terminal(c,f,"GENERATED");c.close();
        var next=mock(OllamaFindingExplanationService.class);when(next.modelName()).thenReturn("same-model");c=coordinator(next,new DomainContextRetriever(mapper),repo);
        try {var detail=c.detail(f);assertEquals("GENERATED",detail.path("aiExplanationStatus").asText());assertEquals("persisted explanation",detail.path("aiExplanation").asText());assertTrue(detail.path("generationLatencyMs").asDouble()>=0);verify(next,never()).explain(any());}
        finally {c.close();}
    }
    @Test void timeoutFallbackPersistsAndUnavailableModelNeverBreaksEvidence() throws Exception {
        var repo=new MemoryExplanations();var model=mock(OllamaFindingExplanationService.class);when(model.explain(any())).thenThrow(new HttpTimeoutException("bounded timeout"));
        var f=health();var c=coordinator(model,new DomainContextRetriever(mapper),repo);
        c.detail(f);terminal(c,f,"FALLBACK");var done=c.detail(f);c.close();
        assertEquals("FALLBACK",repo.find(done.path("explanationCacheKey").asText()).status());
        c=coordinator(model,new DomainContextRetriever(mapper),repo);
        try {var cached=c.detail(f);assertEquals(done.path("aiExplanation"),cached.path("aiExplanation"));assertEquals("FALLBACK",cached.path("aiExplanationStatus").asText());f.fields().forEachRemaining(field->assertEquals(field.getValue(),cached.get(field.getKey())));}
        finally {c.close();}
        verify(model,times(1)).explain(any());
    }
    @Test void evidenceAndKnowledgeVersionInvalidateStoredResults() throws Exception {
        var repo=new MemoryExplanations();var model=mock(OllamaFindingExplanationService.class);when(model.explain(any())).thenReturn("grounded");
        var real=new DomainContextRetriever(mapper);var rag=mock(DomainContextRetriever.class);when(rag.retrieve(any())).thenAnswer(call->real.retrieve(call.getArgument(0)));when(rag.version()).thenReturn("v1");
        var c=coordinator(model,rag,repo);var f=health();c.detail(f);terminal(c,f,"GENERATED");var oldKey=c.detail(f).path("explanationCacheKey").asText();c.close();c=coordinator(model,rag,repo);
        try {
            ObjectNode changed=f.deepCopy();((ObjectNode)changed.get("evidence")).put("extraEvidence","changed");
            c.detail(changed);terminal(c,changed,"GENERATED");assertNotEquals(oldKey,c.detail(changed).path("explanationCacheKey").asText());
            c.close();when(rag.version()).thenReturn("v2");c=coordinator(model,rag,repo);c.detail(f);terminal(c,f,"GENERATED");assertNotEquals(oldKey,c.detail(f).path("explanationCacheKey").asText());assertEquals(3,repo.creations.get());
        } finally {c.close();}
    }
    @Test void databaseUnavailableStillReturnsTemplateAndContext() throws Exception {
        var repo=mock(ExplanationRepository.class);when(repo.find(any())).thenThrow(new IllegalStateException("unavailable"));
        var model=mock(OllamaFindingExplanationService.class);var c=coordinator(model,new DomainContextRetriever(mapper),repo);var f=health();
        try {var d=c.detail(f);assertEquals("FALLBACK",d.path("aiExplanationStatus").asText());assertTrue(d.path("contextUsed").asBoolean());assertEquals(f.get("evidence"),d.get("evidence"));verify(model,never()).explain(any());}
        finally {c.close();}
    }
}
