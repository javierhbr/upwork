# ADR-001: Language and Architecture for SQS Export Processing Service

## Question

What is the optimal programming language and architecture for a Fargate-based service that processes export jobs from SQS, downloads files from an external Export API with pagination, extracts ZIP files, validates contents against DynamoDB metadata, and uploads matching files to S3—handling 100,000 events/day with job durations ranging from 5 minutes to several hours?

## Assumptions

| # | Assumption | Impact |
|---|------------|--------|
| 1 | **Volume**: 100,000 events/day with non-uniform distribution (peaks of 3-5x average) | Requires elastic scaling; ~1.16 events/second average, ~5.8/second peak |
| 2 | **Job Duration**: Highly variable, 5 minutes to several hours | Eliminates Lambda; requires SQS visibility timeout management |
| 3 | **Workload Profile**: Primarily I/O-bound with CPU spikes during ZIP extraction | Mixed workload affects language choice |
| 4 | **Message Structure**: Each SQS message contains one or more export job IDs with multiple paginated files | Batch size considerations; complex job state |
| 5 | **File Sizes**: Variable, hundreds of MB to GB ZIP files | Memory management critical; streaming required |
| 6 | **Infrastructure**: AWS Fargate as compute platform | Constrains storage options; ephemeral storage limits |
| 7 | **Team Expertise**: TypeScript and Java | Limits viable language options |
| 8 | **Latency Tolerance**: Up to 60 minutes from SQS arrival to processing start | Allows batch-style polling; no real-time requirement |
| 9 | **Reliability**: At-least-once processing with idempotency support | Requires deduplication strategy |
| 10 | **Cost Sensitivity**: Moderate; prioritizes reliability over cost | Spot instances viable but not mandatory |

---

## Options Considered

### Option 1: Java 21+ with Virtual Threads

A Java-based service using Project Loom's virtual threads (GA in Java 21) for I/O concurrency, with Apache Commons Compress for ZIP handling and AWS SDK v2 for cloud services.

#### Risk and Impact

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| JVM warm-up latency (5-15s cold start) | High | Low | Negligible for multi-hour jobs; GraalVM native-image if needed |
| Team unfamiliarity with virtual threads | Medium | Medium | Training; virtual threads use familiar blocking APIs |
| Larger container image size (~200-400MB) | High | Low | Minimal cost impact; one-time download per task |
| Pinned carrier threads during synchronized blocks | Medium | Medium | Avoid `synchronized`; use `ReentrantLock` |

#### Pros

- **Native multi-threading for CPU-bound work**: ZIP extraction runs on platform threads without architectural workarounds
- **Superior memory management**: JVM garbage collection handles multi-hour processes reliably; heap scales to Fargate limits
- **Zip64 support**: Apache Commons Compress transparently handles files >4GB and archives with >65K entries
- **Virtual threads simplify I/O concurrency**: Synchronous code achieves reactive-level throughput; no callback complexity
- **Mature ecosystem**: Robust libraries for all requirements (AWS SDK v2, Commons Compress, DynamoDB enhanced client)
- **Stronger typing**: Catches more errors at compile time for complex job state management

#### Cons

- **Slower iteration cycle**: Compile step adds friction vs. TypeScript's rapid feedback
- **Verbose syntax**: More boilerplate than TypeScript for equivalent functionality
- **Cold start overhead**: 5-15 second JVM initialization (mitigated by job duration)
- **Container size**: Larger images increase initial task startup time

---

### Option 2: TypeScript/Node.js with Worker Threads

A Node.js-based service using the event loop for I/O concurrency, worker threads for CPU-bound ZIP extraction, and streaming libraries for memory efficiency.

#### Risk and Impact

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Event loop blocking during ZIP extraction | High | High | Worker threads required; adds complexity |
| Memory pressure on large files | High | Medium | Careful streaming; ~1.7GB practical heap limit |
| Memory leaks in long-running processes | Medium | High | Monitoring; periodic task recycling |
| Limited Zip64 support in streaming libraries | Medium | Medium | Library selection; may require disk staging |

#### Pros

- **Team familiarity**: Existing TypeScript expertise reduces learning curve
- **Fast iteration**: No compile step; rapid development and debugging
- **Excellent I/O performance**: Event loop handles thousands of concurrent connections efficiently
- **Smaller container images**: ~100-150MB vs. Java's ~200-400MB
- **Rich npm ecosystem**: Multiple ZIP libraries available (`unzipper`, `yauzl`, `adm-zip`)
- **Near-instant cold start**: Sub-second initialization

