package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

@Component
public class OllamaFindingExplanationService implements FindingExplanationService {
    public static final String SYSTEM = """
        Verilen Test Reality kanıtını iki kısa Türkçe gözlem cümlesiyle anlat.
        subject metnini ve sayıları değiştirmeden aynen kopyala. Hiçbir özelliği çıkarma.
        İlk cümlede PROD ve prodDisplay, ikinci cümlede TEST ve testDisplay bulunmalı.
        Biçim örneği: "PROD ortamında [subject] için [prodDisplay] görülüyor. TEST ortamında [testDisplay] görülüyor."
        Köşeli parantezleri verilen alan değerleriyle doldur; kendi Türkçe bağlaçlarını kullanabilirsin.
        Yeni bilgi, sayı, hesaplama, iş kuralı, değerlendirme, risk, neden veya öneri ekleme.
        observation en fazla 70 kelime; markdown ve selamlama yok. JSON döndür.
        Bağlam yoksa yalnızca {"observation":"iki cümle"} alanını döndür.
        Yalnızca verilen kanıtı ve retrievedContext içeriğini kullan. İş kuralı uydurma.
        İlgili iş kuralı yoksa ihtiyatlı kal; motor değerlendirmesinin ötesinde önem veya risk çıkarma.
        contextReference verilmişse ikinci JSON alanı contextReference içine aynen kopyala;
        bu kısa kaynak cümlesi ilgili kuralı veya tanımı açıkça belirtir. Yeni sayı veya neden ekleme.
        """;
    private final ObjectMapper mapper;
    private final HttpClient client;
    private final String url, model;
    private final Duration timeout;
    private static final Pattern NUMBER = Pattern.compile("\\d+(?:[.,-]\\d+)*");
    private static final Pattern UNSUPPORTED = Pattern.compile("risk|geçersiz|yetersiz|zorunlu|mutlaka|kesin|hatalı|bozuk|neden|sebep|ihlal|düzelt|onar|öner|gereki|gerekir|eksik|yok|bulunm|az temsil|kapsam", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    public OllamaFindingExplanationService(ObjectMapper mapper,
            @Value("${explanation.ollama-url:http://ollama:11434}") String url,
            @Value("${explanation.model:qwen2.5:0.5b}") String model,
            @Value("${explanation.timeout-seconds:120}") long seconds) {
        this.mapper = mapper; this.url = url; this.model = model;
        this.timeout = Duration.ofSeconds(seconds);
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    }
    public String modelName() { return model; }
    public JsonNode request(ExplanationInput input, boolean stream) {
        var request = mapper.createObjectNode();
        request.put("model",model); request.put("system",SYSTEM);
        request.put("prompt",modelInput(input).toString());
        request.put("stream",stream); request.put("keep_alive","2m");
        var schema = request.putObject("format"); schema.put("type","object");
        schema.putObject("properties").putObject("observation").put("type","string").put("pattern",observationPattern(input));
        schema.putArray("required").add("observation"); schema.put("additionalProperties",false);
        if (!input.contextReference().isBlank()) {
            ((com.fasterxml.jackson.databind.node.ObjectNode)schema.get("properties")).putObject("contextReference").put("type","string")
                    .putArray("enum").add(input.contextReference());
            ((com.fasterxml.jackson.databind.node.ArrayNode)schema.get("required")).add("contextReference");
        }
        var options = request.putObject("options");
        options.put("temperature",0); options.put("seed",20261010); options.put("num_ctx",2048);
        options.put("num_predict",224); options.put("num_batch",64); options.put("num_thread",1); options.put("num_gpu",0);
        return request;
    }
    public JsonNode modelInput(ExplanationInput input) {
        // Only the fields needed for phrasing. Full original evidence stays in the API contract.
        var compact=mapper.createObjectNode();
        for (String key : new String[]{"findingType","domain","cardStatus","availableLimitPredicate","violationCount","state","prod","test","prodValue","testValue","ageDifferenceDaysDisplay","ruleSource","ruleText","assessment","subject","prodDisplay","testDisplay","retrievedContext","contextReference","retrievedRuleSource","retrievedRuleId","knowledgeVersion"}) {
            if (input.evidence().has(key)) compact.set(key,input.evidence().get(key));
        }
        return compact;
    }
    public static String observationPattern(ExplanationInput input) {
        // Constrained surface generation: only supplied facts and equivalent neutral wording.
        // No finding-specific numbers or state attributes are hard-coded in this grammar.
        return "^(PROD ortamında|PROD'da) " + literal(input.subject()) + " için " + literal(input.prodText())
                + " (görülüyor|bulunuyor|tespit edildi)\\. (TEST ortamında|TEST'te) " + literal(input.testText())
                + " (görülüyor|bulunuyor|tespit edildi)\\.$";
    }
    private static String literal(String text) {
        StringBuilder escaped=new StringBuilder();
        for (char c:text.toCharArray()) { if ("\\.^$|?*+(){}[]".indexOf(c)>=0) escaped.append('\\'); escaped.append(c); }
        return escaped.toString();
    }
    @Override public String explain(ExplanationInput input) throws Exception {
        var http = HttpRequest.newBuilder(URI.create(url + "/api/generate")).timeout(timeout)
                .header("Content-Type","application/json")
                .POST(HttpRequest.BodyPublishers.ofString(request(input,false).toString())).build();
        var response = client.send(http,HttpResponse.BodyHandlers.ofString());
        if (response.statusCode()!=200 || response.body().length()>16384) throw new IllegalStateException("Ollama response unavailable");
        JsonNode body = mapper.readTree(response.body());
        if (!body.path("done").asBoolean() || !"stop".equals(body.path("done_reason").asText())) throw new IllegalStateException("Incomplete generation");
        JsonNode output = mapper.readTree(body.path("response").asText());
        boolean context = !input.contextReference().isBlank();
        if (output.size()!=(context ? 2 : 1) || !output.path("observation").isTextual()
                || (context && !input.contextReference().equals(output.path("contextReference").asText()))) throw new IllegalStateException("Invalid output contract");
        String observation = output.path("observation").asText().trim();
        validate(observation,input);
        return observation + (context ? " " + output.get("contextReference").asText() : "") + " " + input.assessmentText();
    }
    public static void validate(String text, ExplanationInput input) {
        if (!Pattern.matches(observationPattern(input),text)) throw new IllegalArgumentException("Observation outside evidence grammar");
        if (text.length()>900 || text.split("\\s+").length>70 || text.contains("\n") || text.contains("*") || text.contains("#")
                || !text.contains("PROD") || !text.contains("TEST") || !text.contains(input.subject())
                || !text.contains(input.prodText()) || !text.contains(input.testText())
                || UNSUPPORTED.matcher(text.toLowerCase(Locale.ROOT)).find()) throw new IllegalArgumentException("Unsupported wording or missing evidence");
        long sentences = text.chars().filter(c -> c=='.' || c=='!' || c=='?').count();
        if (sentences!=2 || !text.endsWith(".")) throw new IllegalArgumentException("Expected two observation sentences");
        Set<String> allowed = new HashSet<>(input.requiredValues());
        var numbers = NUMBER.matcher(text);
        while (numbers.find()) if (!allowed.contains(numbers.group())) throw new IllegalArgumentException("Invented number");
        // Freshness gap days are in the deterministic assessment appended below, not the observation.
        // Prevent swapped environments even when both values occur somewhere in the response.
        String[] parts = text.split("\\.");
        if (!parts[0].contains("PROD") || !parts[0].contains(input.prodText())
                || !parts[1].contains("TEST") || !parts[1].contains(input.testText())) throw new IllegalArgumentException("Environment/value mismatch");
    }
}
