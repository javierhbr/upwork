
# Detailed Analysis: Hybrid Alternative with Worker Pool

## Overview of Architectures

Before diving into the hybrid approach, let's visualize all four options:

```
OPTION 1: Original Monolithic
═════════════════════════════
┌────────────────────────────────────────┐
│            Fargate Task                 │
│  ┌──────────────────────────────────┐  │
│  │         Main Thread              │  │
│  │  SQS Poll → Process → Upload     │  │
│  │  (all sequential or with workers)│  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
         │
         ▼
    ┌─────────┐
    │   SQS   │ (single queue)
    └─────────┘


OPTION 2: Two Separate Services
═══════════════════════════════
┌──────────────────┐      ┌──────────────────┐
│  Fargate Task A  │      │  Fargate Task B  │
│  (Orchestrator)  │      │  (Worker)        │
│                  │      │                  │
│  Lightweight,    │      │  Heavy, slow     │
│  fast            │      │                  │
│  0.5 vCPU, 512MB │      │  2 vCPU, 4GB     │
└────────┬─────────┘      └────────┬─────────┘
         │                         │
         ▼                         ▼
    ┌─────────┐               ┌─────────┐
    │  SQS 1  │──────────────▶│  SQS 2  │
    └─────────┘               └─────────┘


OPTION 3: Single Service, Two Consumers
═══════════════════════════════════════
┌────────────────────────────────────────┐
│            Fargate Task                 │
│  ┌────────────────┐ ┌────────────────┐ │
│  │  Consumer 1    │ │  Consumer 2    │ │
│  │  (Orchestrator)│ │  (Worker)      │ │
│  │                │ │                │ │
│  │  Share CPU and memory             │ │
│  └───────┬────────┘ └───────┬────────┘ │
└──────────┼──────────────────┼──────────┘
           │                  │
           ▼                  ▼
      ┌─────────┐        ┌─────────┐
      │  SQS 1  │───────▶│  SQS 2  │
      └─────────┘        └─────────┘


OPTION 4: Hybrid with Worker Pool (Thread-based)
════════════════════════════════════════════════
┌─────────────────────────────────────────────────────┐
│                   Fargate Task                       │
│  ┌─────────────────┐    ┌────────────────────────┐  │
│  │   Main Thread   │    │   Worker Thread Pool   │  │
│  │                 │    │  ┌──────┐ ┌──────┐    │  │
│  │  Orchestrator   │───▶│  │ W1   │ │ W2   │    │  │
│  │  (dispatch)     │    │  │      │ │      │    │  │
│  │                 │    │  └──────┘ └──────┘    │  │
│  │  If pool full:  │    │                        │  │
│  │  queue to SQS2  │    │  CPU Isolation         │  │
│  └────────┬────────┘    └────────────────────────┘  │
└───────────┼─────────────────────────────────────────┘
            │
            ▼
       ┌─────────┐        ┌─────────┐
       │  SQS 1  │        │  SQS 2  │ (overflow/buffer)
       └─────────┘        └─────────┘
```

---

## Detailed Design of the Hybrid Architecture

