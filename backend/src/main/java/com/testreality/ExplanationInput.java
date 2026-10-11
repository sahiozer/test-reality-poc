package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/** Only engine evidence enters this contract. Display formatting is not metric calculation. */
public record ExplanationInput(ObjectNode evidence, String subject, String assessmentText,
                               List<String> requiredValues, String prodText, String testText) {
    public ExplanationInput withContext(JsonNode chunks, String knowledgeVersion) {
        ObjectNode enriched = evidence.deepCopy();
        enriched.set("retrievedContext", chunks.deepCopy());
        enriched.put("knowledgeVersion", knowledgeVersion);
        String reference = "";
        String contextualAssessment = assessmentText;
        if (!chunks.isEmpty()) {
            JsonNode first = chunks.get(0);
            reference = first.path("sourceType").asText().equals("BUSINESS_RULE")
                    ? first.path("id").asText()+": "+first.path("content").asText()
                    : "Test Reality tanımı: "+first.path("content").asText();
            if (first.path("sourceType").asText().equals("BUSINESS_RULE")) {
                enriched.put("retrievedRuleSource","curated_demo_knowledge");
                enriched.put("retrievedRuleId",first.path("id").asText());
                contextualAssessment = "Bu kayıtlar, getirilen demo iş kuralı bağlamında veri sağlığı incelemesine adaydır.";
            }
        }
        enriched.put("contextReference",reference);
        enriched.put("assessmentText",contextualAssessment);
        return new ExplanationInput(enriched,subject,contextualAssessment,requiredValues,prodText,testText);
    }
    public String contextReference() { return evidence.path("contextReference").asText(); }
    public static ExplanationInput from(JsonNode finding, ObjectMapper mapper) {
        String type = finding.path("finding_type").asText();
        boolean cards="CARDS".equals(finding.path("domain").asText());
        JsonNode e = finding.path("evidence");
        ObjectNode contract = mapper.createObjectNode();
        contract.put("contractVersion", "1");
        contract.put("findingType", type);
        if (cards) contract.put("domain","CARDS");
        contract.set("sourceEvidence", e.deepCopy());
        contract.set("prodValue", finding.path("prod_value").deepCopy());
        contract.set("testValue", finding.path("test_value").deepCopy());
        List<String> values = new ArrayList<>();
        String subject, prod, test, assessment;
        switch (type) {
            case "MISSING_STATE", "REPRESENTATION_GAP", "HEALTHY_STATE" -> {
                if (cards && e.has("features")) {
                    contract.set("state",e.get("features").deepCopy());
                    subject = "kart veri durumu: " + finding.path("title").asText();
                } else if (cards && "multi_active_card_rate".equals(e.path("metric").asText())) {
                    subject="birden fazla aktif kartı olan müşteriler";
                } else if (e.has("features")) {
                    JsonNode f = e.get("features");
                    ObjectNode state = contract.putObject("state");
                    state.set("customerType", f.path("customer_type"));
                    state.set("activeAccountBucket", f.path("account_count_bucket"));
                    state.set("hasFxAccount", f.path("has_fx_account"));
                    state.set("hasActiveLoan", f.path("has_active_loan"));
                    state.set("hasActiveCard", f.path("has_active_card"));
                    state.set("hasBlockedAccount", f.path("has_blocked_account"));
                    String bucket = f.path("account_count_bucket").asText();
                    String accounts = switch (bucket) { case "0" -> "aktif hesabı olmayan"; case "1" -> "tek aktif hesabı olan"; case "2+" -> "birden fazla aktif hesabı olan"; default -> throw new IllegalArgumentException("Unknown account bucket"); };
                    String customer = switch (f.path("customer_type").asText()) { case "RETAIL" -> "bireysel müşteriler"; case "CORPORATE" -> "kurumsal müşteriler"; default -> throw new IllegalArgumentException("Unknown customer type"); };
                    subject = accounts + ", " + attribute(f,"has_fx_account","döviz hesabı") + ", "
                        + attribute(f,"has_active_loan","aktif kredisi") + ", " + attribute(f,"has_active_card","aktif kartı")
                        + ", " + attribute(f,"has_blocked_account","blokeli hesabı") + " " + customer;
                } else if ("multi_account_rate".equals(e.path("metric").asText())) {
                    subject = "birden fazla aktif hesabı olan müşteriler";
                } else throw new IllegalArgumentException("Unsupported evidence");
                String pc = exact(e,"prod_count"), tc = exact(e,"test_count");
                JsonNode pp = e.has("prod_prevalence") ? e.get("prod_prevalence") : finding.path("prod_value");
                JsonNode tp = e.has("test_prevalence") ? e.get("test_prevalence") : finding.path("test_value");
                String pPct = pct(pp), tPct = pct(tp);
                String unit=cards && e.has("features")?" kart":" müşteri";
                prod = pc + unit + " (%" + pPct + ")"; test = tc + unit + " (%" + tPct + ")";
                values.addAll(List.of(pc, pPct, tc, tPct));
                ObjectNode p = contract.putObject("prod"); p.set("count",e.get("prod_count")); p.set("prevalence", pp); p.put("prevalencePctDisplay",pPct);
                ObjectNode t = contract.putObject("test"); t.set("count",e.get("test_count")); t.set("prevalence", tp); t.put("prevalencePctDisplay",tPct);
                String status = type.equals("MISSING_STATE") ? "MISSING" : type.equals("HEALTHY_STATE") ? "REPRESENTED" : "UNDERREPRESENTED";
                contract.put("assessment", status);
                assessment = switch(status) {
                    case "MISSING" -> "Bu veri durumunun TEST ortamında karşılığı bulunmuyor; kapsam açısından incelenebilir.";
                    case "UNDERREPRESENTED" -> "Bu veri durumu TEST ortamında daha az temsil ediliyor; kapsam açısından incelenebilir.";
                    default -> "Bu veri durumu TEST ortamında temsil ediliyor; bu kanıt ek bir aksiyon gerektirmiyor.";
                };
            }
            case "DATA_HEALTH_ISSUE" -> {
                if (!(cards?"closed_cards_with_available_limit":"closed_customers_with_active_accounts").equals(e.path("metric").asText())) throw new IllegalArgumentException("Unsupported health metric");
                subject = cards?"kapalı kart statüsü ile pozitif kullanılabilir limit kombinasyonu":"kapalı müşteri statüsü ile aktif hesap kombinasyonu";
                if(cards) {contract.put("cardStatus","CLOSED");contract.put("availableLimitPredicate","> 0");contract.set("violationCount",finding.path("test_value"));}
                String pc = exact(finding,"prod_value"), tc = exact(finding,"test_value");
                values.addAll(List.of(pc, tc)); prod = pc + (cards?" kart":" müşteri"); test = tc + (cards?" kart":" müşteri");
                // A finding type/calculation predicate is NOT a configured business rule.
                boolean rule = "configured_business_rule".equals(e.path("ruleSource").asText()) && !e.path("ruleText").asText().isBlank();
                contract.put("ruleSource", rule ? "configured_business_rule" : "not_configured");
                if (rule && !cards) contract.set("ruleText",e.get("ruleText"));
                contract.put("assessment", rule ? "CONFIGURED_RULE_VIOLATION" : "REVIEW_CANDIDATE");
                assessment = rule ? "Tanımlı iş kuralına göre bu kombinasyon geçersiz kabul ediliyor." : "Tanımlı bir iş kuralı sunulmadığı için bu kombinasyon incelemeye adaydır.";
            }
            case "FRESHNESS_GAP" -> {
                subject = "son iş verisi tarihi";
                prod = e.path("prod_latest").asText().substring(0,10); test = e.path("test_latest").asText().substring(0,10);
                String days = exact(e,"age_difference_days");
                values.addAll(List.of(prod, test, days));
                contract.put("assessment","FRESHNESS_GAP");
                contract.put("ageDifferenceDaysDisplay",days);
                assessment = "TEST iş verisi tarihi PROD tarihinin " + days + " gün gerisinde; güncellik açısından incelenebilir.";
            }
            default -> throw new IllegalArgumentException("Unsupported finding type");
        }
        contract.put("subject",subject); contract.put("prodDisplay",prod); contract.put("testDisplay",test);
        contract.put("assessmentText",assessment);
        return new ExplanationInput(contract, subject, assessment, List.copyOf(values), prod, test);
    }
    private static String attribute(JsonNode f,String key,String noun) { return noun + (f.path(key).asBoolean() ? " olan" : " olmayan"); }
    private static String exact(JsonNode node,String key) {
        if (!node.path(key).isNumber()) throw new IllegalArgumentException("Missing number");
        return node.path(key).decimalValue().stripTrailingZeros().toPlainString().replace('.',',');
    }
    private static String pct(JsonNode fraction) {
        if (!fraction.isNumber()) throw new IllegalArgumentException("Missing prevalence");
        return fraction.decimalValue().multiply(BigDecimal.valueOf(100)).setScale(2,RoundingMode.HALF_UP).toPlainString().replace('.',',');
    }
}
