# Architecture Decision Record: Export Processing Service Architecture

## Question

What is the optimal architecture for a service that processes export jobs from SQS, downloads files from an external Export API (with pagination), extracts ZIP files, validates contents against DynamoDB metadata, and uploads matching files to S3, handling 100,000 events/day with job durations ranging from 5 minutes to several hours?

## Assumptions

1. **Volume**: 100,000 events per day with non-uniform distribution (peaks of 3-5x average)
2. **Job Duration**: Highly variable, ranging from 5 minutes to potentially hours
3. **Workload Profile**: Primarily I/O-bound (HTTP downloads, S3 uploads) with CPU spikes during ZIP extraction
4. **Message Structure**: Each SQS message contains one or more export job IDs, each potentially having multiple paginated files
5. **File Sizes**: Variable, potentially large ZIP files (hundreds of MB to GB)
6. **Infrastructure**: AWS Fargate as the compute platform
7. **Technology Stack**: Node.js/TypeScript with NestJS framework
8. **Team Size**: Small team that values operational simplicity but can handle moderate complexity
9. **Reliability Requirements**: At-least-once processing with idempotency support
10. **Cost Sensitivity**: Moderate; willing to pay more for reliability and operational efficiency

## Options Considered

### Option 1: Monolithic Service with Worker Threads

A single Fargate service that polls SQS, orchestrates export jobs, and processes downloads using internal worker threads for parallelism.

```
┌────────────────────────────────────────────────────┐
│                  Fargate Task                       │
│  ┌──────────────────────────────────────────────┐  │
│  │  Main Thread          Worker Thread Pool     │  │
│  │  ┌──────────┐        ┌───────┐ ┌───────┐   │  │
│  │  │ SQS Poll │───────▶│  W1   │ │  W2   │   │  │
│  │  │ + Orch   │        └───────┘ └───────┘   │  │
│  │  └──────────┘                               │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
         │
         ▼
    ┌─────────┐
    │   SQS   │ (single queue)
    └─────────┘
```

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|OOM from large files kills entire process|Medium|High|Memory limits, streaming|
|Long jobs block orchestration capacity|High|Medium|Separate thread pools|
|Scaling couples orchestration with processing|High|Medium|Over-provision|
|Single point of failure|Medium|High|Multiple tasks, health checks|

#### Pros

- Simplest deployment model (one service, one image, one pipeline)
- Lowest operational overhead
- Unified logging and monitoring
- Minimal infrastructure components (single SQS queue)
- Lower base cost
- Zero inter-service latency
- Easier local development and debugging

#### Cons

- Cannot scale orchestration and processing independently
- Resource contention between orchestration and processing
- Larger blast radius on failures
- Inefficient resource utilization at scale
- Long-running jobs reduce message ingestion capacity
- Cannot use Fargate Spot effectively (orchestration needs stability)

---

### Option 2: Two Separate Services (Orchestrator + Worker)

Separate Fargate services: a lightweight Orchestrator that consumes export jobs and dispatches atomic download tasks to a second SQS queue, and heavy Worker services that process downloads.

```
┌──────────────────┐           ┌──────────────────┐
│  Orchestrator    │           │  Worker          │
│  (lightweight)   │           │  (heavy)         │
│  0.5 vCPU, 512MB │           │  2 vCPU, 4GB     │
└────────┬─────────┘           └────────┬─────────┘
         │                              │
         ▼                              ▼
    ┌─────────┐                   ┌─────────┐
    │  SQS 1  │──────────────────▶│  SQS 2  │
    │ExportJob│                   │Download │
    └─────────┘                   └─────────┘
```

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|Increased operational complexity|High|Low|Good documentation, IaC|
|Message loss between queues|Low|Medium|SQS durability, DLQ|
|Version mismatch between services|Medium|Medium|Shared contracts, testing|
|Higher base cost|High|Low|Right-sizing, Spot instances|

#### Pros

- Independent scaling of orchestration and processing
- Complete failure isolation between components
- Optimal resource allocation per service type
- Workers can use Fargate Spot (70% cost reduction)
- Clear separation of concerns
- Independent deployment and release cycles
- Orchestrator stays responsive regardless of worker load
- Better observability (separate metrics per concern)
- SQS 2 acts as natural buffer during peaks

#### Cons

- Two deployments to manage
- Additional SQS queue cost and complexity
- Added latency (50-200ms) for SQS hop between services
- More complex local development setup
- Requires coordination for breaking changes
- Higher base cost when idle

---

### Option 3: Single Service with Two SQS Consumers

One Fargate service with two independent SQS consumers: one for export jobs (orchestration) and one for download tasks (processing), communicating via a second SQS queue.