### Main Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FARGATE TASK                                  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      MAIN THREAD                                │ │
│  │                                                                 │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐ │ │
│  │  │  SQS Poller     │  │  Orchestrator   │  │  Pool Manager  │ │ │
│  │  │                 │  │                 │  │                │ │ │
│  │  │  • Long polling │  │  • Export API   │  │  • Dispatch    │ │ │
│  │  │  • Backpressure │  │  • Pagination   │  │  • Overflow    │ │ │
│  │  │  • Visibility   │  │  • Task creation│  │  • Monitoring  │ │ │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬───────┘ │ │
│  │           │                    │                    │         │ │
│  │           └────────────────────┼────────────────────┘         │ │
│  │                                │                               │ │
│  └────────────────────────────────┼───────────────────────────────┘ │
│                                   │                                  │
│                    ┌──────────────┴──────────────┐                  │
│                    │     DECISION POINT          │                  │
│                    │                             │                  │
│                    │  Does pool have capacity?   │                  │
│                    │     │              │        │                  │
│                    │   YES             NO        │                  │
│                    │     │              │        │                  │
│                    │     ▼              ▼        │                  │
│                    │  Dispatch      Queue to    │                  │
│                    │  to Worker     SQS 2       │                  │
│                    └──────────────┬──────────────┘                  │
│                                   │                                  │
│  ┌────────────────────────────────┼───────────────────────────────┐ │
│  │              WORKER THREAD POOL (isolated)                      │ │
│  │                                │                                │ │
│  │    ┌───────────┐  ┌───────────┴┐  ┌───────────┐  ┌───────────┐│ │
│  │    │ Worker 1  │  │ Worker 2   │  │ Worker 3  │  │ Worker N  ││ │
│  │    │           │  │            │  │           │  │           ││ │
│  │    │ Download  │  │ Download   │  │ Download  │  │ Download  ││ │
│  │    │ Extract   │  │ Extract    │  │ Extract   │  │ Extract   ││ │
│  │    │ Validate  │  │ Validate   │  │ Validate  │  │ Validate  ││ │
│  │    │ Upload    │  │ Upload     │  │ Upload    │  │ Upload    ││ │
│  │    │           │  │            │  │           │  │           ││ │
│  │    └───────────┘  └────────────┘  └───────────┘  └───────────┘│ │
│  │                                                                │ │
│  │    Each worker has its own event loop                         │ │
│  │    Communication via MessagePort (zero-copy when possible)    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Pool Manager Decision Flow

```
                    Message arrives from SQS 1
                            │
                            ▼
                ┌───────────────────────┐
                │  Orchestrator process │
                │  • Call Export API    │
                │  • Paginate results   │
                │  • Create N tasks     │
                └───────────┬───────────┘
                            │
              For each download task:
                            │
                            ▼
                ┌───────────────────────┐
                │  Pool Manager eval    │
                └───────────┬───────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
    ┌───────────────┐ ┌───────────┐ ┌───────────────┐
    │ Free workers  │ │ Local     │ │ Pool saturated│
    │    > 0        │ │ queue     │ │ Queue full    │
    │               │ │ < limit   │ │               │
    └───────┬───────┘ └─────┬─────┘ └───────┬───────┘
            │               │               │
            ▼               ▼               ▼
    ┌───────────────┐ ┌───────────┐ ┌───────────────┐
    │   Dispatch    │ │ Queue     │ │  Send to      │
    │   immediately │ │ locally   │ │  SQS 2        │
    │   to worker   │ │           │ │  (overflow)   │
    └───────────────┘ └───────────┘ └───────────────┘
```

### Overflow Strategy to SQS

The secondary SQS acts as an **overflow buffer**, not as the main queue:

```
Normal scenario (low-medium load):
──────────────────────────────────
SQS 1 → Orchestrator → Worker Pool → S3
                           │
                      (100% local)


Peak scenario (high load):
──────────────────────────
SQS 1 → Orchestrator ──┬──▶ Worker Pool → S3 (80%)
                       │
                       └──▶ SQS 2 → [another task or same] → S3 (20%)


Extreme saturation scenario:
────────────────────────────
SQS 1 → Orchestrator → SQS 2 (100% overflow)
                          │
                          ▼
              Workers from this or other tasks
              consume from SQS 2
```

---

## Detailed Comparison

### Dimension 1: Resource Isolation

|Architecture|CPU Isolation|Memory Isolation|I/O Isolation|
|---|---|---|---|
|**Monolithic**|❌ None|❌ None|❌ None|
|**Two Services**|✅ Total|✅ Total|✅ Total|
|**Single Service, Two Consumers**|❌ None|❌ None|❌ None|
|**Hybrid**|⚠️ Partial|⚠️ Partial|✅ High|

**Explanation of isolation in Hybrid:**

Worker Threads in Node.js provide real CPU isolation because each thread has its own V8 isolate and can run on a different core. However:

- **Memory**: Although each worker has its own heap, they share the process memory footprint. A worker consuming 2GB affects the memory available to others.
    
