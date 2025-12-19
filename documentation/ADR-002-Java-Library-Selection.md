# ADR-002: Java Library Selection for SQS Export Processing Service

## Question

Which Java libraries should be used to implement the SQS export processing service for optimal performance, reliability, and maintainability?

## Context

Following ADR-001's recommendation of Java 21+ with virtual threads, this document analyzes the best-fit libraries for each component of the export processing pipeline:

1. AWS SDK and service clients (SQS, S3, DynamoDB)
2. HTTP client for Export API integration
3. ZIP extraction and compression
4. JSON serialization/deserialization
5. Resilience patterns (retry, circuit breaker)
6. Logging framework
7. Scheduling and concurrency utilities

---

## Library Analysis by Category

### 1. AWS SDK: Version 2.x (Required)

| Option | Status | Recommendation |
|--------|--------|----------------|
| AWS SDK v1.x | End-of-support Dec 2025 | ❌ Do not use |
| AWS SDK v2.x | Active development | ✅ **Required** |

**Decision: AWS SDK for Java 2.x**

AWS SDK v1.x entered maintenance mode in July 2024 and reaches end-of-support on December 31, 2025. SDK v2.x provides:

- Non-blocking I/O built on Netty for async clients
- Immutable, thread-safe objects with builder pattern
- Pluggable HTTP client implementations
- Better cold-start performance for containerized workloads
- Full support for modern Java features (virtual threads compatible)

**Key dependencies:**
```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>bom</artifactId>
            <version>2.28.x</version> <!-- Use latest -->
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>sqs</artifactId>
    </dependency>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>s3</artifactId>
    </dependency>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>s3-transfer-manager</artifactId>
    </dependency>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>dynamodb-enhanced</artifactId>
    </dependency>
</dependencies>
```

---

### 2. DynamoDB Client: Enhanced Client vs Low-Level

| Aspect | Low-Level Client | Enhanced Client |
|--------|------------------|-----------------|
| **Type safety** | Manual `AttributeValue` handling | POJO mapping with annotations |
| **Boilerplate** | High | Low |
| **Flexibility** | Full control | Covers 95% of use cases |
| **Performance** | Slightly faster | Negligible overhead |
| **Conditional writes** | Manual expression building | Fluent API support |
| **Learning curve** | Steeper | Gentler |

**Decision: DynamoDB Enhanced Client**

The enhanced client significantly reduces boilerplate while maintaining access to advanced features like conditional writes needed for idempotency:

```java
@DynamoDbBean
public class JobTracking {
    private String pk;
    private String sk;
    private String status;
    private Instant inProgressExpiry;
    private String workerId;
    private Long ttl;
    
    @DynamoDbPartitionKey
    public String getPk() { return pk; }
    
    @DynamoDbSortKey
    public String getSk() { return sk; }
    
    // ... other getters/setters
}

// Conditional write for idempotency
Expression condition = Expression.builder()
    .expression("attribute_not_exists(pk) OR in_progress_expiry < :now")
    .expressionValues(Map.of(":now", AttributeValue.fromN(String.valueOf(Instant.now().getEpochSecond()))))
    .build();

table.putItem(PutItemEnhancedRequest.builder(JobTracking.class)
    .item(job)
    .conditionExpression(condition)
    .build());
```

**Caveat:** Keep low-level client available for edge cases (COUNT queries, complex projections) not fully supported in enhanced client.

---

### 3. S3 Operations: Transfer Manager

| Option | Use Case | Multipart Support | Streaming |
|--------|----------|-------------------|-----------|
| `S3Client` (sync) | Simple operations | Manual | Yes |
| `S3AsyncClient` | Non-blocking | Manual | Yes |
| `S3TransferManager` | Large files | Automatic | Yes |

**Decision: S3 Transfer Manager + S3Client**

For files potentially reaching GB sizes, the Transfer Manager provides:

- Automatic multipart upload/download
- Configurable part size and concurrency
- Progress tracking
- Pause/resume support for interrupted transfers

```java
S3TransferManager transferManager = S3TransferManager.builder()
    .s3Client(S3AsyncClient.crtBuilder()
        .targetThroughputInGbps(5.0)
        .minimumPartSizeInBytes(10 * 1024 * 1024L) // 10MB parts
        .build())
    .build();

// Upload with automatic multipart
Upload upload = transferManager.upload(UploadRequest.builder()
    .putObjectRequest(req -> req.bucket(bucket).key(key))
    .requestBody(AsyncRequestBody.fromInputStream(inputStream, contentLength, executor))
    .build());

CompletedUpload result = upload.completionFuture().join();
```

