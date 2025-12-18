
You're right, let me think through this conceptually. Here are the failure scenarios and recovery alternatives using Step Functions native Wait + Fargate download service.

---

## Failure Scenarios Analysis

### Scenario 1: Fargate Download Stuck for Hours

**What happens:**

- Step Function sends task token to Fargate
- Fargate starts download but gets stuck (network issue, OCP slow, resource exhaustion)
- Callback never arrives
- Step Function execution hangs indefinitely in `.waitForTaskToken` state

**Recovery Alternatives:**

#### Alternative 1A: Global Execution Timeout + Reprocess Queue

```
Step Function Execution
        │
        ├── TimeoutSeconds: 7200 (2 hours max)
        │
        └── On Timeout ──► Catch Block ──► Send to SQS (Reprocess Queue)
                                                    │
                                                    ▼
                                          New Step Function Execution
                                          (with retry counter incremented)
```

**How it works:**

- Set a global timeout on the entire State Machine (e.g., 2 hours)
- When timeout triggers, Catch block captures the error
- A "cleanup" state sends the failed item to a reprocess SQS queue
- A new execution starts from scratch with retry metadata
- After N retries, move to Dead Letter Queue for manual review

**Considerations:**

- Simple and native to Step Functions
- Loses all progress - restarts from beginning
- Need to track retry count in DynamoDB to prevent infinite loops

---

#### Alternative 1B: Heartbeat Pattern with Fargate

```
Step Function (.waitForTaskToken with HeartbeatSeconds)
        │
        │◄─────── Heartbeat every 5 min ───────┐
        │                                       │
        └── HeartbeatTimeout? ──► Catch ──► Reprocess    Fargate Service
                                                │         (sends heartbeats
                                                ▼          while downloading)
                                        Decision State
                                        ├── Retry same export job?
                                        └── Abandon and requeue?
```

**How it works:**

- Configure `HeartbeatSeconds: 300` on the wait state
- Fargate must send `SendTaskHeartbeat` every 5 minutes while working
- If no heartbeat received, Step Functions throws `States.HeartbeatTimeout`
- Catch block decides: retry the same export job or start fresh

**Considerations:**

- Detects stuck downloads faster (5 min vs 2 hours)
- Requires Fargate code changes to send heartbeats
- More operational visibility into "still working" vs "stuck"
- Can implement progressive timeouts (allow longer for larger files)

---

#### Alternative 1C: Parallel Timeout Monitor

```
                    ┌────────────────────────────┐
                    │       Parallel State        │
                    ├────────────────────────────┤
                    │                            │
        ┌───────────┴───────────┐    ┌──────────┴──────────┐
        │   Branch 1: Download   │    │  Branch 2: Watchdog  │
        │   .waitForTaskToken    │    │  Wait(7200s) → Fail  │
        └───────────────────────┘    └─────────────────────┘
                    │                            │
                    └────────────┬───────────────┘
                                 │
                    First to complete wins
                    │
                    ├── Download completed? → Continue normally
                    └── Watchdog fired? → Cancel & Reprocess
```

**How it works:**

- Wrap the download wait in a Parallel state with two branches
- Branch 1: Normal `.waitForTaskToken` waiting for Fargate
- Branch 2: Simple Wait state acting as a timeout bomb
- If watchdog completes first, it means download is stuck
- Catch the parallel failure and route to reprocessing

**Considerations:**

- More explicit timeout control
- Can have complex watchdog logic (check DynamoDB status, etc.)
- Higher transition costs (parallel branches)
- Native Step Functions - no external dependencies

---

### Scenario 2: OCP API Timeout

**What happens:**

- Lambda calls OCP Export API to create job or check status
- API times out or returns 5xx errors
- Lambda fails, Step Function state fails

**Recovery Alternatives:**

#### Alternative 2A: Native Step Functions Retry with Backoff