- **CPU**: Truly parallel. If you have 4 cores and 4 workers, each can use 100% of a core independently.
    
- **I/O**: Each worker has its own event loop, so I/O operations don't block between workers.
    

```
Two Services:                     Hybrid:
──────────────                    ───────
┌─────────┐ ┌─────────┐          ┌─────────────────────────┐
│ Task A  │ │ Task B  │          │         Task            │
│ 512MB   │ │ 4GB     │          │  ┌─────┐ ┌─────┐       │
│         │ │         │          │  │ W1  │ │ W2  │       │
│ If A    │ │ If B    │          │  │ 1GB │ │ 1GB │       │
│ crashes │ │ crashes │          │  └─────┘ └─────┘       │
│ B stays │ │ A stays │          │                         │
└─────────┘ └─────────┘          │  If W1 OOM, all dies   │
                                 └─────────────────────────┘
     ✅ Total isolation              ⚠️ Partial isolation
```

### Dimension 2: Operational Complexity

```
                    Complexity
                         │
    High ────────────────┼─────────────────────────────
                         │                    ▲
                         │                    │ Two Services
                         │              ▲     │
                         │              │ Hybrid
                         │        ▲     │
                         │        │ Single Service/Two Consumers
                         │  ▲     │
                         │  │ Monolithic
    Low  ────────────────┼──┴─────┴─────┴─────┴────────
                         │
                    Ability to scale granularly
```

|Aspect|Monolithic|Two Services|Two Consumers|Hybrid|
|---|---|---|---|---|
|Repositories|1|1-2|1|1|
|Task Definitions|1|2|1|1|
|CI/CD Pipelines|1|2|1|1|
|SQS Queues|1|2|2|2|
|Debugging|Simple|Distributed|Mixed|Moderate|
|Logs|Unified|Separated|Mixed|Structured|

**The Hybrid has "internal" complexity:**

Although operationally it's a single service, the internal code is more complex:

- Thread pool management
- Dispatch vs overflow decision logic
- Inter-thread communication
- Worker lifecycle handling

### Dimension 3: Scalability

```
MONOLITHIC / TWO CONSUMERS:
───────────────────────────
Scale = Add identical tasks

Task 1 [Orch + Work]  →  Task 1 [Orch + Work]
                         Task 2 [Orch + Work]
                         Task 3 [Orch + Work]

Problem: You scale orchestration unnecessarily


TWO SERVICES:
─────────────
Scale = Add specific tasks

Orch Task 1  →  Orch Task 1        (unchanged)
Work Task 1  →  Work Task 1
                Work Task 2
                Work Task 3
                Work Task 4

Benefit: Scale only what you need


HYBRID:
───────
Scale = Add tasks + overflow absorbs peaks

Task 1 [Orch + Pool]  →  Task 1 [Orch + Pool]
                         Task 2 [Orch + Pool]
         │
         └──▶ SQS 2 (peak buffer)
              │
              └──▶ Consumed by pools from all tasks

Benefit: Horizontal scaling + automatic buffer
```

**Auto-scaling pattern in Hybrid:**

```
Metrics to scale:

1. Pool Utilization (per task)
   ───────────────────────────
   If > 80% for 5 min → Scale up
   If < 30% for 15 min → Scale down

2. SQS 2 Depth (overflow queue)
   ────────────────────────────
   If > 100 messages for 5 min → Scale up aggressively
   If = 0 for 30 min → Indicates system has slack

3. Combined
   ─────────
   Pool high + SQS 2 low = Working well, don't scale
   Pool high + SQS 2 high = Needs more capacity urgently
   Pool low + SQS 2 low = Over-provisioned, scale down
```

### Dimension 4: Latency and Throughput

|Metric|Monolithic|Two Services|Two Consumers|Hybrid|
|---|---|---|---|---|
|Minimum latency|~0ms|~50-200ms|~50-200ms|~0ms|
|Latency with overflow|N/A|~50-200ms|~50-200ms|~50-200ms|
|Orchestration throughput|Coupled|Decoupled|Coupled|Decoupled*|
|Processing throughput|Limited|Independent|Coupled|Parallel|

