# ADR-003: Framework Selection - Spring Boot vs Quarkus

## Question

Should the SQS export processing service use **Spring Boot 3.x** or **Quarkus** as its application framework?

## Context

Following ADR-001 (Java 21+ with virtual threads) and ADR-002 (library selection), this document evaluates the two leading Java frameworks for building the AWS Fargate-based export processing service.

**Workload Characteristics (from ADR-001):**
- Long-running jobs (5 minutes to several hours)
- 100,000 events/day with 3-5x peak spikes
- Mixed I/O (downloads, DynamoDB, S3) and CPU (ZIP extraction)
- Container-based deployment on AWS Fargate
- Team has experience with both Spring and general Java

---

## Executive Summary

| Criterion | Spring Boot 3.x | Quarkus | Winner |
|-----------|-----------------|---------|--------|
| **Startup time (JVM)** | 2-5 seconds | 0.5-2 seconds | Quarkus |
| **Memory footprint** | Higher (~200-400MB) | Lower (~100-200MB) | Quarkus |
| **Virtual threads support** | ✅ Native (one property) | ✅ Explicit annotation | Spring Boot |
| **AWS SDK integration** | ✅ Spring Cloud AWS 3.x | ✅ Quarkiverse extensions | Tie |
| **Ecosystem maturity** | ✅ 10+ years | ⚠️ 5 years (since 2019) | Spring Boot |
| **Documentation & community** | ✅ Extensive | ⚠️ Growing | Spring Boot |
| **Learning curve** | ✅ Familiar to most Java devs | ⚠️ MicroProfile/CDI patterns | Spring Boot |
| **GraalVM native** | ✅ Supported | ✅ First-class | Quarkus |
| **Long-running process stability** | ✅ Battle-tested | ✅ Good | Spring Boot |
| **Developer productivity** | ✅ DevTools, extensive IDE support | ✅ Dev mode, live reload | Tie |

**Recommendation: Spring Boot 3.2+** for this specific workload.

---

## Detailed Analysis

### 1. Startup Time & Cold Start

| Metric | Spring Boot 3.x (JVM) | Quarkus (JVM) | Spring Boot (Native) | Quarkus (Native) |
|--------|----------------------|---------------|---------------------|------------------|
| **Startup time** | 2-5 seconds | 0.5-2 seconds | 100-500ms | 10-100ms |
| **Time to first request** | 3-8 seconds | 1-3 seconds | <1 second | <100ms |

**Analysis for Export Processing Service:**

For this workload, startup time is **NOT a critical factor** because:
- Jobs run 5 minutes to several hours
- Fargate tasks are long-lived (not serverless functions)
- Scale-out cooldown is 2 minutes (startup amortized)
- Base capacity of 2 tasks always running

A 3-5 second startup vs 1-2 second startup is negligible when jobs run for hours.

**Verdict:** Quarkus wins on paper, but **irrelevant for this use case**.

---

### 2. Memory Consumption

| Metric | Spring Boot 3.x | Quarkus |
|--------|-----------------|---------|
| **Baseline heap** | 150-300MB | 50-150MB |
| **Under load** | 300-600MB | 150-400MB |
| **24-hour GC cycles** | ~130 cycles | ~40 cycles |
| **GC pause time** | Higher | Lower |

Real-world production comparison showed Quarkus using approximately **24% less heap memory** than equivalent Spring Boot application.

**Analysis for Export Processing Service:**

- Fargate task sized at 8GB memory (ADR-001)
- ZIP extraction and file streaming are the memory drivers, not framework overhead
- Both frameworks consume <10% of available memory for framework operations
- Larger concern is file processing, not framework baseline

**Verdict:** Quarkus more efficient, but **both fit comfortably** in 8GB allocation.

---

### 3. Virtual Threads Support

#### Spring Boot 3.2+
```properties
# application.properties - ONE LINE to enable
spring.threads.virtual.enabled=true
```

Virtual threads are enabled globally for:
- Tomcat/Jetty request handling
- `@Async` methods
- `@Scheduled` tasks
- All blocking I/O automatically benefits

#### Quarkus
```java
// Explicit annotation required on each endpoint/method
@Path("/export")
public class ExportResource {
    
    @GET
    @RunOnVirtualThread  // Must annotate explicitly
    public Response processExport() {
        // runs on virtual thread
    }
}
```