#### Cons

- **Event loop blocking**: ZIP decompression blocks the main thread; requires worker threads
- **Worker thread complexity**: Passing large buffers between threads requires careful memory management
- **Memory constraints**: V8 heap limited to ~1.7GB by default; long-running processes risk leaks
- **Zip64 limitations**: Node.js streaming libraries require explicit configuration for large archives
- **Single-threaded model**: Cannot fully utilize multiple vCPUs without worker threads or clustering

---

### Option 3: Hybrid Architecture (TypeScript Orchestrator + Java Workers)

A two-tier architecture where TypeScript handles SQS polling, job orchestration, and lightweight validation, while Java containers handle CPU-intensive ZIP extraction via internal queue or direct invocation.

#### Risk and Impact

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Operational complexity | High | High | Two deployment pipelines; doubled monitoring |
| Inter-service communication latency | Medium | Medium | Co-locate tasks; use internal networking |
| Increased infrastructure cost | High | Medium | Additional task overhead; ECS service mesh |
| Debugging complexity | High | Medium | Distributed tracing required |

#### Pros

- **Best of both worlds**: TypeScript for I/O orchestration, Java for CPU-bound work
- **Clear separation of concerns**: Each service optimized for its workload
- **Independent scaling**: Scale extraction workers separately from orchestrators
- **Gradual migration path**: Can start with TypeScript, add Java workers later

#### Cons

- **Operational overhead**: Two codebases, two CI/CD pipelines, two monitoring configurations
- **Network latency**: Inter-service communication adds latency and failure modes
- **Complexity for small team**: Doubles the surface area to maintain
- **Cost increase**: Minimum viable deployment requires more tasks

---

## Comparative Analysis

### Language/Runtime Comparison

| Criterion | Java 21+ Virtual Threads | TypeScript/Node.js | Hybrid |
|-----------|--------------------------|-------------------|--------|
| **I/O Concurrency** | ★★★★★ Virtual threads | ★★★★★ Event loop | ★★★★★ |
| **CPU-bound Work** | ★★★★★ Native threads | ★★★☆☆ Worker threads | ★★★★★ |
| **Memory Management** | ★★★★★ GC for long jobs | ★★★☆☆ Leak risk | ★★★★☆ |
| **Large File Handling** | ★★★★★ Zip64 native | ★★★☆☆ Limited | ★★★★★ |
| **Team Familiarity** | ★★★★☆ Java experience | ★★★★★ Primary lang | ★★★☆☆ |
| **Development Speed** | ★★★☆☆ Compile cycle | ★★★★★ Rapid | ★★☆☆☆ |
| **Operational Simplicity** | ★★★★☆ Single service | ★★★★☆ Single service | ★★☆☆☆ |
| **Cold Start** | ★★★☆☆ 5-15 seconds | ★★★★★ Sub-second | ★★★☆☆ |
| **Cost Efficiency** | ★★★★☆ | ★★★★☆ | ★★★☆☆ |

### Workload Fit Analysis

| Workload Characteristic | Java 21+ | TypeScript | Winner |
|------------------------|----------|------------|--------|
| Download from Export API (I/O) | Virtual threads | Event loop | Tie |
| ZIP extraction (CPU) | Platform threads | Worker threads (complex) | **Java** |
| DynamoDB validation (I/O) | Virtual threads | Event loop | Tie |
| S3 multipart upload (I/O) | Virtual threads | Streams | Tie |
| Multi-hour job stability | JVM GC handles well | Memory leak risk | **Java** |
| Large file (>4GB) support | Commons Compress Zip64 | Requires configuration | **Java** |
| Peak traffic handling | Scales linearly | Event loop bottleneck risk | **Java** |

### SQS Consumer Pattern Comparison

| Pattern | Fits Multi-Hour Jobs? | Complexity | Recommendation |
|---------|----------------------|------------|----------------|
| Lambda trigger | ❌ 15-min timeout | Low | Not viable |
| Long visibility timeout | ⚠️ 12-hour max limit | Low | Insufficient alone |
| Heartbeat extension | ✅ Indefinite | Medium | **Recommended** |
| Step Functions | ✅ Up to 1 year | High | Overkill |