```
CreateExportJob State
        │
        ├── Retry Configuration:
        │   ├── ErrorEquals: [OCPTimeout, ServiceUnavailable]
        │   ├── MaxAttempts: 5
        │   ├── IntervalSeconds: 60
        │   ├── BackoffRate: 2.0
        │   └── MaxDelaySeconds: 900 (15 min max between retries)
        │
        └── After all retries exhausted ──► Catch ──► Park in DLQ
```

**How it works:**

- Step Functions native retry handles transient OCP failures
- Exponential backoff: 60s → 120s → 240s → 480s → 900s
- Total wait before giving up: ~30 minutes
- If still failing, assume OCP is down, park the execution

**Considerations:**

- Completely native, no additional components
- Execution stays "in flight" during retries (costs transitions)
- Good for transient failures
- For sustained outages, executions accumulate in retry loops

---

#### Alternative 2B: Fail Fast + External Requeue with Delay

```
CreateExportJob State
        │
        ├── Retry: MaxAttempts: 2 (quick retries only)
        │
        └── On Failure ──► Send to SQS with DelaySeconds: 900
                                    │
                                    ▼
                          (15 min later)
                          New Step Function Execution
```

**How it works:**

- Fail fast after 2 quick retries
- Push failed item to SQS with message delay (15 min)
- Execution ends, freeing resources
- SQS triggers a fresh execution later when OCP might be recovered

**Considerations:**

- Doesn't hold executions hostage during outages
- Lower cost - executions don't sit in retry loops
- Loses execution continuity (new execution = new execution ID)
- Better for sustained OCP outages

---

#### Alternative 2C: Circuit Breaker State in Step Functions

```
                    ┌─────────────────────────┐
                    │  Check Circuit Breaker   │
                    │  (Lambda reads DynamoDB) │
                    └─────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            Circuit CLOSED            Circuit OPEN
                    │                       │
                    ▼                       ▼
            Call OCP API            Wait State (5 min)
                    │                       │
                    │                       └──► Re-check circuit
                    │
            ┌───────┴───────┐
            ▼               ▼
        Success          Failure
            │               │
            ▼               ▼
        Continue      Record Failure
                      (may open circuit)
```

**How it works:**

- Before calling OCP, check circuit breaker state in DynamoDB
- If circuit OPEN, enter a Wait state instead of calling API
- After wait, re-check circuit state
- Failures increment counter; threshold opens circuit
- Prevents hammering a failing API

**Considerations:**

- Protects OCP API from thundering herd
- More complex state machine
- Requires DynamoDB for circuit state
- Self-healing when OCP recovers

---

### Scenario 3: System Collapse (Thread/Execution Overwhelm)

**What happens:**

- Sudden spike in reconciliation requests
- Too many concurrent Step Function executions
- Lambda concurrency exhausted
- Fargate tasks overwhelmed
- Everything starts timing out or throttling

**Recovery Alternatives:**

#### Alternative 3A: SQS-Based Throttling at Entry Point

```
                    ┌─────────────────────────┐
    Reconciliation  │      SQS Queue          │
    Requests ──────►│  (Buffer + Rate Limit)  │
                    └─────────────────────────┘
                                │
                    Lambda Trigger with:
                    ├── BatchSize: 5
                    ├── MaximumConcurrency: 10
                    │
                    ▼
            Max 50 concurrent SF executions
```

**How it works:**

- SQS acts as a buffer absorbing spikes
- Lambda trigger with `MaximumConcurrency` limits parallel processing
- Step Functions executions are rate-limited at source
- During collapse, messages wait safely in SQS

**Considerations:**

- Prevention is better than cure
- SQS provides natural backpressure
- Messages have 14-day retention - won't be lost
- Slows processing during spikes but maintains stability

---

#### Alternative 3B: Execution Capacity Check Before Starting

```
                    ┌─────────────────────────┐
                    │ Check System Capacity    │
                    │ (Lambda)                 │
                    └─────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            Capacity OK             Capacity FULL
                    │                       │
                    ▼                       ▼
            Continue Flow           Requeue with Delay
                                    (Back to SQS, +5 min)
```

**How it works:**

- First state checks current system load:
    - Count running SF executions (CloudWatch metric or API)
    - Check Fargate task count
    - Check Lambda concurrency availability