**Key Differences:**

| Aspect | Spring Boot | Quarkus |
|--------|-------------|---------|
| **Enablement** | Global property | Per-method annotation |
| **Reactive integration** | Works alongside WebFlux | Requires RESTEasy Reactive extension |
| **Connection pool compatibility** | HikariCP works (with caveats) | Recommends Agroal (Loom-friendly) |
| **Maturity** | GA since 3.2 (Nov 2023) | Production-ready but explicit model |

**Quarkus Caution:**
> "As of today, it is not possible to use virtual threads in a carefree manner. Following such a laissez-faire approach could quickly lead to memory and resource starvation issues. Thus, Quarkus uses an explicit model."
> — Quarkus Documentation

**Verdict:** Spring Boot's **transparent virtual thread adoption** is simpler and less error-prone for teams new to virtual threads.

---

### 4. AWS SDK Integration

#### Spring Boot: Spring Cloud AWS 3.x

```xml
<dependency>
    <groupId>io.awspring.cloud</groupId>
    <artifactId>spring-cloud-aws-starter-sqs</artifactId>
    <version>3.2.0</version>
</dependency>
```

```java
@Component
public class ExportMessageListener {
    
    @SqsListener("${sqs.export.queue}")
    public void processMessage(ExportMessage message, 
                                @Header("MessageId") String messageId,
                                Acknowledgement ack) {
        // Process export
        ack.acknowledge(); // Manual ack after processing
    }
}
```

**Features:**
- `@SqsListener` annotation with auto-configuration
- Built on AWS SDK v2
- Automatic queue creation in dev mode
- Visibility timeout extension support
- Dead letter queue integration

#### Quarkus: Quarkiverse AWS Extensions

```xml
<dependency>
    <groupId>io.quarkiverse.amazonservices</groupId>
    <artifactId>quarkus-amazon-sqs</artifactId>
    <version>2.12.x</version>
</dependency>
```

```java
@ApplicationScoped
public class SqsConsumer {
    
    @Inject
    SqsClient sqsClient;
    
    @Scheduled(every = "5s")
    void pollMessages() {
        // Manual polling implementation required
        ReceiveMessageResponse response = sqsClient.receiveMessage(req -> 
            req.queueUrl(queueUrl)
               .maxNumberOfMessages(1)
               .waitTimeSeconds(20));
        
        // Process and delete manually
    }
}
```

**Quarkus Limitation:** No equivalent to `@SqsListener` - requires manual polling implementation or using SmallRye Reactive Messaging with SQS connector.

**Verdict:** Spring Cloud AWS provides **significantly better SQS developer experience** with annotation-driven listeners.

---

### 5. DynamoDB Integration

#### Spring Boot: Spring Cloud AWS + DynamoDB Enhanced Client

```java
@Configuration
public class DynamoConfig {
    
    @Bean
    public DynamoDbEnhancedClient dynamoDbEnhancedClient(DynamoDbClient client) {
        return DynamoDbEnhancedClient.builder()
            .dynamoDbClient(client)
            .build();
    }
}

@Repository
public class JobTrackingRepository {
    
    private final DynamoDbTable<JobTracking> table;
    
    public JobTrackingRepository(DynamoDbEnhancedClient client) {
        this.table = client.table("job-tracking", TableSchema.fromBean(JobTracking.class));
    }
    
    public boolean claimJob(String messageId) {
        // Conditional write for idempotency
    }
}
```

#### Quarkus: Quarkiverse DynamoDB

```java
@ApplicationScoped
public class JobTrackingRepository {
    
    @Inject
    DynamoDbEnhancedClient enhancedClient;
    
    // Similar implementation - both use AWS SDK v2 Enhanced Client
}
```

**Verdict:** **Equivalent** - both use AWS SDK v2 Enhanced Client under the hood.

---

### 6. Ecosystem & Library Compatibility