---

## Recommended Option

### **Option 1: Java 21+ with Virtual Threads**

Java 21 with virtual threads is the recommended solution for this export processing service.

---

### Decisioning

The decision is driven by three critical workload characteristics:

**1. Mixed I/O and CPU workload**

The service is not purely I/O-bound. ZIP extraction creates significant CPU bursts that would block Node.js's event loop. While worker threads can address this, they add complexity and memory-sharing challenges. Java handles both workload types natively—virtual threads for I/O, platform threads for CPU—without architectural workarounds.

**2. Multi-hour job stability**

Jobs lasting several hours require bulletproof memory management. Java's generational garbage collection is battle-tested for long-running processes. Node.js processes face memory leak risks from closures, event listeners, and unbounded caches over extended periods. The JVM's heap can scale to Fargate's memory limits, while V8 has a practical ceiling around 1.7GB.

**3. Large file handling requirements**

ZIP files potentially reaching GB sizes require Zip64 support for archives with >65K entries or individual files >4GB. Apache Commons Compress provides transparent Zip64 support. Node.js streaming libraries (`unzipper`, `yauzl`) require explicit configuration and have edge cases with Zip64 handling.

**Supporting factors:**
- Team has Java experience (not just TypeScript)
- Cold start overhead (5-15s) is negligible for 5-minute to multi-hour jobs
- Virtual threads eliminate the traditional Java complexity of async/reactive programming
- Stronger compile-time type checking benefits complex job state management

---

### Implications

#### MUST

| Requirement | Rationale | Implementation |
|-------------|-----------|----------------|
| Use Java 21 or later | Virtual threads require Java 21+ (GA release) | Base image: `eclipse-temurin:21-jre-jammy` |
| Implement SQS heartbeat pattern | 12-hour visibility timeout limit; jobs may exceed this | Extend visibility every 2-3 minutes via `ChangeMessageVisibility` |
| Use streaming for file processing | Files up to GB; cannot buffer in memory | Apache Commons Compress `ZipArchiveInputStream` → S3 multipart upload |
| Implement idempotency tracking | At-least-once delivery requires deduplication | DynamoDB conditional writes with message ID as key |
| Configure adequate ephemeral storage | Default 20GB insufficient for large ZIP extraction | Task definition: 100-150GB ephemeral storage |
| Handle SIGTERM gracefully | Fargate sends SIGTERM on scale-in/Spot interruption | Save checkpoint, extend visibility to 0, clean up resources |
| Use Task Scale-In Protection | Prevent auto-scaling from killing active jobs | Acquire via `$ECS_AGENT_URI/task-protection/v1/state` |
| Process single message per task | Variable job duration makes batching impractical | `MaxNumberOfMessages: 1` in receive call |

#### SHOULD

| Recommendation | Rationale | Implementation |
|----------------|-----------|----------------|
| Use 2 vCPU / 8GB memory task sizing | Network throughput scales with vCPU; memory for streaming buffers | Fargate task definition configuration |
| Implement checkpointing for long jobs | Enable resume after crash or Spot interruption | Save progress to DynamoDB every 5-10 minutes |
| Use hybrid Fargate/Fargate Spot capacity | Cost optimization for burst traffic | Capacity providers: `FARGATE base=2 weight=1`, `FARGATE_SPOT base=0 weight=3` |
| Scale based on backlog-per-task metric | Better than raw queue depth for variable-duration jobs | Custom CloudWatch metric: `ApproximateNumberOfMessages / RunningTaskCount` |
| Set DLQ maxReceiveCount to 3-5 | Allows retries while catching persistent failures | SQS redrive policy configuration |
| Use S3 conditional writes | Prevent duplicate uploads | `If-None-Match: "*"` header on PutObject |
| Abort incomplete multipart uploads | Abandoned uploads incur indefinite storage costs | S3 lifecycle rule: abort uploads >24 hours old |

#### MAY

