package com.testreality;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class LocalDemandControllerTest {
    @Test void proxiesDomainAndPreservesConflictWithoutAcceptingSQLRoute() throws Exception {
        var path=new AtomicReference<String>();var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange->{path.set(exchange.getRequestURI().toString());byte[] body="{\"detail\":\"Stale preview\"}".getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(409,body.length);exchange.getResponseBody().write(body);exchange.close();});server.start();
        try {
            var mvc=MockMvcBuilders.standaloneSetup(new LocalDemandController("http://127.0.0.1:"+server.getAddress().getPort(),new ObjectMapper())).setControllerAdvice(new ApiErrors()).build();
            mvc.perform(get("/api/test-demand?domain=CARDS")).andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("Stale preview"));
            assertThat(path.get()).isEqualTo("/local-demand/status?domain=CARDS");path.set(null);
            mvc.perform(post("/api/test-demand/sql").contentType("application/json").content("{\"sql\":\"DELETE FROM prod_cards.card\"}")).andExpect(status().isNotFound());assertThat(path.get()).isNull();
            mvc.perform(get("/api/test-demand?domain=prod_snapshot")).andExpect(status().isBadRequest());assertThat(path.get()).isNull();
        } finally {server.stop(0);}
    }
}