```
┌────────────────────────────────────────────────────┐
│                  Fargate Task                       │
│  ┌──────────────────┐    ┌──────────────────┐     │
│  │  Consumer 1      │    │  Consumer 2      │     │
│  │  (Orchestrator)  │    │  (Worker)        │     │
│  │                  │    │                  │     │
│  │  Shares CPU/Memory with Worker           │     │
│  └────────┬─────────┘    └────────┬─────────┘     │
└───────────┼──────────────────────┼────────────────┘
            │                      │
            ▼                      ▼
       ┌─────────┐            ┌─────────┐
       │  SQS 1  │───────────▶│  SQS 2  │
       └─────────┘            └─────────┘
```

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|Resource contention between consumers|High|Medium|Resource limits per consumer|
|Scaling couples both workloads|High|Medium|Over-provision|
|OOM affects both consumers|Medium|High|Memory monitoring, limits|
|Complex internal coordination|Medium|Low|Clear module boundaries|

#### Pros

- Single deployment unit
- Unified codebase and deployment pipeline
- Decoupled message processing via SQS
- Lower operational overhead than two services
- Shared infrastructure code
- Simpler local development than two services

#### Cons

- Still coupled scaling (scale one, scale both)
- Shared resource pool (CPU, memory, disk)
- No failure isolation between consumers
- Inefficient: each task runs orchestrator it may not need
- Cannot use Spot effectively
- Scaling adds unnecessary orchestration capacity

---

### Option 4: Hybrid with Worker Thread Pool

Single service where the main thread handles orchestration and dispatches to an internal worker thread pool. When the pool is saturated, tasks overflow to a secondary SQS queue for processing by the same or other tasks.

```
┌─────────────────────────────────────────────────────────┐
│                     Fargate Task                         │
│  ┌─────────────────┐      ┌────────────────────────┐   │
│  │   Main Thread   │      │   Worker Thread Pool   │   │
│  │                 │      │  ┌──────┐ ┌──────┐    │   │
│  │  Orchestrator   │─────▶│  │ W1   │ │ W2   │    │   │
│  │                 │      │  └──────┘ └──────┘    │   │
│  │  If pool full:  │      │                        │   │
│  │  overflow→SQS 2 │      │  Isolated CPU          │   │
│  └────────┬────────┘      └────────────────────────┘   │
└───────────┼─────────────────────────────────────────────┘
            │
            ▼
       ┌─────────┐            ┌─────────┐
       │  SQS 1  │            │  SQS 2  │ (overflow buffer)
       └─────────┘            └─────────┘
```

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|OOM in worker affects entire process|Medium|High|Memory limits, process isolation|
|Complex internal coordination|Medium|Medium|Well-tested pool manager|
|Pool saturation leads to mostly overflow|High|Medium|Right-size pool, fast scaling|
|Thread management complexity|Medium|Low|Battle-tested libraries|

#### Pros

- Near-zero latency for local dispatch (~1ms vs 50-200ms)
- Single deployment unit
- CPU isolation via worker threads
- Automatic overflow handling during peaks
- SQS 2 acts as buffer without manual intervention
- Efficient resource utilization when load is moderate
- Graceful degradation under high load

#### Cons

- Partial memory isolation (shared process heap)
- Pool saturation negates latency benefit
- More complex internal architecture
- OOM can still kill entire process
- Scaling still somewhat coupled
- Complex debugging of thread interactions
- Long-running jobs still saturate pool, forcing overflow

---

## Recommended Option

### Option 2: Two Separate Services (Orchestrator + Worker)

### Decision Rationale

The decision is based on weighted scoring of key factors for the specific use case:

|Factor|Weight|Opt 1|Opt 2|Opt 3|Opt 4|
|---|---|---|---|---|---|
|Variable job duration handling|30%|5|9|5|6|
|High volume capability|20%|7|9|7|8|
|Operational simplicity|20%|9|6|7|7|
|Failure resilience|15%|5|9|5|6|
|Cost efficiency at scale|10%|6|8|6|7|
|Latency|5%|8|7|7|9|
|**Weighted Score**|100%|**6.35**|**8.05**|**6.05**|**6.85**|

**Primary Decision Drivers:**

1. **Job Duration Variability (30%)**: Jobs ranging from 5 minutes to hours make independent scaling critical. Long-running jobs in Options 1, 3, and 4 block resources needed for new work.
    
2. **Failure Isolation (15%)**: With 100,000 events/day, failures are inevitable. Complete isolation between orchestration and processing prevents cascading failures and reduces blast radius.
    
3. **Cost Efficiency (10%)**: Workers can use Fargate Spot instances (up to 70% discount) while orchestrator remains on-demand. This is only possible with separate services.
    
4. **Operational Maturity**: The pattern of queue-based decoupling is well-understood, battle-tested, and supported by extensive AWS tooling.
    

### Implications

#### MUST

