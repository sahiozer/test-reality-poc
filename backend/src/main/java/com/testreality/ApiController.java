package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final AnalysisService service;
    public ApiController(AnalysisService service) { this.service = service; }
    @PostMapping("/analysis/run") public JsonNode run() { return service.run(); }
    @GetMapping("/overview") public JsonNode overview() { return service.overview(); }
    @GetMapping("/findings") public JsonNode findings() { return service.latest().path("findings"); }
    @GetMapping("/findings/{id}") public JsonNode finding(@PathVariable String id) { return service.finding(id); }
    @GetMapping("/states/coverage") public JsonNode coverage() { return service.latest().path("coverage"); }
    @GetMapping("/fingerprints") public JsonNode fingerprints() { return service.latest().path("fingerprints"); }
}