- If over threshold, don't proceed - requeue for later
- Self-regulating system

**Considerations:**

- Adds latency (capacity check on every execution)
- Prevents cascade failures
- Graceful degradation under load
- Need to define capacity thresholds

---

#### Alternative 3C: Priority Queues for Recovery

```
    ┌─────────────────┐     ┌─────────────────┐
    │  Normal Queue   │     │ Priority Queue   │
    │  (new requests) │     │ (retries/stuck)  │
    └────────┬────────┘     └────────┬─────────┘
             │                       │
             │   Priority consumer   │
             │   processes Priority  │
             │   Queue first         │
             └───────────┬───────────┘
                         │
                         ▼
                 Step Function Execution
```

**How it works:**

- Separate queues for new vs retry/recovery items
- During collapse recovery, prioritize completing stuck items
- New requests can wait while system catches up
- Prevents starvation of retried items

**Considerations:**

- More complex queue setup
- Clear prioritization during recovery
- Helps drain backlog faster
- Requires careful consumer logic

---

## Recovery Pattern Comparison

|Pattern|Best For|Complexity|Cost Impact|Recovery Speed|
|---|---|---|---|---|
|**Global Timeout + Requeue**|Stuck downloads|Low|Medium|Slow (waits full timeout)|
|**Heartbeat Pattern**|Long downloads|Medium|Low|Fast (detects in minutes)|
|**Parallel Watchdog**|Precise timeout control|Medium|High (extra transitions)|Configurable|
|**Native Retry + Backoff**|Transient API failures|Low|Medium|Auto (exponential)|
|**Fail Fast + Delayed Requeue**|Sustained outages|Low|Low|Medium|
|**Circuit Breaker State**|Protecting failing APIs|High|Medium|Self-healing|
|**SQS Throttling**|Preventing collapse|Low|Low|N/A (prevention)|
|**Capacity Check**|Graceful degradation|Medium|Low|Adaptive|
|**Priority Queues**|Recovery prioritization|Medium|Low|Prioritized|

---

## Recommended Combination

For a robust system, I'd suggest combining:

1. **Heartbeat Pattern** for download monitoring (detect stuck Fargate fast)
2. **Native Retry + Backoff** for OCP API calls (handle transient failures)
3. **SQS Throttling** at entry point (prevent system collapse)
4. **Priority Queue** for retries (ensure failed items get processed)

This gives you:

- Fast detection of stuck downloads
- Automatic recovery from transient failures
- Protection against traffic spikes
- Prioritized recovery when things go wrong

Would you like me to elaborate on any of these patterns or think through the interaction between them?




# Heartbeat Pattern Implementation with Orchestrator + Worker Architecture

## The Challenge

With two separate Fargate services, the question becomes: **Who owns the Task Token and sends heartbeats to Step Functions?**

```
Step Function
     │
     └── .waitForTaskToken (HeartbeatSeconds: 300)
              │
              │  Who sends heartbeats?
              │  Who sends final callback?
              ▼
        ┌─────────────────────────────────────────────┐
        │                                             │
        │   Orchestrator ──────► Worker              │
        │   (lightweight)        (heavy)             │
        │                                             │
        └─────────────────────────────────────────────┘
```

---

## Alternative A: Orchestrator Owns Token, Worker Reports Progress