Use standard `S3Client` for small files (<100MB) where Transfer Manager overhead isn't justified.

---

### 4. HTTP Client for Export API

| Library | Virtual Thread Safe | HTTP/2 | Streaming | Dependencies | Recommendation |
|---------|---------------------|--------|-----------|--------------|----------------|
| **Java HttpClient** | ✅ Native | ✅ | ✅ | None (JDK) | ✅ **Primary choice** |
| **OkHttp** | ⚠️ Kotlin stdlib | ✅ | ✅ | Okio, Kotlin | Good alternative |
| **Apache HttpClient 5** | ✅ | ✅ Beta | ✅ | Multiple | Complex configs |
| **Jetty HttpClient** | ✅ | ✅ | ✅ | Jetty core | If using Jetty |

**Decision: Java 11+ HttpClient (JDK built-in)**

For this workload, the JDK's built-in `HttpClient` is optimal:

- **Zero dependencies**: No additional libraries to manage
- **Virtual thread compatible**: Works seamlessly with Project Loom
- **HTTP/2 support**: Built-in multiplexing
- **Async and sync APIs**: CompletableFuture-based async
- **Connection pooling**: Automatic, configurable

```java
HttpClient httpClient = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_2)
    .connectTimeout(Duration.ofSeconds(10))
    .followRedirects(HttpClient.Redirect.NORMAL)
    .build();

// Streaming download
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(exportApiUrl))
    .header("Authorization", "Bearer " + token)
    .timeout(Duration.ofMinutes(30))
    .GET()
    .build();

HttpResponse<InputStream> response = httpClient.send(
    request, 
    HttpResponse.BodyHandlers.ofInputStream()
);
```

**When to use OkHttp instead:**
- Need interceptors for request/response logging
- Require automatic retry with backoff (use with Resilience4j instead)
- Working with APIs requiring specific HTTP quirks

---

### 5. ZIP Extraction

| Library | Streaming | Zip64 | Password | Memory Efficiency | Maintenance |
|---------|-----------|-------|----------|-------------------|-------------|
| **Apache Commons Compress** | ✅ | ✅ Native | ❌ | ✅ Excellent | Active |
| **zip4j** | ⚠️ Limited | ✅ | ✅ AES | Medium | Active |
| **java.util.zip** | ✅ | ⚠️ Partial | ❌ | ✅ | JDK |

**Decision: Apache Commons Compress**

For large ZIP files (hundreds of MB to GB), Apache Commons Compress is the clear winner:

- **Zip64 transparent support**: Files >4GB, archives with >65K entries
- **Streaming extraction**: `ZipArchiveInputStream` processes entries without loading full archive
- **Multiple format support**: ZIP, TAR, GZIP, 7z, etc.
- **Active maintenance**: Regular updates, security patches

```java
// Streaming extraction - memory efficient for large files
try (ZipArchiveInputStream zis = new ZipArchiveInputStream(
        new BufferedInputStream(inputStream))) {
    
    ZipArchiveEntry entry;
    while ((entry = zis.getNextZipEntry()) != null) {
        if (!entry.isDirectory() && zis.canReadEntryData(entry)) {
            // Process entry stream directly - no temp file needed for small entries
            processEntry(entry.getName(), zis, entry.getSize());
        }
    }
}
```

**Dependency:**
```xml
<dependency>
    <groupId>org.apache.commons</groupId>
    <artifactId>commons-compress</artifactId>
    <version>1.26.x</version>
</dependency>
```

**Caveat:** ZIP format stores central directory at end of file. For archives requiring random access (seek to specific entry), download to ephemeral storage first, then use `ZipFile` class.

---

### 6. JSON Serialization

| Library | Performance | Features | Size | Kotlin Support |
|---------|-------------|----------|------|----------------|
| **Jackson** | ✅ Fastest for large payloads | ✅ Rich annotations | 2.5MB+ | ✅ Module |
| **Gson** | ✅ Fast for small payloads | Medium | 300KB | ⚠️ Null issues |
| **Moshi** | ✅ Good | Medium | 200KB + Okio | ✅ Native |

**Decision: Jackson**

Jackson is the industry standard for Java JSON processing:

- **Best performance for large objects**: Critical for parsing Export API responses
- **Extensive annotation support**: `@JsonIgnoreProperties`, `@JsonCreator`, etc.
- **Streaming API**: Process large JSON without full memory load
- **AWS SDK compatibility**: SDK v2 uses Jackson internally