*Decoupled because the main thread doesn't block while workers process.

**Unique advantage of Hybrid - Zero Latency in normal case:**

```
Two Services:
─────────────
Message → Orchestrator → SQS 2 → Worker
                         └─ 50-200ms latency ALWAYS

Hybrid:
───────
Normal case (pool available):
Message → Orchestrator → Worker Thread (same process)
                         └─ ~1ms latency

Overflow case:
Message → Orchestrator → SQS 2 → Worker
                         └─ 50-200ms only when overflow
```

### Dimension 5: Resilience

```
FAILURE MODES AND BLAST RADIUS
══════════════════════════════

Failure: Worker OOM due to large file
─────────────────────────────────────

Two Services:
┌─────────┐     ┌─────────┐
│ Orch    │     │ Worker  │ ← OOM
│ ✅ OK   │     │ 💥 Crash │
└─────────┘     └─────────┘
                     │
              Only this task dies
              Message returns to SQS 2
              Other tasks keep processing

Hybrid:
┌──────────────────────────┐
│ Task                      │
│ ┌──────┐ ┌──────┐        │
│ │ Main │ │ W1💥 │ ← OOM  │
│ │ ???  │ │      │        │
│ └──────┘ └──────┘        │
└──────────────────────────┘
              │
    What happens to main thread?
    
    Scenario A: Worker thread isolated
    → Main thread survives
    → Pool restarts the worker
    → Task gets reprocessed
    
    Scenario B: OOM affects process
    → Entire process dies
    → All in-progress jobs lost


Failure: Bug in decompression (unhandled exception)
───────────────────────────────────────────────────

Two Services:
┌─────────┐     ┌─────────┐
│ Orch    │     │ Worker  │ ← Exception
│ ✅ OK   │     │ ⚠️ Error │
└─────────┘     └─────────┘
                     │
              Worker task may or may not die
              Orchestrator unaffected

Hybrid:
┌──────────────────────────┐
│ Task                      │
│ ┌──────┐ ┌──────┐        │
│ │ Main │ │ W1⚠️ │        │
│ │ ✅   │ │      │        │
│ └──────┘ └──────┘        │
└──────────────────────────┘
              │
    Worker thread dies in isolation
    Pool manager restarts it
    Main thread unaffected
    ✅ Good isolation for this case
```

**Blast Radius Matrix:**

|Failure Type|Two Services|Hybrid|
|---|---|---|
|Exception in worker|Only that worker|Only that thread|
|OOM in worker|Only that worker task|⚠️ Potentially everything|
|Process crash|Only that service|Everything|
|Network timeout|Isolated by service|Shared|
|Disk full|Only worker tasks|Everything|
|Gradual memory leak|Isolated|⚠️ Affects entire process|

### Dimension 6: Costs

```
SCENARIO: 100,000 events/day, 5x peak over average
══════════════════════════════════════════════════

MONOLITHIC:
───────────
Base: 20 tasks × 2 vCPU × 4GB × 24h
Peak: Scale to 100 tasks
Average cost: ~$200/day

Problem: Each task has idle orchestration capacity


TWO SERVICES:
─────────────
Orchestrator: 2 tasks × 0.5 vCPU × 512MB × 24h = ~$3/day
Workers base: 15 tasks × 2 vCPU × 4GB × 12h = ~$90/day
Workers peak: +50 tasks × 2 vCPU × 4GB × 4h = ~$40/day
Total: ~$133/day

Benefit: Workers can use Spot (70% discount)
With Spot: ~$60/day


HYBRID:
───────
Base: 10 tasks × 2 vCPU × 4GB × 24h = ~$120/day
Peak: +20 tasks × 2 vCPU × 4GB × 4h = ~$20/day
Total: ~$140/day

Partial benefit: 
- Fewer tasks than monolithic (more efficient pool)
- SQS 2 absorbs peaks without immediate scaling
- Can use Spot for overflow tasks

With partial Spot: ~$100/day
```

**Efficiency Analysis:**