1. **MUST** implement two separate Fargate task definitions:
    
    - Orchestrator: 0.5 vCPU, 512MB RAM, minimum 2 tasks
    - Worker: 2 vCPU, 4GB RAM, auto-scaling based on SQS depth
2. **MUST** create two SQS queues:
    
    - `export-jobs`: Source queue for export job messages
    - `download-tasks`: Queue for atomic download tasks
3. **MUST** implement Dead Letter Queues (DLQ) for both SQS queues with appropriate retry policies
    
4. **MUST** implement visibility timeout extension (heartbeat) for long-running worker jobs
    
5. **MUST** ensure idempotent processing in workers (same file upload to S3 produces same result)
    
6. **MUST** implement health check endpoints for both services for Fargate health monitoring
    
7. **MUST** use structured logging with correlation IDs that span both services
    
8. **MUST** implement graceful shutdown handling for both services
    

#### SHOULD

1. **SHOULD** use Fargate Spot for worker tasks to reduce costs by up to 70%
    
2. **SHOULD** implement auto-scaling for workers based on:
    
    - `ApproximateNumberOfMessagesVisible` in SQS 2
    - Average CPU utilization
3. **SHOULD** keep orchestrator tasks on-demand capacity for stability
    
4. **SHOULD** implement circuit breaker pattern for Export API calls in orchestrator
    
5. **SHOULD** use streaming for file downloads to minimize memory usage
    
6. **SHOULD** implement comprehensive metrics:
    
    - Orchestrator: messages processed, tasks dispatched, API latency
    - Worker: download duration, extraction time, upload success rate
7. **SHOULD** maintain both services in a single codebase with `SERVICE_MODE` environment variable for shared code reuse
    
8. **SHOULD** implement exponential backoff with jitter for retries
    
9. **SHOULD** set appropriate SQS message retention (14 days) to handle extended outages
    

#### MAY

1. **MAY** implement a shared library package for common interfaces and utilities if codebase grows significantly
    
2. **MAY** add a third service for post-processing or notification if requirements expand
    
3. **MAY** implement priority queues (separate SQS queues for high/normal/low priority) if business requires
    
4. **MAY** add EventBridge integration for workflow observability and event-driven extensions
    
5. **MAY** implement distributed tracing (AWS X-Ray) for end-to-end request tracking
    
6. **MAY** consider Step Functions for complex error handling and retry orchestration if failure scenarios become more complex
    
7. **MAY** implement S3 event notifications for downstream processing triggers
    
8. **MAY** add CloudWatch dashboards for operational visibility
    

---

## Appendix: Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RECOMMENDED ARCHITECTURE                           │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         ORCHESTRATOR SERVICE                         │   │
│  │                         (2 tasks, 0.5 vCPU, 512MB)                  │   │
│  │                                                                      │   │
│  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │   │
│  │   │ SQS Poller  │───▶│ Export API  │───▶│ Task        │            │   │
│  │   │             │    │ Client      │    │ Dispatcher  │            │   │
│  │   └─────────────┘    └─────────────┘    └──────┬──────┘            │   │
│  │                                                 │                    │   │
│  └─────────────────────────────────────────────────┼────────────────────┘   │
│                                                    │                        │
│       ┌────────────┐                               │                        │
│       │   SQS 1    │                               ▼                        │
│       │ ExportJobs │                         ┌────────────┐                 │
│       └────────────┘                         │   SQS 2    │                 │
│                                              │ DownloadTasks│                │
│                                              └──────┬─────┘                 │
│                                                     │                        │
│  ┌──────────────────────────────────────────────────┼───────────────────┐   │
│  │                         WORKER SERVICE           │                    │   │
│  │                    (auto-scale, 2 vCPU, 4GB)    │                    │   │
│  │                                                  │                    │   │
│  │   ┌─────────────┐    ┌─────────────┐    ┌──────▼──────┐            │   │
│  │   │ Download    │───▶│ Extract     │───▶│ Validate    │            │   │
│  │   │ Service     │    │ Service     │    │ Service     │            │   │
│  │   └─────────────┘    └─────────────┘    └──────┬──────┘            │   │
│  │                                                 │                    │   │
│  │                                          ┌──────▼──────┐            │   │
│  │                                          │ Upload      │            │   │
│  │                                          │ Service     │            │   │
│  │                                          └─────────────┘            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                    │                        │
│       ┌────────────┐                               │       ┌────────────┐  │
│       │ DynamoDB   │◀──────────────────────────────┼──────▶│     S3     │  │
│       │ (metadata) │                               │       │  (output)  │  │
│       └────────────┘                               │       └────────────┘  │
│                                                    │                        │
└────────────────────────────────────────────────────────────────────────────┘
```

---

**Decision Date**: [Current Date] **Decision Makers**: [Team/Architect Names] **Status**: Proposed