package com.testreality;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ApiController.class)
class ApiControllerTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @MockitoBean AnalysisService service;
    @MockitoBean FindingExplanationCoordinator explanations;

    @Test void overviewReturnsCalculatedSnapshot() throws Exception {
        when(service.overview()).thenReturn(mapper.readTree("{\"reality_gaps\":3,\"missing_data_states\":7,\"run_id\":\"calculated-run\"}"));
        mvc.perform(get("/api/overview")).andExpect(status().isOk())
            .andExpect(jsonPath("$.reality_gaps").value(3)).andExpect(jsonPath("$.run_id").value("calculated-run"));
        verify(service).overview();
    }
    @Test void findingsUsesPersistedLatestRun() throws Exception {
        when(service.latest()).thenReturn(mapper.readTree("{\"findings\":[{\"finding_id\":\"run:missing:state\",\"finding_type\":\"MISSING_STATE\"}]}"));
        mvc.perform(get("/api/findings")).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].finding_type").value("MISSING_STATE"));
    }
    @Test void findingDetailReturnsEvidence() throws Exception {
        when(service.finding("example")).thenReturn(mapper.readTree("{\"evidence\":{\"prod_count\":120,\"test_count\":0}}"));
        when(explanations.detail(any())).thenAnswer(invocation -> invocation.getArgument(0));
        mvc.perform(get("/api/findings/example")).andExpect(status().isOk())
            .andExpect(jsonPath("$.evidence.prod_count").value(120));
    }
    @Test void noRunIsExplicitConflict() throws Exception {
        when(service.overview()).thenThrow(new ResponseStatusException(HttpStatus.CONFLICT, "Run analysis to calculate results"));
        mvc.perform(get("/api/overview")).andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value("Run analysis to calculate results"));
    }
    @Test void unknownFindingIs404() throws Exception {
        when(service.finding("unknown")).thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND, "Finding not found"));
        mvc.perform(get("/api/findings/unknown")).andExpect(status().isNotFound());
    }
    @Test void runTriggersOrchestrator() throws Exception {
        when(service.run()).thenReturn(mapper.readTree("{\"run_id\":\"new-run\"}"));
        mvc.perform(post("/api/analysis/run")).andExpect(status().isOk()).andExpect(jsonPath("$.run_id").value("new-run"));
        verify(service).run();
    }
    @Test void cardsRoutesAreExplicitAndInvalidDomainIsRejected() throws Exception {
        when(service.overview(Domain.CARDS)).thenReturn(mapper.readTree("{\"environments\":[\"prod_cards\",\"test_cards\"]}"));
        mvc.perform(get("/api/overview?domain=CARDS")).andExpect(status().isOk()).andExpect(jsonPath("$.environments[0]").value("prod_cards"));
        verify(service).overview(Domain.CARDS);verify(service,never()).overview();
        mvc.perform(get("/api/overview?domain=UNKNOWN")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/domains")).andExpect(status().isOk()).andExpect(jsonPath("$[1].id").value("CARDS"));
    }
}