**Concept:** Orchestrator keeps the Task Token and is responsible for heartbeats. Worker reports progress to a shared state (DynamoDB), and Orchestrator monitors it.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ALTERNATIVE A                                       │
│                  Orchestrator Owns Token + Monitors Worker                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Step Function                                                             │
│        │                                                                    │
│        │ TaskToken                                                          │
│        ▼                                                                    │
│   ┌─────────┐      SQS 1        ┌─────────────────────────────────────┐    │
│   │ Lambda  │─────────────────► │         ORCHESTRATOR                │    │
│   │ Notify  │                   │         (Fargate)                   │    │
│   └─────────┘                   │                                     │    │
│                                 │  1. Receive ExportJob + TaskToken   │    │
│                                 │  2. Store TaskToken in memory/map   │    │
│                                 │  3. Dispatch download task to SQS 2 │    │
│                                 │  4. Start heartbeat loop            │    │
│                                 │     └── Every 4 min:                │    │
│                                 │         ├── Check DynamoDB progress │    │
│                                 │         ├── If progress updated:    │    │
│                                 │         │   └── SendTaskHeartbeat   │    │
│                                 │         └── If stale > 10 min:      │    │
│                                 │             └── Mark as stuck       │    │
│                                 │  5. On completion signal:           │    │
│                                 │     └── SendTaskSuccess             │    │
│                                 └─────────────────┬───────────────────┘    │
│                                                   │                         │
│                                          SQS 2    │                         │
│                                        (Download) │                         │
│                                                   ▼                         │
│                                 ┌─────────────────────────────────────┐    │
│                                 │           WORKER                    │    │
│                                 │          (Fargate)                  │    │
│                                 │                                     │    │
│                                 │  1. Receive download task           │    │
│                                 │  2. Start download from OCP         │    │
│                                 │  3. Every 2 min: Update DynamoDB    │    │
│                                 │     └── { status, bytesDownloaded,  │    │
│                                 │          lastUpdated, progress% }   │    │
│                                 │  4. On complete: Update DynamoDB    │    │
│                                 │     └── { status: COMPLETED }       │    │
│                                 └─────────────────────────────────────┘    │
│                                                                             │
│                                 ┌─────────────────────────────────────┐    │
│                                 │          DynamoDB                   │    │
│                                 │     (Shared Progress State)         │    │
│                                 │                                     │    │
│                                 │  PK: DOWNLOAD#{exportJobId}         │    │
│                                 │  status: IN_PROGRESS | COMPLETED    │    │
│                                 │  bytesDownloaded: 1542000           │    │
│                                 │  totalBytes: 5000000                │    │
│                                 │  lastUpdated: 2024-01-15T10:30:00Z  │    │
│                                 │  workerTaskId: abc-123              │    │
│                                 └─────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Heartbeat Flow:**

```
Timeline (HeartbeatSeconds: 300 = 5 min)
─────────────────────────────────────────────────────────────────────────────►

T+0        T+2min     T+4min     T+5min      T+6min     T+8min     T+10min
 │          │          │          │           │          │          │
 │          │          │          │           │          │          │
 ▼          ▼          ▼          ▼           ▼          ▼          ▼
Start    Worker     Orch       SF would    Worker    Orch       Complete
Download updates    checks     timeout     updates   sends      Worker
         DynamoDB   DynamoDB   HERE ───►   DynamoDB  Heartbeat  signals
                    sends                            to SF      done
                    Heartbeat                                      │
                    to SF                                          ▼
                       │                                     Orch sends
                       │                                     TaskSuccess
                       └─────── Heartbeat resets SF timer ──────────┘
```

**Pros:**

- Clean separation: Worker focuses on download, knows nothing about Step Functions
- Orchestrator has full control over Task Token lifecycle
- Can implement smart logic (detect stuck workers, reassign tasks)
- Worker can be stateless and auto-scaled independently

**Cons:**