| Library | Spring Boot | Quarkus |
|---------|-------------|---------|
| **Apache Commons Compress** | ✅ Works | ✅ Works |
| **Jackson** | ✅ Auto-configured | ✅ Auto-configured |
| **Resilience4j** | ✅ Spring Boot starter | ✅ Quarkus extension |
| **Micrometer/Prometheus** | ✅ Native support | ✅ Native support |
| **SLF4J/Logback** | ✅ Default | ⚠️ Uses JBoss Logging (SLF4J bridge available) |
| **AWS SDK v2** | ✅ Via Spring Cloud AWS | ✅ Via Quarkiverse |
| **HikariCP** | ✅ Default | ⚠️ Recommends Agroal for virtual threads |

**Verdict:** Spring Boot has **broader library compatibility** with sensible defaults.

---

### 7. Long-Running Process Stability

For jobs lasting hours, framework stability under sustained load matters:

| Aspect | Spring Boot | Quarkus |
|--------|-------------|---------|
| **Battle-tested duration** | 10+ years in production | 5 years |
| **Enterprise adoption** | Massive (Netflix, Alibaba, etc.) | Growing (Red Hat customers) |
| **Memory leak track record** | Well-understood, tools available | Fewer long-term production reports |
| **GC behavior documentation** | Extensive | Limited for long-running |
| **Thread pool management** | Mature, configurable | Vert.x event loop model |

**Real-World Benchmark (ECS Fargate):**

One study showed Spring Boot failing to handle load testing at 1 vCPU / 2GB RAM, while Quarkus succeeded. However, at 2 vCPU / 4GB RAM, both performed well with Quarkus having better response times.

For our **2 vCPU / 8GB RAM** configuration, both frameworks will perform adequately.

**Verdict:** Spring Boot has **more production hours** in long-running scenarios; Quarkus is catching up.

---

### 8. Developer Experience & Productivity

| Aspect | Spring Boot | Quarkus |
|--------|-------------|---------|
| **IDE support** | Excellent (IntelliJ, Eclipse, VS Code) | Good (improving) |
| **Hot reload** | DevTools (restart-based) | Dev mode (true hot reload) |
| **Testing** | `@SpringBootTest`, Testcontainers | `@QuarkusTest`, Testcontainers |
| **Documentation** | Extensive, mature | Good, improving |
| **Stack Overflow questions** | ~180,000 | ~8,000 |
| **Tutorials/examples** | Abundant | Growing |
| **Error messages** | Sometimes verbose | Generally clear |

**Learning Curve:**

- **Spring Boot:** Most Java developers already know Spring concepts
- **Quarkus:** Requires learning CDI (`@ApplicationScoped`, `@Inject`), MicroProfile patterns, JAX-RS (`@Path`, `@GET`)

For a team with "TypeScript and Java" experience (per ADR-001), Spring Boot's familiarity reduces onboarding time.

**Verdict:** Spring Boot **lower friction** for typical Java teams.

---

### 9. Native Image Compilation (GraalVM)

Both frameworks support GraalVM native compilation, but with different levels of polish:

| Aspect | Spring Boot | Quarkus |
|--------|-------------|---------|
| **Native support since** | 3.0 (Nov 2022) | 1.0 (Nov 2019) |
| **Build time** | Longer (more reflection analysis) | Faster (build-time optimization) |
| **Startup time (native)** | 100-500ms | 10-100ms |
| **Memory (native)** | 50-150MB | 20-50MB |
| **Library compatibility** | Improving, some issues | Better (designed for it) |

**Relevance for Export Processing:**

Native images are **NOT recommended** for this workload because:

1. **Long job duration:** Native image benefits (fast startup) are irrelevant for multi-hour jobs
2. **ZIP processing:** Reflection-heavy libraries like Apache Commons Compress may have native compilation issues
3. **Debugging difficulty:** Native images are harder to debug in production
4. **JIT optimization:** JVM mode benefits from JIT compilation during long-running processes

**Verdict:** Quarkus native is superior, but **JVM mode is preferred** for this workload.

---

### 10. Observability & Monitoring

| Feature | Spring Boot | Quarkus |
|---------|-------------|---------|
| **Health checks** | Actuator (`/actuator/health`) | SmallRye Health (`/q/health`) |
| **Metrics** | Micrometer + Prometheus | Micrometer + Prometheus |
| **Tracing** | Micrometer Tracing, OpenTelemetry | OpenTelemetry native |
| **Custom metrics** | `@Timed`, `MeterRegistry` | `@Timed`, `MeterRegistry` |
| **CloudWatch integration** | Via Micrometer registry | Via Micrometer registry |