| Option | Use Case | Consideration |
|--------|----------|---------------|
| Use GraalVM native-image | If short jobs dominate and cold start matters | Adds build complexity; evaluate after production data |
| Implement EFS for checkpointing | If Spot interruption recovery is critical | Additional cost; ephemeral storage may suffice |
| Add Step Functions orchestration | If job workflows become complex | Overkill for current linear pipeline |
| Use Graviton (ARM) instances | Cost optimization (~20% savings) | Verify library compatibility; minor savings |
| Implement circuit breaker for Export API | If external API has reliability issues | Evaluate after production error rates known |
| Add distributed tracing | If debugging complex job flows | X-Ray integration; adds overhead |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS Cloud                                       │
│  ┌──────────────┐     ┌─────────────────────────────────────────────────┐   │
│  │  SQS Queue   │     │              ECS Fargate Cluster                │   │
│  │              │     │  ┌─────────────────────────────────────────┐    │   │
│  │ Export Jobs  │────▶│  │         Java 21 Worker Task             │    │   │
│  │              │     │  │  ┌─────────────────────────────────┐    │    │   │
│  │ Visibility:  │     │  │  │     Virtual Thread Pool         │    │    │   │
│  │ 5min + HB    │     │  │  │  ┌─────┐ ┌─────┐ ┌─────┐       │    │    │   │
│  └──────┬───────┘     │  │  │  │ I/O │ │ I/O │ │ I/O │       │    │    │   │
│         │             │  │  │  └──┬──┘ └──┬──┘ └──┬──┘       │    │    │   │
│         │             │  │  └────│───────│───────│───────────┘    │    │   │
│  ┌──────▼───────┐     │  │       │       │       │                │    │   │
│  │     DLQ      │     │  │  ┌────▼───────▼───────▼────────────┐   │    │   │
│  │ maxReceive=5 │     │  │  │      Platform Thread Pool       │   │    │   │
│  └──────────────┘     │  │  │  ┌───────────────────────────┐  │   │    │   │
│                       │  │  │  │   ZIP Extraction (CPU)    │  │   │    │   │
│                       │  │  │  └───────────────────────────┘  │   │    │   │
│                       │  │  └─────────────────────────────────┘   │    │   │
│                       │  │                                        │    │   │
│                       │  │  Ephemeral Storage: 150GB              │    │   │
│                       │  └────────────────────────────────────────┘    │   │
│                       │                    │                           │   │
│                       │     ┌──────────────┼──────────────┐            │   │
│                       └─────│──────────────│──────────────│────────────┘   │
│                             ▼              ▼              ▼                 │
│                       ┌──────────┐  ┌──────────┐  ┌──────────────┐          │
│                       │ Export   │  │ DynamoDB │  │     S3       │          │
│                       │   API    │  │          │  │              │          │
│                       │ (Ext.)   │  │ - Jobs   │  │ - Outputs    │          │
│                       │          │  │ - Idempo │  │ - Multipart  │          │
│                       └──────────┘  └──────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## References