- Orchestrator must maintain in-memory map of TaskTokens (or store in DynamoDB)
- Orchestrator becomes stateful - needs careful handling of restarts
- Additional DynamoDB reads for progress monitoring
- Slight delay in heartbeat (Orchestrator polls, doesn't get real-time updates)

---

## Alternative B: Worker Owns Token Directly

**Concept:** Task Token flows through SQS to Worker. Worker sends heartbeats and final callback directly.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ALTERNATIVE B                                       │
│                      Worker Owns Token Directly                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Step Function                                                             │
│        │                                                                    │
│        │ TaskToken                                                          │
│        ▼                                                                    │
│   ┌─────────┐      SQS 1        ┌─────────────────────────────────────┐    │
│   │ Lambda  │─────────────────► │         ORCHESTRATOR                │    │
│   │ Notify  │  (includes        │         (Fargate)                   │    │
│   └─────────┘   TaskToken)      │                                     │    │
│                                 │  1. Receive ExportJob + TaskToken   │    │
│                                 │  2. Enrich with metadata            │    │
│                                 │  3. Forward to SQS 2 WITH TaskToken │    │
│                                 │  4. Done (stateless pass-through)   │    │
│                                 └─────────────────┬───────────────────┘    │
│                                                   │                         │
│                                          SQS 2    │ (includes TaskToken)    │
│                                                   ▼                         │
│                                 ┌─────────────────────────────────────┐    │
│                                 │           WORKER                    │    │
│                                 │          (Fargate)                  │    │
│                                 │                                     │    │
│                                 │  1. Receive task + TaskToken        │    │
│                                 │  2. Start download                  │    │
│                                 │  3. Heartbeat thread:               │    │
│                                 │     └── Every 4 min:                │    │
│                                 │         └── SendTaskHeartbeat(token)│    │
│                                 │  4. On complete:                    │    │
│                                 │     └── SendTaskSuccess(token)      │    │
│                                 │  5. On failure:                     │    │
│                                 │     └── SendTaskFailure(token)      │    │
│                                 └─────────────────────────────────────┘    │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  RISK: What if Worker crashes mid-download?                         │  │
│   │        - TaskToken is lost (was only in Worker memory)              │  │
│   │        - SF waits until HeartbeatTimeout                            │  │
│   │        - No way to resume - must restart entire flow                │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Pros:**

- Simpler flow - Token goes directly to executor
- Orchestrator is stateless pass-through
- Real-time heartbeats (no polling delay)
- Fewer components involved

**Cons:**

- Worker must understand Step Functions API (coupling)
- If Worker crashes, TaskToken is lost
- Harder to implement "reassign to another worker" logic
- Worker becomes responsible for AWS SDK calls (heavier)
- SQS message size includes TaskToken (tokens can be large)

---

## Alternative C: Orchestrator with Persistent Token Store

**Concept:** Similar to A, but TaskTokens stored in DynamoDB for crash recovery.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ALTERNATIVE C                                       │
│              Orchestrator + Persistent Token Store (DynamoDB)                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Step Function                                                             │
│        │                                                                    │
│        │ TaskToken                                                          │
│        ▼                                                                    │
│   ┌─────────┐      SQS 1        ┌─────────────────────────────────────┐    │
│   │ Lambda  │─────────────────► │         ORCHESTRATOR                │    │
│   │ Notify  │                   │         (Fargate)                   │    │
│   └─────────┘                   │                                     │    │
│                                 │  1. Receive ExportJob + TaskToken   │    │
│                                 │  2. Store TaskToken in DynamoDB ◄───┼─┐  │
│                                 │  3. Dispatch to SQS 2               │ │  │
│                                 │  4. Heartbeat loop (same as A)      │ │  │
│                                 └─────────────────────────────────────┘ │  │
│                                                                         │  │
│   ┌─────────────────────────────────────────────────────────────────┐   │  │
│   │                    DynamoDB (Task Tokens)                       │◄──┘  │
│   │                                                                 │      │
│   │  PK: TASK#{exportJobId}                                        │      │
│   │  taskToken: "AAAAKgAAAAI..."                                   │      │
│   │  sfExecutionArn: "arn:aws:states:..."                          │      │
│   │  status: PENDING | IN_PROGRESS | COMPLETED                     │      │
│   │  assignedWorker: worker-task-abc                               │      │
│   │  createdAt: 2024-01-15T10:00:00Z                              │      │
│   │  lastHeartbeat: 2024-01-15T10:08:00Z                          │      │
│   │  TTL: 1705320000 (auto-cleanup after 24h)                      │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  RECOVERY SCENARIO: Orchestrator crashes and restarts               │  │
│   │                                                                     │  │
│   │  1. New Orchestrator instance starts                                │  │
│   │  2. Scans DynamoDB for status=IN_PROGRESS tasks                    │  │
│   │  3. Resumes heartbeat monitoring for each                          │  │
│   │  4. No TaskTokens lost, no SF executions timeout                   │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Recovery Flow After Orchestrator Crash:**

```
Orchestrator Crash & Recovery
─────────────────────────────────────────────────────────────────────────────►

T+0        T+3min     T+4min          T+5min     T+6min     T+8min
 │          │          │               │          │          │
 │          │          │               │          │          │
 ▼          ▼          ▼               ▼          ▼          ▼
Running   Orch      New Orch        SF would    Recovered  Normal
normally  CRASHES   starts          timeout     Orch sends operation
    │                  │             HERE       heartbeat   resumes
    │                  │               │           │
    │                  ▼               │           │
    │            Scan DynamoDB         │           │
    │            Find IN_PROGRESS      │           │
    │            Resume monitoring ────┴───────────┘
    │
    └── TaskToken safe in DynamoDB, not lost with crash
```

**Pros:**

- Crash-resistant: TaskTokens survive Orchestrator restarts
- Can implement "orphan detection" - find tasks with stale lastHeartbeat
- Full audit trail of task lifecycle
- Multiple Orchestrator instances can share load (with locking)

**Cons:**

- Additional DynamoDB writes (token storage)
- More complex Orchestrator startup (recovery scan)
- Need TTL or cleanup for completed tasks
- Slightly higher latency (DynamoDB write before dispatch)

---

## Alternative D: Dedicated Heartbeat Monitor Service

**Concept:** Third lightweight service solely responsible for heartbeats, decoupled from both Orchestrator and Worker.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ALTERNATIVE D                                       │
│                  Dedicated Heartbeat Monitor Service                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Step Function                                                             │
│        │                                                                    │
│        │ TaskToken                                                          │
│        ▼                                                                    │
│   ┌─────────┐                   ┌─────────────────────────────────────┐    │
│   │ Lambda  │                   │         ORCHESTRATOR                │    │
│   │ Notify  │──────────────────►│  - Dispatch downloads               │    │
│   └────┬────┘                   │  - NO heartbeat responsibility      │    │
│        │                        └─────────────────────────────────────┘    │
│        │                                                                    │
│        │  Store TaskToken       ┌─────────────────────────────────────┐    │
│        └───────────────────────►│          DynamoDB                   │    │
│                                 │     (Central Token Registry)        │    │
│                                 └──────────────┬──────────────────────┘    │
│                                                │                            │
│                         ┌──────────────────────┼──────────────────────┐    │
│                         │                      │                      │    │
│                         ▼                      ▼                      ▼    │
│   ┌─────────────────────────┐  ┌─────────────────────────┐  ┌──────────┐  │
│   │   HEARTBEAT MONITOR     │  │        WORKER           │  │  Worker  │  │
│   │   (Fargate - tiny)      │  │       (Fargate)         │  │    N     │  │
│   │   0.25 vCPU, 256MB      │  │                         │  │          │  │
│   │                         │  │  - Download files       │  │          │  │
│   │  Every 60 seconds:      │  │  - Update progress      │  │          │  │
│   │  1. Scan DynamoDB for   │  │    in DynamoDB          │  │          │  │
│   │     active tasks        │  │  - No SF interaction    │  │          │  │
│   │  2. Check lastUpdated   │  │                         │  │          │  │
│   │  3. If progress recent: │  └─────────────────────────┘  └──────────┘  │
│   │     └─ SendHeartbeat    │                                              │
│   │  4. If stale > 10min:   │                                              │
│   │     └─ SendTaskFailure  │                                              │
│   │  5. If complete:        │                                              │
│   │     └─ SendTaskSuccess  │                                              │
│   └─────────────────────────┘                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Heartbeat Monitor Scanning Logic:**

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    Heartbeat Monitor - Every 60 seconds                     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  Query: status = IN_PROGRESS AND needsHeartbeat = true                     │
│                                                                            │
│  For each task:                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                                                                    │   │
│  │  lastWorkerUpdate = now() - task.lastUpdated                       │   │
│  │  lastHeartbeatSent = now() - task.lastHeartbeat                    │   │
│  │                                                                    │   │
│  │  IF task.status == COMPLETED:                                      │   │
│  │     └── SendTaskSuccess(taskToken, result)                         │   │
│  │         Update task: status=CALLBACK_SENT                          │   │
│  │                                                                    │   │
│  │  ELSE IF task.status == FAILED:                                    │   │
│  │     └── SendTaskFailure(taskToken, error)                          │   │
│  │         Update task: status=CALLBACK_SENT                          │   │
│  │                                                                    │   │
│  │  ELSE IF lastWorkerUpdate > 10 minutes:                            │   │
│  │     └── Worker is stuck!                                           │   │
│  │         SendTaskFailure(taskToken, "WORKER_STUCK")                 │   │
│  │         Update task: status=TIMED_OUT                              │   │
│  │                                                                    │   │
│  │  ELSE IF lastHeartbeatSent > 4 minutes:                            │   │
│  │     └── Time to send heartbeat                                     │   │
│  │         SendTaskHeartbeat(taskToken)                               │   │
│  │         Update task: lastHeartbeat=now()                           │   │
│  │                                                                    │   │
│  │  ELSE:                                                             │   │
│  │     └── Nothing to do, skip                                        │   │
│  │                                                                    │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Pros:**

- Complete separation of concerns
- Workers know nothing about Step Functions
- Orchestrator knows nothing about heartbeats
- Single point for all SF callback logic
- Easy to monitor and alert on
- Can be Lambda instead of Fargate (runs every minute)

**Cons:**

- Additional service to deploy and maintain
- Slight delay in heartbeats (polling-based, up to 60s)
- All eggs in one basket - if monitor fails, all heartbeats stop
- More DynamoDB reads (scanning for active tasks)

---

## Alternative E: EventBridge + Lambda Scheduled Heartbeats

**Concept:** Instead of Fargate monitor, use EventBridge scheduled rule + Lambda for heartbeats.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ALTERNATIVE E                                       │
│              EventBridge Scheduled Lambda for Heartbeats                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                     ┌──────────────────────────────┐                        │
│                     │    EventBridge Rule          │                        │
│                     │    rate(1 minute)            │                        │
│                     └──────────────┬───────────────┘                        │
│                                    │                                        │
│                                    ▼                                        │
│                     ┌──────────────────────────────┐                        │
│                     │   Heartbeat Lambda           │                        │
│                     │   (Serverless)               │                        │
│                     │                              │                        │
│                     │   1. Query DynamoDB          │                        │
│                     │   2. Process each active     │                        │
│                     │   3. Send heartbeats/results │                        │
│                     └──────────────────────────────┘                        │
│                                    │                                        │
│                                    ▼                                        │
│                     ┌──────────────────────────────┐                        │
│                     │        DynamoDB              │                        │
│                     │   (Tasks + Tokens + Status)  │                        │
│                     └──────────────────────────────┘                        │
│                                    ▲                                        │
│                                    │                                        │
│   ┌────────────────────────────────┴────────────────────────────────────┐  │
│   │                                                                      │  │
│   │   Orchestrator                              Worker(s)                │  │
│   │   - Creates task record                     - Updates progress       │  │
│   │   - Stores TaskToken                        - Sets COMPLETED status  │  │
│   │                                                                      │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Pros:**

- Fully serverless - no Fargate for monitoring
- Pay only when Lambda runs (cost efficient)
- Automatic scaling and high availability
- EventBridge guarantees execution

**Cons:**

- Lambda cold starts could add latency
- 1-minute minimum granularity with EventBridge rate
- Need to handle Lambda timeout for large task counts
- Fan-out pattern needed if many concurrent tasks

---

## Comparison Matrix

|Aspect|Alt A: Orch In-Memory|Alt B: Worker Direct|Alt C: Orch + DynamoDB|Alt D: Dedicated Monitor|Alt E: EB + Lambda|
|---|---|---|---|---|---|
|**Token Owner**|Orchestrator (memory)|Worker|Orchestrator (DynamoDB)|Lambda/Monitor|Lambda|
|**Crash Recovery**|❌ Lost|❌ Lost|✅ Recoverable|✅ Recoverable|✅ Recoverable|
|**Worker Complexity**|Low|High|Low|Lowest|Lowest|
|**Orchestrator Complexity**|High|Low|High|Low|Low|
|**Additional Components**|None|None|None|1 (Monitor)|2 (EB + Lambda)|
|**Heartbeat Latency**|~4 min (polling)|Real-time|~4 min (polling)|~1 min (scanning)|~1 min (scheduled)|
|**Serverless**|No (Fargate)|No (Fargate)|No (Fargate)|Optional|Yes|
|**Cost**|Medium|Medium|Medium|Low-Medium|Lowest|
|**Scalability**|Good|Good|Good|Excellent|Excellent|
|**Stuck Detection**|✅|❌ (only timeout)|✅|✅|✅|

---

## Recommended Approach

For your Orchestrator + Worker architecture, I recommend **Alternative C + E Hybrid**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RECOMMENDED: C + E HYBRID                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Step Function                                                             │
│        │                                                                    │
│        │ TaskToken         ┌────────────────────────────────┐              │
│        ▼                   │   EventBridge (every 1 min)    │              │
│   ┌─────────┐              └───────────────┬────────────────┘              │
│   │ Lambda  │──┐                           │                               │
│   │ Notify  │  │                           ▼                               │
│   └─────────┘  │           ┌───────────────────────────────┐               │
│                │           │    Heartbeat Lambda           │               │
│                │           │    - Scan active tasks        │               │
│                │           │    - Send heartbeats          │               │
│                │           │    - Detect stuck workers     │               │
│                │           │    - Send final callbacks     │               │
│                │           └───────────────┬───────────────┘               │
│                │                           │                               │
│                │   ┌───────────────────────┼───────────────────────┐       │
│                │   │                       │                       │       │
│                ▼   ▼                       ▼                       │       │
│         ┌─────────────────────────────────────────────────────┐   │       │
│         │                    DynamoDB                          │   │       │
│         │  ┌─────────────────────────────────────────────────┐│   │       │
│         │  │ PK: TASK#{exportJobId}                          ││   │       │
│         │  │ taskToken: "AAAA..."                            ││   │       │
│         │  │ status: IN_PROGRESS                             ││   │       │
│         │  │ workerProgress: { bytes: 1.5M, total: 5M }      ││◄──┘       │
│         │  │ lastWorkerUpdate: 2024-01-15T10:28:00Z          ││           │
│         │  │ lastHeartbeat: 2024-01-15T10:26:00Z            ││           │
│         │  └─────────────────────────────────────────────────┘│           │
│         └──────────────────────┬──────────────────────────────┘           │
│                                │                                           │
│              ┌─────────────────┴─────────────────┐                         │
│              ▼                                   ▼                         │
│   ┌─────────────────────┐             ┌─────────────────────┐             │
│   │    ORCHESTRATOR     │   SQS 2    │       WORKER         │             │
│   │    (Fargate)        │──────────► │      (Fargate)       │             │
│   │                     │            │                       │             │
│   │ - Receive from SQS1 │            │ - Download files      │             │
│   │ - Store TaskToken   │            │ - Update DynamoDB     │             │
│   │ - Dispatch to SQS2  │            │   progress every 2min │             │
│   │ - NO heartbeating   │            │ - Set COMPLETED/FAILED│             │
│   └─────────────────────┘            └───────────────────────┘             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why this combination:**

1. **Crash-proof**: TaskTokens in DynamoDB survive any service restart
2. **Fully serverless heartbeats**: Lambda scales automatically, no Fargate to manage
3. **Clean separation**:
    - Orchestrator: dispatch only
    - Worker: download only
    - Lambda: SF communication only
4. **Cost efficient**: Lambda runs 1 min, scales with active tasks
5. **Stuck detection**: Lambda can detect workers that stopped updating
6. **Easy monitoring**: Single Lambda to alert on failures

Would you like me to detail the DynamoDB schema design or the state transitions for this approach?