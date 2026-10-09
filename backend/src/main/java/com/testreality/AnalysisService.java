package com.testreality;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class AnalysisService {
    private static final long LOCK_ID = 20261011L;
    private final JdbcTemplate jdbc;
    private final DataSource dataSource;
    private final ObjectMapper mapper;
    private final RestClient analysis;
    private final TransactionTemplate transaction;

    public AnalysisService(JdbcTemplate jdbc, DataSource dataSource, ObjectMapper mapper,
                           TransactionTemplate transaction, @Value("${analysis.url}") String url) {
        this.jdbc = jdbc;
        this.dataSource = dataSource;
        this.mapper = mapper;
        this.transaction = transaction;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(180));
        this.analysis = RestClient.builder().baseUrl(url).requestFactory(factory).build();
    }

    public JsonNode run() {
        UUID id = UUID.randomUUID();
        try (Connection lockConnection = dataSource.getConnection()) {
            boolean locked;
            try (var statement = lockConnection.prepareStatement("SELECT pg_try_advisory_lock(?)")) {
                statement.setLong(1, LOCK_ID);
                try (var result = statement.executeQuery()) { result.next(); locked = result.getBoolean(1); }
            }
            if (!locked) throw new ResponseStatusException(HttpStatus.CONFLICT, "An analysis is already running");
            try {
                // A lost connection releases the lock. Any previous RUNNING row is then abandoned.
                jdbc.update("UPDATE metadata.analysis_run SET status='FAILED', completed_at=now(), error_message='Interrupted before completion' WHERE status='RUNNING'");
                jdbc.update("INSERT INTO metadata.analysis_run(run_id,status) VALUES (?,'RUNNING')", id);
                JsonNode result = analysis.post().uri("/analysis/run").body(Map.of("run_id", id.toString()))
                        .retrieve().body(JsonNode.class);
                if (result == null || !id.toString().equals(result.path("run_id").asText())
                        || !result.path("findings").isArray() || !result.path("fingerprints").isArray()
                        || !result.path("overview").isObject() || !result.path("coverage").isObject()) {
                    throw new IllegalStateException("Invalid analysis response");
                }
                transaction.executeWithoutResult(status -> {
                    for (JsonNode finding : result.path("findings")) {
                        jdbc.update("INSERT INTO metadata.finding(finding_id,run_id,finding) VALUES (?,?,?::jsonb)",
                                finding.path("finding_id").asText(), id, finding.toString());
                    }
                    jdbc.update("UPDATE metadata.analysis_run SET status='SUCCEEDED', completed_at=now(), result=?::jsonb WHERE run_id=?",
                            result.toString(), id);
                });
                return result;
            } catch (Exception error) {
                jdbc.update("UPDATE metadata.analysis_run SET status='FAILED', completed_at=now(), error_message='Analysis failed; no result published' WHERE run_id=?", id);
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Analysis failed; no result published", error);
            } finally {
                try (var statement = lockConnection.prepareStatement("SELECT pg_advisory_unlock(?)")) {
                    statement.setLong(1, LOCK_ID);
                    statement.execute();
                }
            }
        } catch (SQLException error) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Database unavailable", error);
        }
    }

    public JsonNode latest() {
        List<String> rows = jdbc.query("SELECT result::text FROM metadata.analysis_run WHERE status='SUCCEEDED' ORDER BY completed_at DESC LIMIT 1",
                (rs, row) -> rs.getString(1));
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT, "Run analysis to calculate results");
        return parse(rows.getFirst());
    }

    public JsonNode overview() {
        JsonNode latest = latest();
        ObjectNode result = latest.path("overview").deepCopy();
        result.set("run_id", latest.path("run_id"));
        result.set("generated_at", latest.path("generated_at"));
        result.set("dataset", latest.path("dataset"));
        var attempts = jdbc.query("SELECT run_id::text, status, error_message FROM metadata.analysis_run ORDER BY started_at DESC LIMIT 1",
                (rs, row) -> {
                    ObjectNode attempt = mapper.createObjectNode();
                    attempt.put("run_id", rs.getString(1));
                    attempt.put("status", rs.getString(2));
                    attempt.put("error_message", rs.getString(3));
                    return attempt;
                });
        if (!attempts.isEmpty()) result.set("latest_attempt", attempts.getFirst());
        return result;
    }

    public JsonNode finding(String id) {
        var rows = jdbc.query("SELECT finding::text FROM metadata.finding WHERE finding_id=?", (rs, row) -> rs.getString(1), id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Finding not found");
        return parse(rows.getFirst());
    }

    private JsonNode parse(String value) {
        try { return mapper.readTree(value); }
        catch (Exception error) { throw new IllegalStateException("Stored analysis result is invalid", error); }
    }
}
