package com.testreality;

import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcExplanationRepository implements ExplanationRepository {
    private final JdbcTemplate jdbc;
    public JdbcExplanationRepository(JdbcTemplate jdbc) {
        this.jdbc=jdbc;
        new ResourceDatabasePopulator(new ClassPathResource("explanations.sql")).execute(jdbc.getDataSource());
    }
    @Override public Result find(String key) {
        var rows=jdbc.query("SELECT explanation,status,generation_latency_ms FROM metadata.finding_explanation WHERE cache_key=?",
                (rs,row)->new Result(rs.getString(1),rs.getString(2),(Double)rs.getObject(3)),key);
        return rows.isEmpty()?null:rows.getFirst();
    }
    @Override public boolean createPending(String key,String findingId,String evidenceHash,String contextHash,String model,String fallback) {
        return jdbc.update("INSERT INTO metadata.finding_explanation(cache_key,finding_id,evidence_hash,context_hash,model,status,fallback_text) VALUES (?,?,?,?,?,'PENDING',?) ON CONFLICT(cache_key) DO NOTHING",
                key,findingId,evidenceHash,contextHash,model,fallback)==1;
    }
    @Override public void complete(String key,String text,String status,double latency) {
        if (!status.equals("GENERATED") && !status.equals("FALLBACK")) throw new IllegalArgumentException("Invalid terminal status");
        jdbc.update("UPDATE metadata.finding_explanation SET explanation=?,status=?,generation_latency_ms=?,updated_at=now() WHERE cache_key=? AND status='PENDING'",
                text,status,latency,key);
    }
}