Both frameworks provide equivalent observability capabilities.

**Verdict:** **Tie** - both excellent.

---

### 11. Graceful Shutdown

Critical for long-running jobs that need to checkpoint before termination.

#### Spring Boot
```java
@Component
public class GracefulShutdownHandler {
    
    @PreDestroy
    public void onShutdown() {
        // Checkpoint current progress
        // Extend SQS visibility to 0
        // Complete or abort S3 multipart uploads
    }
}
```

```properties
# application.properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=120s
```

#### Quarkus
```java
@ApplicationScoped
public class GracefulShutdownHandler {
    
    void onStop(@Observes ShutdownEvent event) {
        // Checkpoint current progress
        // Extend SQS visibility to 0
        // Complete or abort S3 multipart uploads
    }
}
```

```properties
# application.properties
quarkus.shutdown.timeout=120s
```

**Verdict:** **Equivalent** - both handle SIGTERM gracefully.

---

## Cost Analysis

| Factor | Spring Boot | Quarkus | Impact |
|--------|-------------|---------|--------|
| **Memory usage** | ~400MB baseline | ~200MB baseline | Quarkus could use smaller Fargate task |
| **Startup time** | 3-5 seconds | 1-2 seconds | Negligible for long jobs |
| **Development time** | Lower (familiarity) | Higher (learning curve) | Spring Boot saves dev hours |
| **Hiring** | Easier (more Spring devs) | Harder (fewer Quarkus devs) | Spring Boot advantage |
| **Maintenance** | Established patterns | Evolving patterns | Spring Boot lower risk |

**Fargate Cost Comparison:**

If Quarkus allows downsizing from 8GB to 4GB RAM (unlikely given ZIP processing requirements):
- Savings: ~$0.02/hour per task
- With 10 average tasks: ~$150/month

However, the **development velocity difference** likely outweighs infrastructure savings.

---

## Risk Assessment

### Spring Boot Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Higher memory baseline | Medium | Low | 8GB allocation handles it |
| Slower startup | Low | Low | Long-running jobs amortize startup |
| Spring Cloud AWS gaps | Low | Medium | Direct AWS SDK v2 fallback |

### Quarkus Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Learning curve | High | Medium | Training, pair programming |
| Virtual thread pinning issues | Medium | High | Explicit model requires care |
| Fewer production case studies | Medium | Medium | Extensive testing |
| Extension maturity | Medium | Medium | Fall back to plain AWS SDK |
| Hiring difficulty | Medium | High | Train existing team |

---

## Decision Matrix

| Criterion | Weight | Spring Boot Score | Quarkus Score |
|-----------|--------|-------------------|---------------|
| Virtual threads simplicity | 20% | 9 | 7 |
| AWS integration quality | 20% | 9 | 7 |
| Team familiarity | 15% | 9 | 5 |
| Long-running stability | 15% | 9 | 7 |
| Memory efficiency | 10% | 6 | 9 |
| Startup time | 5% | 5 | 9 |
| Ecosystem maturity | 10% | 9 | 7 |
| Native image support | 5% | 7 | 9 |
| **Weighted Total** | 100% | **8.3** | **7.1** |

---

## Recommendation

### Decision: **Spring Boot 3.2+**

**Rationale:**

1. **Virtual threads are simpler**: One property vs explicit annotations; lower risk of pinning mistakes
2. **Better SQS integration**: `@SqsListener` with Spring Cloud AWS 3.x provides production-ready message consumption
3. **Team productivity**: Familiar patterns reduce development time and bugs
4. **Battle-tested for long jobs**: More production hours in similar workloads
5. **Startup time is irrelevant**: Jobs run for hours; 3-second vs 1-second startup doesn't matter
6. **Memory is not the bottleneck**: ZIP extraction drives memory, not framework overhead
7. **Lower risk**: Established patterns, extensive documentation, larger community

### When to Choose Quarkus Instead

Quarkus would be the better choice if:
- Building serverless functions (Lambda) where cold start matters
- Memory-constrained environments (<512MB)
- Team already experienced with Quarkus/MicroProfile
- Native image compilation is required
- Building many small, short-lived microservices

---

## Implementation Configuration

### Spring Boot 3.2+ Configuration

