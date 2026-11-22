package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/test-demand")
@ConditionalOnProperty(name="local.repair-enabled",havingValue="true")
public class LocalDemandController {
    private final RestClient analysis;
    private final ObjectMapper mapper;
    public LocalDemandController(@Value("${analysis.url}") String url,ObjectMapper mapper) {
        analysis=RestClient.builder().baseUrl(url).build(); this.mapper=mapper;
    }
    @GetMapping public JsonNode status(@RequestParam(defaultValue="CUSTOMER_LENDING") Domain domain,@RequestParam(required=false) String metric_key) {
        try {return analysis.get().uri(builder->builder.path("/local-demand/status").queryParam("domain",domain.name()).queryParamIfPresent("metric_key",java.util.Optional.ofNullable(metric_key)).build()).retrieve().body(JsonNode.class);}
        catch(RestClientResponseException e) {throw error(e);}
    }
    @GetMapping("/findings") public JsonNode findings(@RequestParam(defaultValue="CUSTOMER_LENDING") Domain domain) {
        try {return analysis.get().uri("/local-demand/findings?domain="+domain.name()).retrieve().body(JsonNode.class);}
        catch(RestClientResponseException e) {throw error(e);}
    }
    @PostMapping("/{action:save|preview|apply|inject|health-preview|health-apply}") public JsonNode action(@PathVariable String action,@RequestBody JsonNode body) {
        try {return analysis.post().uri("/local-demand/"+action).body(body).retrieve().body(JsonNode.class);}
        catch(RestClientResponseException e) {throw error(e);}
    }
    private ResponseStatusException error(RestClientResponseException e) {
        String message="Invalid local demand/repair request";
        try {var detail=mapper.readTree(e.getResponseBodyAsString()).path("detail");if(detail.isTextual())message=detail.asText();}catch(Exception ignored) {}
        return new ResponseStatusException(e.getStatusCode().value()==409?HttpStatus.CONFLICT:HttpStatus.BAD_REQUEST,message);
    }
}