```java
ObjectMapper mapper = JsonMapper.builder()
    .addModule(new JavaTimeModule())
    .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    .build();

// Streaming large JSON arrays
try (JsonParser parser = mapper.getFactory().createParser(inputStream)) {
    if (parser.nextToken() == JsonToken.START_ARRAY) {
        while (parser.nextToken() != JsonToken.END_ARRAY) {
            ExportRecord record = mapper.readValue(parser, ExportRecord.class);
            processRecord(record);
        }
    }
}
```

**Dependencies:**
```xml
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
    <version>2.17.x</version>
</dependency>
<dependency>
    <groupId>com.fasterxml.jackson.datatype</groupId>
    <artifactId>jackson-datatype-jsr310</artifactId>
    <version>2.17.x</version>
</dependency>
```

---

### 7. Resilience: Retry and Circuit Breaker

| Library | Dependencies | Virtual Threads | API Style | Active |
|---------|--------------|-----------------|-----------|--------|
| **Resilience4j** | Vavr | ✅ | Functional | ✅ |
| **Failsafe** | None | ✅ | Fluent | ✅ |
| **Hystrix** | Multiple | ❌ Deprecated | Wrapper | ❌ |

**Decision: Resilience4j**

Resilience4j is the successor to Hystrix and provides:

- **Modular design**: Include only needed patterns
- **Functional composition**: Decorate suppliers, functions, runnables
- **Rich metrics**: Integrates with Micrometer for observability
- **Circuit breaker states**: Closed → Open → Half-Open with configurable thresholds

```java
// Retry with exponential backoff for Export API calls
RetryConfig retryConfig = RetryConfig.custom()
    .maxAttempts(5)
    .waitDuration(Duration.ofSeconds(1))
    .intervalFunction(IntervalFunction.ofExponentialBackoff(1000, 2))
    .retryOnException(e -> e instanceof IOException || e instanceof TimeoutException)
    .build();

Retry retry = Retry.of("export-api", retryConfig);

// Circuit breaker for degraded service protection
CircuitBreakerConfig cbConfig = CircuitBreakerConfig.custom()
    .failureRateThreshold(50)
    .slowCallRateThreshold(80)
    .slowCallDurationThreshold(Duration.ofSeconds(30))
    .slidingWindowSize(10)
    .waitDurationInOpenState(Duration.ofMinutes(1))
    .permittedNumberOfCallsInHalfOpenState(3)
    .build();

CircuitBreaker circuitBreaker = CircuitBreaker.of("export-api", cbConfig);

// Compose decorators
Supplier<ExportResponse> decorated = Decorators.ofSupplier(() -> exportApiClient.fetchExport(jobId))
    .withRetry(retry)
    .withCircuitBreaker(circuitBreaker)
    .decorate();
```

**Dependencies:**
```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-all</artifactId>
    <version>2.2.x</version>
</dependency>
```

**Alternative consideration:** For simpler retry-only needs, AWS SDK v2's built-in retry can suffice for AWS service calls.

---

### 8. Logging

| Framework | Performance | Async | Config | Recommendation |
|-----------|-------------|-------|--------|----------------|
| **SLF4J** | Facade | N/A | N/A | ✅ Always use |
| **Log4j2** | ✅ Best async | ✅ LMAX Disruptor | XML/JSON/YAML | ✅ High-throughput |
| **Logback** | ✅ Good | ✅ Async appender | XML/Groovy | ✅ Default choice |

**Decision: SLF4J + Logback (with option to switch to Log4j2)**

SLF4J as the API with Logback as the implementation provides:

- **Framework independence**: Switch implementations without code changes
- **Native SLF4J integration**: No bridges needed
- **Automatic config reload**: Update logging levels without restart
- **MDC support**: Correlate logs with job IDs, message IDs

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

public class ExportProcessor {
    private static final Logger log = LoggerFactory.getLogger(ExportProcessor.class);
    
    public void processJob(String messageId, String jobId) {
        try (MDC.MDCCloseable mdc = MDC.putCloseable("messageId", messageId)) {
            MDC.put("jobId", jobId);
            log.info("Starting export processing");
            // ... processing logic
            log.info("Export processing completed");
        }
    }
}
```

**Logback configuration for container environments:**
```xml
<configuration>
    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{ISO8601} [%thread] %-5level %logger{36} - %X{messageId} %X{jobId} - %msg%n</pattern>
        </encoder>
    </appender>
    
    <appender name="ASYNC" class="ch.qos.logback.classic.AsyncAppender">
        <appender-ref ref="STDOUT"/>
        <queueSize>1024</queueSize>
        <discardingThreshold>0</discardingThreshold>
    </appender>
    
    <root level="INFO">
        <appender-ref ref="ASYNC"/>
    </root>
