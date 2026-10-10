package com.testreality;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
/** Test double shared across coordinator instances to exercise durable lifecycle semantics. */
final class MemoryExplanations implements ExplanationRepository {
    final ConcurrentHashMap<String,Result> rows=new ConcurrentHashMap<>();
    final AtomicInteger creations=new AtomicInteger();
    public Result find(String key){return rows.get(key);}
    public boolean createPending(String key,String id,String evidenceHash,String contextHash,String model,String fallback){
        boolean created=rows.putIfAbsent(key,new Result(null,"PENDING",null))==null;
        if(created)creations.incrementAndGet();return created;
    }
    public void complete(String key,String text,String status,double latency){
        rows.computeIfPresent(key,(k,old)->old.status().equals("PENDING")?new Result(text,status,latency):old);
    }
}
