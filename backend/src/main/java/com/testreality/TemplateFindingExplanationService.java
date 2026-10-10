package com.testreality;

import org.springframework.stereotype.Component;

@Component
public class TemplateFindingExplanationService implements FindingExplanationService {
    @Override public String explain(ExplanationInput input) {
        return "PROD: " + input.prodText() + "; TEST: " + input.testText() + " — " + input.subject() + ". " + input.assessmentText();
    }
}