</configuration>
```

**When to use Log4j2 instead:**
- Very high logging throughput (millions of messages/second)
- Need garbage-free logging mode
- Require advanced async with LMAX Disruptor

---

### 9. Scheduling and Concurrency

| Component | Use Case | Library |
|-----------|----------|---------|
| Heartbeat scheduler | SQS visibility extension | `ScheduledExecutorService` (JDK) |
| Virtual thread executor | I/O operations | `Executors.newVirtualThreadPerTaskExecutor()` |
| Bounded concurrency | Parallel file processing | `Semaphore` (JDK) |
| Async coordination | Multi-step workflows | `CompletableFuture` (JDK) |

**Decision: JDK built-in concurrency utilities**

Java 21's virtual threads and existing concurrency utilities are sufficient:

```java
// Virtual thread executor for I/O-bound operations
ExecutorService ioExecutor = Executors.newVirtualThreadPerTaskExecutor();

// Scheduled executor for heartbeat (use platform threads)
ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(
    r -> Thread.ofPlatform().name("heartbeat-scheduler").daemon(true).unstarted(r)
);

// Bounded concurrency for parallel file uploads
Semaphore uploadSemaphore = new Semaphore(5); // Max 5 concurrent uploads

public void uploadFile(String key, InputStream content) {
    uploadSemaphore.acquire();
    try {
        s3Client.putObject(/* ... */);
    } finally {
        uploadSemaphore.release();
    }
}
```

---

## Comparative Summary Table

| Category | Recommended Library | Alternatives | Rationale |
|----------|---------------------|--------------|-----------|
| **AWS SDK** | SDK v2.x | None | v1.x end-of-life Dec 2025 |
| **DynamoDB** | Enhanced Client | Low-level for edge cases | Reduces boilerplate, POJO mapping |
| **S3 Upload** | Transfer Manager | S3Client for small files | Auto multipart, resume support |
| **HTTP Client** | Java HttpClient | OkHttp | Zero deps, virtual thread native |
| **ZIP** | Apache Commons Compress | zip4j (if encryption needed) | Zip64, streaming, active maintenance |
| **JSON** | Jackson | Gson for simple cases | Performance, annotation richness |
| **Resilience** | Resilience4j | Failsafe | Industry standard, metrics integration |
| **Logging** | SLF4J + Logback | Log4j2 for extreme throughput | Native integration, config reload |
| **Concurrency** | JDK utilities | None needed | Virtual threads, CompletableFuture |

---

## Complete Dependency Set

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project>
    <properties>
        <java.version>21</java.version>
        <aws.sdk.version>2.28.0</aws.sdk.version>
        <jackson.version>2.17.0</jackson.version>
        <resilience4j.version>2.2.0</resilience4j.version>
        <logback.version>1.5.6</logback.version>
        <commons-compress.version>1.26.1</commons-compress.version>
    </properties>
    
    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>software.amazon.awssdk</groupId>
                <artifactId>bom</artifactId>
                <version>${aws.sdk.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>
    
    <dependencies>
        <!-- AWS SDK v2 -->
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>sqs</artifactId>
        </dependency>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>s3</artifactId>
        </dependency>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>s3-transfer-manager</artifactId>
        </dependency>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>dynamodb-enhanced</artifactId>
        </dependency>
        
        <!-- S3 CRT client for high-throughput transfers -->
        <dependency>
            <groupId>software.amazon.awssdk.crt</groupId>
            <artifactId>aws-crt</artifactId>
            <version>0.29.x</version>
        </dependency>
        
        <!-- ZIP Processing -->
        <dependency>
            <groupId>org.apache.commons</groupId>
            <artifactId>commons-compress</artifactId>
            <version>${commons-compress.version}</version>
        </dependency>
        
        <!-- JSON -->
        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
            <version>${jackson.version}</version>
        </dependency>
        <dependency>
            <groupId>com.fasterxml.jackson.datatype</groupId>
            <artifactId>jackson-datatype-jsr310</artifactId>
            <version>${jackson.version}</version>
        </dependency>
        
        <!-- Resilience -->
        <dependency>
            <groupId>io.github.resilience4j</groupId>
            <artifactId>resilience4j-all</artifactId>
            <version>${resilience4j.version}</version>
        </dependency>
        
        <!-- Logging -->
        <dependency>
            <groupId>ch.qos.logback</groupId>
            <artifactId>logback-classic</artifactId>
            <version>${logback.version}</version>
        </dependency>
        
        <!-- Testing -->
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>5.10.x</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.mockito</groupId>
            <artifactId>mockito-core</artifactId>
            <version>5.11.x</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>localstack</artifactId>
            <version>1.19.x</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
```

