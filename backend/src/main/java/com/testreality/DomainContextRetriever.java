package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;

/** Immutable local BM25 index; structured applicability gates precede lexical scoring. */
@Component
public class DomainContextRetriever {
    private static final Pattern TOKEN = Pattern.compile("[\\p{L}\\p{N}_]+", Pattern.UNICODE_CHARACTER_CLASS);
    private record Entry(JsonNode chunk, Map<String,Integer> frequencies, int length) {}
    private final ObjectMapper mapper;
    private final List<Entry> entries = new ArrayList<>();
    private final Map<String,Integer> documentFrequency = new HashMap<>();
    private double averageLength;
    private String version = "unavailable";
    private DomainContextRetriever cards;
    @org.springframework.beans.factory.annotation.Autowired
    public DomainContextRetriever(ObjectMapper mapper) {
        this(mapper,"/domain-knowledge/knowledge.json");
        cards=new DomainContextRetriever(mapper,"/domain-knowledge/cards.json");
    }
    private DomainContextRetriever(ObjectMapper mapper,String resource) {
        this.mapper = mapper;
        try (var stream = getClass().getResourceAsStream(resource)) {
            if (stream == null) return;
            byte[] bytes = stream.readAllBytes();
            var corpus = mapper.readTree(bytes);
            if (!corpus.path("chunks").isArray() || corpus.path("chunks").size()>20) return;
            var ids = new HashSet<String>();
            for (var chunk : corpus.get("chunks")) {
                if (!ids.add(chunk.path("id").asText()) || chunk.path("id").asText().isBlank()
                        || !Set.of("GLOSSARY","BUSINESS_RULE","DOMAIN_DEFINITION").contains(chunk.path("sourceType").asText())
                        || chunk.path("content").asText().isBlank() || chunk.path("content").asText().length()>1000
                        || !chunk.path("findingTypes").isArray()) throw new IllegalArgumentException("Invalid curated corpus");
                var tokens = tokens(chunk.path("title").asText()+" "+chunk.path("content").asText()+" "+chunk.path("keywords").asText());
                var frequencies = new HashMap<String,Integer>();
                for (String token : tokens) frequencies.merge(token,1,Integer::sum);
                entries.add(new Entry(chunk.deepCopy(),Map.copyOf(frequencies),tokens.size()));
                frequencies.keySet().forEach(token -> documentFrequency.merge(token,1,Integer::sum));
            }
            averageLength = entries.stream().mapToInt(Entry::length).average().orElse(1);
            version = corpus.path("version").asText()+":"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (Exception unavailable) {
            entries.clear(); documentFrequency.clear();
            org.slf4j.LoggerFactory.getLogger(getClass()).warn("Domain knowledge unavailable; using evidence-only explanations");
        }
    }
    private static List<String> tokens(String text) {
        var result = new ArrayList<String>();
        var matcher = TOKEN.matcher(text.toLowerCase(Locale.ROOT));
        while (matcher.find()) result.add(matcher.group());
        return result;
    }
    public String version() { return version; }
    public int chunkCount() { return entries.size(); }
    public String cardsVersion() { return cards.version(); }
    public ArrayNode retrieve(JsonNode finding) {
        if (cards!=null && "CARDS".equals(finding.path("domain").asText())) return cards.retrieve(finding);
        boolean isCards="CARDS".equals(finding.path("domain").asText());
        String type = finding.path("finding_type").asText();
        var evidence = finding.path("evidence");
        String query = switch (type) {
            case "DATA_HEALTH_ISSUE" -> "closed_customers_with_active_accounts".equals(evidence.path("metric").asText())
                    ? "CLOSED customer active account customer status business rule data health customer/account relationship" : "";
            case "REPRESENTATION_GAP" -> "REPRESENTATION_GAP representation gap PROD reference definition " + (evidence.has("features") ? "underrepresented state" : "multi_account_rate");
            case "MISSING_STATE" -> "MISSING_STATE missing state zero test_count coverage definition";
            case "FRESHNESS_GAP" -> "FRESHNESS_GAP freshness business timestamps prod_latest test_latest age_difference_days";
            case "HEALTHY_STATE" -> "PROD reference fingerprint";
            default -> "";
        };
        if (isCards) query = switch(type) {
            case "DATA_HEALTH_ISSUE" -> "closed_cards_with_available_limit".equals(evidence.path("metric").asText()) ? "BR-CARD-001 CLOSED card status available limit CARD_LIMIT CARD_STATUS business rule" : "";
            case "REPRESENTATION_GAP" -> "REPRESENTATION_GAP PROD reference representation gap multi_active_card_rate";
            case "MISSING_STATE" -> "MISSING_STATE coverage PHYSICAL_CARD VIRTUAL_CARD physical_virtual missing state";
            case "FRESHNESS_GAP" -> "FRESHNESS_GAP freshness business timestamps";
            default -> "";
        };
        if (!isCards && evidence.path("features").isObject()) {
            for (var field : List.of("customer_type","account_count_bucket","has_fx_account","has_active_loan","has_active_card","has_blocked_account")) {
                if (evidence.get("features").has(field)) query += " " + field;
            }
        }
        ArrayNode result = mapper.createArrayNode();
        if (query.isBlank() || entries.isEmpty()) return result;
        Set<String> terms = new TreeSet<>(tokens(query));
        record Scored(Entry entry,double score) {}
        var scored = new ArrayList<Scored>();
        for (Entry entry : entries) {
            JsonNode chunk = entry.chunk();
            boolean applicable = false;
            for (var allowed : chunk.get("findingTypes")) if (type.equals(allowed.asText())) applicable = true;
            if (!applicable) continue;
            // A lexical match cannot grant a business rule to another metric or finding type.
            if ("BUSINESS_RULE".equals(chunk.path("sourceType").asText()) &&
                    !(type.equals("DATA_HEALTH_ISSUE") && chunk.path("appliesToMetric").asText().equals(evidence.path("metric").asText()))) continue;
            double score = 0;
            for (String term : terms) {
                int tf = entry.frequencies().getOrDefault(term,0);
                if (tf==0) continue;
                int df = documentFrequency.getOrDefault(term,0);
                double idf = Math.log(1+(entries.size()-df+0.5)/(df+0.5));
                score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * entry.length()/averageLength));
            }
            if (score>0) scored.add(new Scored(entry,score));
        }
        scored.sort(Comparator.comparingDouble(Scored::score).reversed().thenComparing(s -> s.entry().chunk().path("id").asText()));
        for (Scored match : scored.stream().limit(3).toList()) {
            var chunk = result.addObject();
            for (String field : List.of("id","title","content","sourceType")) chunk.set(field,match.entry().chunk().get(field).deepCopy());
            chunk.put("relevanceScore",match.score());
        }
        return result;
    }
}