| Source | Key Finding |
|--------|-------------|
| [AWS SQS Best Practices](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/best-practices-processing-messages-timely-manner.html) | Visibility timeout should exceed average processing time; use heartbeat for variable jobs |
| [AWS ChangeMessageVisibility API](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ChangeMessageVisibility.html) | New timeout starts from current time; maximum 12 hours total |
| [AWS ECS Task Scale-In Protection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection.html) | Tasks can protect themselves for up to 48 hours |
| [Fargate Ephemeral Storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html) | Default 20GB; expandable to 200GB at $0.000111/GB-hour |
| [Apache Commons Compress ZipArchiveInputStream](https://commons.apache.org/proper/commons-compress/apidocs/org/apache/commons/compress/archivers/zip/ZipArchiveInputStream.html) | Streaming extraction with Zip64 support |
| [Java Virtual Threads Guide](https://www.backendbytes.com/java/java-virtual-threads-project-loom-guide/) | Virtual threads unmount from carrier on blocking I/O |
| [Node.js Worker Threads](https://nodesource.com/blog/worker-threads-nodejs-multithreading-in-javascript) | Required for CPU-bound work; adds complexity |
| [Handling Long-Running Jobs with SQS](https://brunoscheufler.com/blog/2022-08-14-handling-long-running-jobs-with-aws-sqs) | Heartbeat pattern for extending visibility |
| [Fargate Spot Deep Dive](https://aws.amazon.com/blogs/compute/deep-dive-into-fargate-spot-to-run-your-ecs-tasks-for-up-to-70-less/) | 2-minute interruption warning; 70% cost savings |
| [ECS Graceful Shutdown](https://medium.com/@dar3.st/graceful-termination-of-a-node-app-in-aws-ecs-29e8c596c47d) | Handle SIGTERM; configure stopTimeout |

---

## Decision Record

| Field | Value |
|-------|-------|
| **Decision** | Java 21+ with Virtual Threads |
| **Status** | Proposed |
| **Date** | 2024-XX-XX |
| **Deciders** | [Team/Architect Names] |
| **Consulted** | [Stakeholders] |
| **Informed** | [Teams] |

---

## Appendix A: SQS Heartbeat Implementation Pattern

```java
// Simplified heartbeat pattern (Java 21+)
public class SqsHeartbeatManager implements AutoCloseable {
    private final SqsClient sqsClient;
    private final String queueUrl;
    private final ScheduledExecutorService scheduler;
    private volatile ScheduledFuture<?> heartbeatTask;
    
    public void startHeartbeat(String receiptHandle, Duration interval) {
        heartbeatTask = scheduler.scheduleAtFixedRate(() -> {
            try {
                sqsClient.changeMessageVisibility(r -> r
                    .queueUrl(queueUrl)
                    .receiptHandle(receiptHandle)
                    .visibilityTimeout((int) interval.multipliedBy(2).toSeconds()));
            } catch (Exception e) {
                log.error("Heartbeat failed", e);
            }
        }, interval.toSeconds(), interval.toSeconds(), TimeUnit.SECONDS);
    }
    
    public void stopHeartbeat() {
        if (heartbeatTask != null) {
            heartbeatTask.cancel(false);
        }
    }
}
```

## Appendix B: Idempotency Pattern with DynamoDB

```java
// Conditional write for idempotency
public boolean claimJob(String messageId, String workerId, Duration ttl) {
    try {
        Instant expiry = Instant.now().plus(ttl);
        dynamoDb.putItem(r -> r
            .tableName("job-tracking")
            .item(Map.of(
                "pk", AttributeValue.fromS("msg#" + messageId),
                "sk", AttributeValue.fromS("JOB"),
                "status", AttributeValue.fromS("IN_PROGRESS"),
                "worker_id", AttributeValue.fromS(workerId),
                "in_progress_expiry", AttributeValue.fromN(String.valueOf(expiry.getEpochSecond())),
                "ttl", AttributeValue.fromN(String.valueOf(Instant.now().plus(Duration.ofDays(1)).getEpochSecond()))
            ))
            .conditionExpression("attribute_not_exists(pk) OR in_progress_expiry < :now")
            .expressionAttributeValues(Map.of(
                ":now", AttributeValue.fromN(String.valueOf(Instant.now().getEpochSecond()))
            )));
        return true; // Claimed successfully
    } catch (ConditionalCheckFailedException e) {
        return false; // Another worker owns this job
    }
}
```

## Appendix C: Task Definition Snippet

```json
{
  "family": "export-processor",
  "cpu": "2048",
  "memory": "8192",
  "ephemeralStorage": {
    "sizeInGiB": 150
  },
  "containerDefinitions": [{
    "name": "worker",
    "image": "xxx.dkr.ecr.region.amazonaws.com/export-processor:latest",
    "essential": true,
    "stopTimeout": 120,
    "linuxParameters": {
      "initProcessEnabled": true
    },
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/export-processor",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "worker"
      }
    }
  }],
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc"
}
```

## Appendix D: Capacity Provider Strategy

```json
{
  "capacityProviderStrategy": [
    {
      "capacityProvider": "FARGATE",
      "base": 2,
      "weight": 1
    },
    {
      "capacityProvider": "FARGATE_SPOT",
      "base": 0,
      "weight": 3
    }
  ]
}
```

## Appendix E: Auto-Scaling Configuration

```yaml
# Target tracking scaling policy
ScalingPolicy:
  Type: AWS::ApplicationAutoScaling::ScalingPolicy
  Properties:
    PolicyName: BacklogPerTaskScaling
    PolicyType: TargetTrackingScaling
    ScalingTargetId: !Ref ScalableTarget
    TargetTrackingScalingPolicyConfiguration:
      TargetValue: 2  # Messages per task (60min latency / 30min avg job)
      CustomizedMetricSpecification:
        MetricName: BacklogPerTask
        Namespace: Custom/ExportProcessor
        Statistic: Average
        Unit: Count
      ScaleInCooldown: 300   # 5 minutes
      ScaleOutCooldown: 120  # 2 minutes
```
