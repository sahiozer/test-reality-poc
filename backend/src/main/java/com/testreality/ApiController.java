package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final AnalysisService service;
    private final FindingExplanationCoordinator explanations;
    public ApiController(AnalysisService service, FindingExplanationCoordinator explanations) { this.service = service; this.explanations = explanations; }
    @GetMapping("/domains") public Object domains() {
        return java.util.Arrays.stream(Domain.values()).map(d -> java.util.Map.ofEntries(java.util.Map.entry("id",d.name()),java.util.Map.entry("displayName",d.displayName),java.util.Map.entry("environments",d.environments),java.util.Map.entry("entityLabel",d.entityLabel),java.util.Map.entry("stateFeatureCount",d.stateFeatureCount),java.util.Map.entry("distribution",d.distribution),java.util.Map.entry("entityCountKey",d==Domain.CARDS?"card_count":"customer_count"),java.util.Map.entry("distributionTotalKey",d==Domain.CARDS?"entity_count":"customer_count"),java.util.Map.entry("distributionTitle",d==Domain.CARDS?"A different shape of card data":"A different shape of customer data"),java.util.Map.entry("distributionDescription",d==Domain.CARDS?"Active card distribution, calculated across card customers.":"Active account distribution, calculated across all customers."))).toList();
    }
    @PostMapping("/analysis/run") public JsonNode run(@RequestParam(defaultValue="CUSTOMER_LENDING") Domain domain) { return domain==Domain.CUSTOMER_LENDING?service.run():service.run(domain); }
    @GetMapping("/overview") public JsonNode overview(@RequestParam(defaultValue="CUSTOMER_LENDING") Domain domain) { return domain==Domain.CUSTOMER_LENDING?service.overview():service.overview(domain); }
    @GetMapping("/findings") public JsonNode findings(@RequestParam(defaultValue="CUSTOMER_LENDING") Domain domain) { return (domain==Domain.CUSTOMER_LENDING?service.latest():service.latest(domain)).path("findings"); }
    @GetMapping("/findings/{id}") public JsonNode finding(@PathVariable String id,@RequestParam(defaultValue="CUSTOMER_LENDING") Domain domain) { return explanations.detail(domain==Domain.CUSTOMER_LENDING?service.finding(id):service.finding(id,domain)); }
    @GetMapping("/states/coverage") public JsonNode coverage(@RequestParam(defaultValue="CUSTOMER_LENDING") Domain domain) { return (domain==Domain.CUSTOMER_LENDING?service.latest():service.latest(domain)).path("coverage"); }
    @GetMapping("/fingerprints") public JsonNode fingerprints(@RequestParam(defaultValue="CUSTOMER_LENDING") Domain domain) { return (domain==Domain.CUSTOMER_LENDING?service.latest():service.latest(domain)).path("fingerprints"); }
}