```xml
<!-- pom.xml -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.0</version>
</parent>

<dependencies>
    <!-- Core -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter</artifactId>
    </dependency>
    
    <!-- AWS Integration -->
    <dependency>
        <groupId>io.awspring.cloud</groupId>
        <artifactId>spring-cloud-aws-starter-sqs</artifactId>
        <version>3.2.0</version>
    </dependency>
    <dependency>
        <groupId>io.awspring.cloud</groupId>
        <artifactId>spring-cloud-aws-starter-s3</artifactId>
        <version>3.2.0</version>
    </dependency>
    
    <!-- DynamoDB (direct SDK - more control) -->
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>dynamodb-enhanced</artifactId>
    </dependency>
    
    <!-- Observability -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-registry-prometheus</artifactId>
    </dependency>
    
    <!-- Resilience -->
    <dependency>
        <groupId>io.github.resilience4j</groupId>
        <artifactId>resilience4j-spring-boot3</artifactId>
        <version>2.2.0</version>
    </dependency>
</dependencies>
```

```properties
# application.properties

# Virtual Threads - THE KEY SETTING
spring.threads.virtual.enabled=true

# Graceful Shutdown
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=120s

# AWS
spring.cloud.aws.region.static=us-east-1
spring.cloud.aws.sqs.listener.max-concurrent-messages=1
spring.cloud.aws.sqs.listener.max-messages-per-poll=1

# Actuator
management.endpoints.web.exposure.include=health,metrics,prometheus
management.endpoint.health.probes.enabled=true
```

```java
@SpringBootApplication
public class ExportProcessorApplication {
    public static void main(String[] args) {
        SpringApplication.run(ExportProcessorApplication.class, args);
    }
}

@Component
@Slf4j
public class ExportMessageListener {
    
    private final ExportService exportService;
    private final JobTrackingRepository jobTracking;
    
    @SqsListener(value = "${sqs.export.queue}", 
                 acknowledgementMode = SqsListenerAcknowledgementMode.MANUAL)
    public void processExport(
            @Payload ExportRequest request,
            @Header("MessageId") String messageId,
            Acknowledgement ack) {
        
        MDC.put("messageId", messageId);
        log.info("Received export request: {}", request.getJobId());
        
        try {
            // Idempotency check
            if (!jobTracking.claimJob(messageId)) {
                log.info("Job already claimed, skipping");
                ack.acknowledge();
                return;
            }
            
            // Process with heartbeat
            exportService.processExport(request, messageId);
            
            jobTracking.markComplete(messageId);
            ack.acknowledge();
            
        } catch (Exception e) {
            log.error("Export processing failed", e);
            jobTracking.markFailed(messageId, e.getMessage());
            throw e; // Let Spring handle retry/DLQ
        } finally {
            MDC.clear();
        }
    }
}
```

---

## Decision Record

| Field | Value |
|-------|-------|
| **Decision** | Spring Boot 3.2+ |
| **Status** | Accepted |
| **Date** | 2024-XX-XX |
| **Supersedes** | N/A |
| **Related** | ADR-001 (Java 21), ADR-002 (Libraries) |

---

## References

| Source | Key Finding |
|--------|-------------|
| [Spring Boot 3.2 Virtual Threads](https://spring.io/blog/2023/09/09/all-together-now-spring-boot-3-2-graalvm-native-images-java-21-and-virtual/) | One property enables virtual threads globally |
| [Quarkus Virtual Threads Guide](https://quarkus.io/guides/virtual-threads) | Explicit model required; cautions about laissez-faire usage |
| [Spring Boot vs Quarkus ECS Benchmark](https://medium.com/arconsis/spring-boot-vs-quarkus-part-2-jvm-runtime-performance-af45d0db116e) | Quarkus better at 1vCPU/2GB; both similar at 2vCPU/4GB |
| [Quarkus Production Comparison](https://simply-how.com/quarkus-vs-spring-boot-production-performance) | 24% memory savings, 3x fewer GC cycles with Quarkus |
| [Spring Cloud AWS 3.0 SQS](https://www.baeldung.com/java-spring-cloud-aws-v3-intro) | @SqsListener annotation simplifies consumption |
| [Virtual Threads Performance](https://www.sohamkamani.com/java/virtual-threads-spring-boot/) | 2x throughput improvement with Spring Boot virtual threads |
