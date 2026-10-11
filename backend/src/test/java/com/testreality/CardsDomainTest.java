package com.testreality;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class CardsDomainTest {
    final ObjectMapper mapper=new ObjectMapper();
    final DomainContextRetriever retrieval=new DomainContextRetriever(mapper);
    ObjectNode health() throws Exception {return (ObjectNode)mapper.readTree("""
      {"domain":"CARDS","finding_type":"DATA_HEALTH_ISSUE","prod_value":0,"test_value":87,
      "evidence":{"metric":"closed_cards_with_available_limit","ruleId":"BR-CARD-001","ruleSource":"configured_business_rule","ruleText":"Kapalı statüdeki kartın kullanılabilir limiti sıfır olmalıdır."}}
      """);}
    @Test void cardHealthUsesCardRuleAndGlossaryOnly() throws Exception {
        var chunks=retrieval.retrieve(health());assertEquals("BR-CARD-001",chunks.get(0).path("id").asText());
        assertTrue(chunks.toString().contains("CARD_STATUS")||chunks.toString().contains("CARD_LIMIT"));
        assertFalse(chunks.toString().contains("BR-CUSTOMER-001"));
        var input=ExplanationInput.from(health(),mapper).withContext(chunks,retrieval.cardsVersion());
        assertEquals(87,input.evidence().path("violationCount").asInt());
        assertEquals("CARDS",input.evidence().path("domain").asText());
        assertTrue(input.contextReference().startsWith("BR-CARD-001:"));
        assertEquals("0 kart",input.prodText());assertEquals("87 kart",input.testText());
        var model=new OllamaFindingExplanationService(mapper,"http://unused","qwen2.5:0.5b",120);
        var prompt=model.modelInput(input);assertEquals("CARDS",prompt.path("domain").asText());assertFalse(prompt.has("ruleText"));
        assertEquals(1,model.request(input,false).path("options").path("num_thread").asInt());
    }
    @Test void wrongDomainAndWrongMetricCannotAttachCardRule() throws Exception {
        var f=health();f.remove("domain");assertTrue(retrieval.retrieve(f).isEmpty());
        f=health();((ObjectNode)f.get("evidence")).put("metric","closed_customers_with_active_accounts");assertTrue(retrieval.retrieve(f).isEmpty());
        f=health();f.put("finding_type","REPRESENTATION_GAP");
        for(var c:retrieval.retrieve(f))assertNotEquals("BUSINESS_RULE",c.path("sourceType").asText());
    }
    @Test void existingCustomerKnowledgeRemainsByteIdentical() throws Exception {
        assertEquals(15,retrieval.chunkCount());
        var cases=mapper.readTree(getClass().getResourceAsStream("/rag-quality.json"));
        for(var c:cases)if(!c.path("expectedChunk").isNull())assertEquals(c.path("expectedChunk").asText(),retrieval.retrieve(c.get("finding")).get(0).path("id").asText());
    }
    @Test void cardStateEvidenceMapsWithoutCustomerFields() throws Exception {
        var f=mapper.readTree("""
         {"domain":"CARDS","finding_type":"MISSING_STATE","title":"CREDIT · VIRTUAL · ACTIVE","prod_value":200,"test_value":0,
         "evidence":{"prod_count":200,"test_count":0,"prod_prevalence":0.2,"test_prevalence":0,"features":{"card_type":"CREDIT","physical_virtual":"VIRTUAL","card_status":"ACTIVE"}}}
         """);
        var input=ExplanationInput.from(f,mapper);assertEquals("VIRTUAL",input.evidence().path("state").path("physical_virtual").asText());
        assertFalse(input.evidence().path("state").has("customerType"));assertEquals("0 kart (%0,00)",input.testText());
        assertTrue(retrieval.retrieve(f).toString().contains("VIRTUAL_CARD"));
    }
}