```
Resource utilization during peak:

Two Services:
┌────────────────────────────────────────────────────┐
│ Orchestrator (2 tasks)                             │
│ [██████░░░░░░░░░░░░░░] 30% CPU (excess capacity)  │
│                                                    │
│ Workers (65 tasks)                                 │
│ [██████████████████░░] 90% CPU (well utilized)   │
└────────────────────────────────────────────────────┘

Hybrid (30 tasks):
┌────────────────────────────────────────────────────┐
│ Main threads (orchestration)                       │
│ [████░░░░░░░░░░░░░░░░] 20% CPU                    │
│                                                    │
│ Worker pools                                       │
│ [██████████████████░░] 90% CPU                    │
│                                                    │
│ Combined per task:                                 │
│ [████████████████░░░░] 80% CPU (efficient)        │
└────────────────────────────────────────────────────┘
```

---

## Scenarios where each architecture shines

### Hybrid is BETTER when:

```
✅ Latency matters a lot
   → Local dispatch eliminates the SQS hop

✅ Load is relatively predictable
   → Pool can be sized adequately
   → Overflow to SQS is rare

✅ You want operational simplicity
   → One deploy, one service, one image
   → Logs in one place

✅ Jobs are medium duration (1-15 minutes)
   → Pool doesn't get saturated by eternal jobs
   → Overflow doesn't dominate the flow

✅ Small team
   → Less infrastructure to maintain
   → Simpler debugging
```

### Two Services is BETTER when:

```
✅ You need total failure isolation
   → A bug in worker cannot affect orchestration

✅ Jobs have highly variable duration (minutes to hours)
   → You need to scale workers independently
   → Orchestrator must stay agile

✅ Very high volume with extreme peaks
   → Granular auto-scaling is critical
   → You want to use Spot aggressively on workers

✅ Different SLAs per component
   → Orchestrator: high availability, low latency
   → Workers: best-effort, interruption tolerant

✅ Different teams work on each part
   → Independent releases
   → Clear ownership
```

### Hybrid is NOT recommended when:

```
❌ Jobs can frequently last hours
   → Pool gets saturated, everything goes to overflow
   → You lose the local latency benefit

❌ Files are very large (>1GB)
   → OOM risk that kills the entire process

❌ You need to scale to hundreds of workers
   → The overhead of each task includes unnecessary orchestrator

❌ Compliance requires strict isolation
   → A shared process may not meet requirements
```

---

## Recommendation for Your Specific Case

Given your scenario of 100,000 events/day with jobs ranging from 5 minutes to hours:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DECISION MATRIX                              │
│                                                                  │
│  Factor                          Weight  Hybrid   Two Services  │
│  ─────────────────────────────   ──────  ──────   ─────────────│
│  Variable duration (5min-hours)   30%     ⚠️ 6        ✅ 9      │
│  Volume (100k/day)                20%     ✅ 8        ✅ 8      │
│  Operational simplicity           20%     ✅ 9        ⚠️ 6      │
│  Failure resilience               15%     ⚠️ 6        ✅ 9      │
│  Cost                             10%     ✅ 7        ✅ 8      │
│  Latency                           5%     ✅ 9        ⚠️ 7      │
│  ─────────────────────────────────────────────────────────────  │
│  WEIGHTED SCORE                          7.05        8.05       │
│                                                                  │
│  RECOMMENDATION: Two Services                                    │
└─────────────────────────────────────────────────────────────────┘
```

**The decisive factor is the variable job duration.** When you have jobs that can last hours, the hybrid architecture loses its main advantage (local latency) because the pool will frequently be saturated and everything will go to overflow anyway.

However, if your actual distribution is:

- 90% of jobs < 10 minutes
- 10% of jobs > 10 minutes

Then the **Hybrid could work well** and would save you operational complexity.

---

Would you like me to dive deeper into any specific aspect or design the implementation of any of these architectures?



generate and ADR format with the options:

# Title
## Question
## Assumptions

## Options Concidered

### Option XYZ
#### Risk and impact
#### Pros
#### Cons


## Recommended option

### Dessisioning 
### Implication
#### Must
#### SHOULD
#### MAY



