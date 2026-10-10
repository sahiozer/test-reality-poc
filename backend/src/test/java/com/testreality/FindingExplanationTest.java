package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import java.net.InetSocketAddress;
import java.net.http.HttpTimeoutException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class FindingExplanationTest {
    final ObjectMapper mapper = new ObjectMapper();
    JsonNode cases() throws Exception { return mapper.readTree(getClass().getResourceAsStream("/explanation-quality.json")); }
    JsonNode finding() throws Exception { return cases().get(0).get("finding"); }
    String observation(ExplanationInput i) { return "PROD ortamında " + i.subject() + " için " + i.prodText() + " görülüyor. TEST ortamında " + i.testText() + " görülüyor."; }
    String response(ExplanationInput input) {
        var body=mapper.createObjectNode();body.put("done",true);body.put("done_reason","stop");
        body.put("response",mapper.createObjectNode().put("observation",observation(input)).toString()); return body.toString();
    }
    @Test void exactMappingAndSafeTemplatesForAllNineCases() throws Exception {
        assertEquals(9,cases().size());
        for (JsonNode c: cases()) {
            var f=c.get("finding");var before=f.deepCopy();var i=ExplanationInput.from(f,mapper);
            assertEquals(f.get("evidence"),i.evidence().get("sourceEvidence"));
            assertEquals(f.get("prod_value"),i.evidence().get("prodValue"));
            assertEquals(f.get("test_value"),i.evidence().get("testValue"));
            if(f.path("evidence").has("features")) {
                var s=i.evidence().get("state");var e=f.path("evidence").get("features");
                assertEquals(e.get("customer_type"),s.get("customerType"));assertEquals(e.get("account_count_bucket"),s.get("activeAccountBucket"));
                for (var pair: new String[][]{{"has_fx_account","hasFxAccount"},{"has_active_loan","hasActiveLoan"},{"has_active_card","hasActiveCard"},{"has_blocked_account","hasBlockedAccount"}}) assertEquals(e.get(pair[0]),s.get(pair[1]));
            }
            String text=new TemplateFindingExplanationService().explain(i);
            assertTrue(text.contains(i.prodText()));assertTrue(text.contains(i.testText()));assertTrue(text.split("\\s+").length<=100);
            if(c.path("name").asText().equals("health-no-configured-rule")) {assertTrue(text.contains("incelemeye aday"));assertFalse(text.contains("geçersiz"));}
            if(c.path("name").asText().equals("health-explicit-rule")) assertTrue(text.contains("Tanımlı iş kuralına göre"));
            OllamaFindingExplanationService.validate(observation(i),i);
            String constrained="PROD ortamında "+i.subject()+" için "+i.prodText()+" görülüyor. TEST ortamında "+i.testText()+" bulunuyor.";
            assertTrue(java.util.regex.Pattern.matches(OllamaFindingExplanationService.observationPattern(i),constrained));
            assertFalse(java.util.regex.Pattern.matches(OllamaFindingExplanationService.observationPattern(i),constrained.replace("PROD ortamında","TEST ortamında")));
            assertEquals(before,f);
        }
    }
    @Test void exportRequestsForRemoteOnlyQualityValidation() throws Exception {
        var requests=mapper.createArrayNode();
        var ollama=new OllamaFindingExplanationService(mapper,"http://unused","qwen2.5:0.5b",60);
        for (JsonNode c:cases()) {
            var input=ExplanationInput.from(c.get("finding"),mapper);
            var item=requests.addObject();item.set("name",c.get("name"));item.set("source",c.get("source"));
            item.set("request",ollama.request(input,true));item.put("template",new TemplateFindingExplanationService().explain(input));
        }
        mapper.writerWithDefaultPrettyPrinter().writeValue(new java.io.File("target/explanation-requests.json"),requests);
    }
    @Test @EnabledIfEnvironmentVariable(named="OLLAMA_QUALITY_RESULTS",matches=".+")
    void validateActualRemoteModelResponses() throws Exception {
        var results=mapper.readTree(new java.io.File(System.getenv("OLLAMA_QUALITY_RESULTS")));
        assertEquals(9,results.size());
        for (int index=0;index<9;index++) {
            var input=ExplanationInput.from(cases().get(index).get("finding"),mapper);
            var output=mapper.readTree(results.get(index).path("response").asText());
            OllamaFindingExplanationService.validate(output.path("observation").asText(),input);
            assertEquals("stop",results.get(index).path("done_reason").asText());
            String finalText=output.path("observation").asText()+" "+input.assessmentText();
            assertTrue(finalText.split("\\s+").length<=100);
        }
    }
    @Test void happyPathUsesOnlyMappedEvidenceAndDoesNotMutateMetrics() throws Exception {
        JsonNode f=finding(), before=f.deepCopy();var input=ExplanationInput.from(f,mapper);
        AtomicReference<JsonNode> received=new AtomicReference<>();
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/api/generate",exchange->{
            received.set(mapper.readTree(exchange.getRequestBody()));
            byte[] bytes=response(input).getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });server.start();
        try {
            String text=adapter(server,3).explain(input);
            assertEquals(observation(input)+" "+input.assessmentText(),text);
            assertEquals(adapter(server,3).modelInput(input),mapper.readTree(received.get().get("prompt").asText()));
            var passed=mapper.readTree(received.get().get("prompt").asText());
            assertEquals(input.evidence().get("state"),passed.get("state"));
            assertEquals(input.evidence().get("prod"),passed.get("prod"));
            assertEquals(input.evidence().get("test"),passed.get("test"));
            assertEquals(2048,received.get().path("options").path("num_ctx").asInt());
            assertEquals(64,received.get().path("options").path("num_batch").asInt());
            assertEquals(0,received.get().path("options").path("num_gpu").asInt());
            assertEquals(OllamaFindingExplanationService.observationPattern(input),received.get().path("format").path("properties").path("observation").path("pattern").asText());
            assertEquals(before,f);
        } finally {server.stop(0);}
    }
    OllamaFindingExplanationService adapter(HttpServer s,long seconds) {
        return new OllamaFindingExplanationService(mapper,"http://127.0.0.1:"+s.getAddress().getPort(),"test-model",seconds);
    }
    @Test void timeoutIsBounded() throws Exception {
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/api/generate",e->{try{Thread.sleep(1800);}catch(InterruptedException ignored){}e.close();});server.start();
        try {assertThrows(HttpTimeoutException.class,()->adapter(server,1).explain(ExplanationInput.from(finding(),mapper)));}
        finally {server.stop(0);}
    }
    @Test void unavailableAndMalformedResponsesAreRejected() throws Exception {
        var input=ExplanationInput.from(finding(),mapper);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.start();
        var firstServer=server;
        try {assertThrows(Exception.class,()->adapter(firstServer,2).explain(input));}finally{firstServer.stop(0);}
        assertThrows(Exception.class,()->adapter(firstServer,2).explain(input));
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/api/generate",e->{byte[] body="{\"done\":true,\"done_reason\":\"stop\",\"response\":\"not JSON\"}".getBytes();e.sendResponseHeaders(200,body.length);e.getResponseBody().write(body);e.close();});server.start();
        try {var running=server;assertThrows(Exception.class,()->adapter(running,2).explain(input));}finally{server.stop(0);}
    }
    @Test void inventedNumbersRulesWrongEnvironmentAndLostAttributesAreRejected() throws Exception {
        var i=ExplanationInput.from(finding(),mapper);String valid=observation(i);
        for(String bad:new String[]{valid.replace(i.prodText(),"999999 müşteri"),valid.replace("PROD","TEST"),valid.replace(i.subject(),"müşteriler"),valid.replace("görülüyor","risk oluşturuyor"),valid.replace("görülüyor","geçersiz"),valid+" 99."}) assertThrows(IllegalArgumentException.class,()->OllamaFindingExplanationService.validate(bad,i));
    }
    @Test void lazyCachePendingGeneratedAndEvidenceInvalidation() throws Exception {
        var adapter=mock(OllamaFindingExplanationService.class);var template=new TemplateFindingExplanationService();
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        when(adapter.explain(any())).thenAnswer(call->{entered.countDown();release.await(2,TimeUnit.SECONDS);return "generated";});
        try(varClose c=new varClose(new FindingExplanationCoordinator(mapper,template,adapter,true))) {
            var f=finding();var before=f.deepCopy();var first=c.value.detail(f);
            assertEquals("PENDING",first.path("aiExplanationStatus").asText());assertTrue(entered.await(1,TimeUnit.SECONDS));
            assertEquals("PENDING",c.value.detail(f).path("aiExplanationStatus").asText());
            release.countDown();awaitStatus(c.value,f,"GENERATED");verify(adapter,times(1)).explain(any());assertEquals(before,f);
            ObjectNode changed=f.deepCopy();((ObjectNode)changed.get("evidence")).put("prod_count",987);
            assertEquals("PENDING",c.value.detail(changed).path("aiExplanationStatus").asText());awaitStatus(c.value,changed,"GENERATED");verify(adapter,times(2)).explain(any());
        }
    }
    @Test void allAdapterFailuresFallBackWithoutRetryOrMetricMutation() throws Exception {
        for(Exception failure:new Exception[]{new HttpTimeoutException("timeout"),new java.net.ConnectException("unavailable"),new IllegalArgumentException("malformed")}) {
            var adapter=mock(OllamaFindingExplanationService.class);when(adapter.explain(any())).thenThrow(failure);
            try(varClose c=new varClose(new FindingExplanationCoordinator(mapper,new TemplateFindingExplanationService(),adapter,true))) {
                var f=finding();var before=f.deepCopy();c.value.detail(f);awaitStatus(c.value,f,"FALLBACK");
                assertEquals(c.value.detail(f).path("deterministicSummary"),c.value.detail(f).path("aiExplanation"));assertEquals(before,f);
                verify(adapter,times(1)).explain(any());
            }
        }
    }
    @Test void disabledAndBusyWorkersReturnImmediateFallback() throws Exception {
        var adapter=mock(OllamaFindingExplanationService.class);
        try(varClose c=new varClose(new FindingExplanationCoordinator(mapper,new TemplateFindingExplanationService(),adapter,false))) {
            assertEquals("FALLBACK",c.value.detail(finding()).path("aiExplanationStatus").asText());verifyNoInteractions(adapter);
        }
        CountDownLatch release=new CountDownLatch(1);when(adapter.explain(any())).thenAnswer(call->{release.await(2,TimeUnit.SECONDS);return "generated";});
        try(varClose c=new varClose(new FindingExplanationCoordinator(mapper,new TemplateFindingExplanationService(),adapter,true))) {
            c.value.detail(finding());assertEquals("FALLBACK",c.value.detail(cases().get(1).get("finding")).path("aiExplanationStatus").asText());release.countDown();
        }
    }
    void awaitStatus(FindingExplanationCoordinator c,JsonNode f,String status) throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        while(!status.equals(c.detail(f).path("aiExplanationStatus").asText()) && System.nanoTime()<deadline) Thread.sleep(10);
        assertEquals(status,c.detail(f).path("aiExplanationStatus").asText());
    }
    record varClose(FindingExplanationCoordinator value) implements AutoCloseable { public void close(){value.close();} }
}
