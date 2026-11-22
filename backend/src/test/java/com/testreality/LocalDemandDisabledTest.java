package com.testreality;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@WebMvcTest(LocalDemandController.class)
class LocalDemandDisabledTest {
 @Autowired MockMvc mvc;
 @Test void localMutationEndpointsAbsentByDefault() throws Exception {
  mvc.perform(get("/api/test-demand")).andExpect(status().isNotFound());
  mvc.perform(post("/api/test-demand/apply").contentType("application/json").content("{}")).andExpect(status().isNotFound());
 }
}