---

## Architecture Integration Pattern

```java
/**
 * Main worker class demonstrating library integration
 */
public class ExportWorker {
    private static final Logger log = LoggerFactory.getLogger(ExportWorker.class);
    
    private final SqsClient sqsClient;
    private final DynamoDbEnhancedClient dynamoClient;
    private final S3TransferManager transferManager;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final Retry exportApiRetry;
    private final CircuitBreaker exportApiCircuitBreaker;
    private final ScheduledExecutorService heartbeatScheduler;
    private final ExecutorService ioExecutor;
    
    public ExportWorker() {
        // AWS clients - share single instances (thread-safe)
        this.sqsClient = SqsClient.create();
        this.dynamoClient = DynamoDbEnhancedClient.builder()
            .dynamoDbClient(DynamoDbClient.create())
            .build();
        this.transferManager = S3TransferManager.builder()
            .s3Client(S3AsyncClient.crtBuilder()
                .targetThroughputInGbps(5.0)
                .minimumPartSizeInBytes(10 * 1024 * 1024L)
                .build())
            .build();
        
        // HTTP client for Export API
        this.httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_2)
            .connectTimeout(Duration.ofSeconds(10))
            .build();
        
        // JSON mapper
        this.objectMapper = JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();
        
        // Resilience patterns
        this.exportApiRetry = Retry.of("export-api", RetryConfig.custom()
            .maxAttempts(5)
            .intervalFunction(IntervalFunction.ofExponentialBackoff(1000, 2))
            .build());
        
        this.exportApiCircuitBreaker = CircuitBreaker.of("export-api", 
            CircuitBreakerConfig.custom()
                .failureRateThreshold(50)
                .slidingWindowSize(10)
                .waitDurationInOpenState(Duration.ofMinutes(1))
                .build());
        
        // Executors
        this.heartbeatScheduler = Executors.newSingleThreadScheduledExecutor();
        this.ioExecutor = Executors.newVirtualThreadPerTaskExecutor();
    }
    
    public void processMessage(Message message) {
        String messageId = message.messageId();
        
        try (MDC.MDCCloseable mdc = MDC.putCloseable("messageId", messageId)) {
            // Claim job with idempotency check
            if (!claimJob(messageId)) {
                log.info("Job already claimed by another worker");
                return;
            }
            
            // Start heartbeat
            ScheduledFuture<?> heartbeat = startHeartbeat(message);
            
            try {
                // Fetch from Export API with resilience
                ExportData data = fetchExportWithResilience(messageId);
                
                // Stream ZIP extraction to S3
                processZipStream(data.getDownloadUrl(), messageId);
                
                // Mark complete
                markJobComplete(messageId);
                
            } finally {
                heartbeat.cancel(false);
            }
        }
    }
    
    private ExportData fetchExportWithResilience(String jobId) {
        Supplier<ExportData> decorated = Decorators
            .ofSupplier(() -> callExportApi(jobId))
            .withRetry(exportApiRetry)
            .withCircuitBreaker(exportApiCircuitBreaker)
            .decorate();
        
        return decorated.get();
    }
    
    // ... additional implementation methods
}
```

---

## Decision Record

| Field | Value |
|-------|-------|
| **Decision** | Library stack as documented |
| **Status** | Proposed |
| **Date** | 2024-XX-XX |
| **Supersedes** | N/A |
| **Related** | ADR-001 (Language Selection) |

---

## References

| Source | Key Finding |
|--------|-------------|
| [AWS SDK v2 Best Practices](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html) | Share client instances, close streams promptly |
| [DynamoDB Enhanced Client](https://aws.amazon.com/blogs/developer/introducing-enhanced-dynamodb-client-in-the-aws-sdk-for-java-v2/) | POJO mapping, operations map directly to API calls |
| [Apache Commons Compress](https://commons.apache.org/proper/commons-compress/zip.html) | Zip64 support, streaming extraction |
| [Java JSON Benchmarks](https://github.com/fabienrenaud/java-json-benchmark) | Jackson consistently outperforms for large payloads |
| [Resilience4j Guide](https://www.baeldung.com/resilience4j) | Functional composition, metrics integration |
| [Java Logging Comparison](https://stackify.com/compare-java-logging-frameworks/) | Log4j2 fastest async, Logback good default |
| [Java 21 Virtual Threads](https://www.baeldung.com/java-virtual-threads) | Compatible with blocking I/O APIs |
