
Now I have the full context. Let me create a comprehensive ADR analyzing the orchestration options.

# Architecture Decision Record: Workflow Orchestration Strategy

## Question

Should the Export Processing Service use AWS Step Functions with EventBridge Scheduler (Callback Pattern with Task Tokens), pure SQS-based orchestration, or another orchestration mechanism to handle 100,000 daily export jobs with variable durations (5 minutes to hours) that require polling an external Export API?

## Assumptions

1. **External API Behavior**: The Export API does not support webhooks/callbacks; polling is required to check job status
2. **Job Duration**: Highly variable, ranging from 5 minutes to several hours
3. **Volume**: 100,000 events per day with non-uniform distribution
4. **Polling Requirements**: Need to check Export API status every 3-5 minutes until job completes
5. **Cost Sensitivity**: Cost optimization is important at this scale
6. **Serverless Preference**: Team prefers managed/serverless solutions when practical
7. **Observability**: End-to-end workflow visibility is valuable for operations
8. **Error Handling**: Complex retry logic and error handling requirements
9. **State Management**: Need to track job progress, attempts, and handle timeouts
10. **Integration Points**: Must integrate with SQS (input), DynamoDB (metadata), S3 (output), and external Export API

## Options Considered

### Option 1: Pure SQS-Based Orchestration (Two Services)

A simple architecture using SQS queues for coordination between an Orchestrator service and Worker services, with application-level state management.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PURE SQS ORCHESTRATION                            │
│                                                                      │
│  ┌──────────────────┐                    ┌──────────────────┐       │
│  │   Orchestrator   │                    │     Workers      │       │
│  │   (Fargate)      │                    │    (Fargate)     │       │
│  │                  │                    │                  │       │
│  │  • Poll SQS 1    │                    │  • Poll SQS 2    │       │
│  │  • Call Export   │                    │  • Download      │       │
│  │    API           │                    │  • Extract       │       │
│  │  • Dispatch      │                    │  • Upload S3     │       │
│  │    tasks         │                    │                  │       │
│  └────────┬─────────┘                    └────────┬─────────┘       │
│           │                                       │                  │
│           ▼                                       ▼                  │
│      ┌─────────┐      ─────────────────▶    ┌─────────┐            │
│      │  SQS 1  │                            │  SQS 2  │            │
│      │ExportJob│                            │Download │            │
│      └─────────┘                            └─────────┘            │
│                                                                      │
│  State Management: Application code + DynamoDB                      │
│  Polling: Implemented in Orchestrator service                       │
│  Retry Logic: SQS redrive + application code                        │
└─────────────────────────────────────────────────────────────────────┘
```

**How Polling Works:**

- Orchestrator calls Export API to create job
- Orchestrator implements polling loop (with delays) to check status
- When ready, dispatches download tasks to SQS 2
- Long-running jobs extend SQS visibility timeout via heartbeat

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|Polling logic complexity in application|High|Medium|Well-tested polling module|
|Visibility timeout management complexity|High|Medium|Heartbeat pattern|
|State scattered across services|Medium|Medium|Centralized DynamoDB state|
|Long-running jobs block Orchestrator resources|High|Medium|Async/non-blocking design|
|Difficult to visualize workflow state|Medium|Low|Custom dashboards|

#### Pros

- **Simplicity**: Straightforward architecture with well-understood components
- **Full Control**: Complete control over polling logic, intervals, and retry behavior
- **Low Latency**: Direct processing without orchestration overhead
- **Cost Predictable**: Fargate costs based on task size and count
- **No Orchestration Limits**: No Step Functions state transition limits
- **Team Familiarity**: Team already comfortable with SQS patterns
- **Flexible Scaling**: Independent scaling of orchestration and processing
- **No Vendor Lock-in**: Standard patterns portable to other clouds

#### Cons

- **Manual State Management**: Must implement workflow state tracking
- **Complex Error Handling**: Custom retry, timeout, and failure logic required
- **Limited Visibility**: No built-in workflow visualization
- **Polling in Application**: Service stays busy during long waits
- **Coordination Complexity**: Must implement distributed coordination patterns
- **Testing Complexity**: Harder to test workflow edge cases
- **No Built-in Audit Trail**: Must implement execution history tracking

---

### Option 2: Step Functions with Internal Wait Loop

Use Step Functions with built-in Wait states and Choice states for polling logic.

```
┌─────────────────────────────────────────────────────────────────────┐
│              STEP FUNCTIONS - INTERNAL WAIT LOOP                     │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     Step Functions Workflow                     │ │
│  │                                                                 │ │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐       │ │
│  │  │ Create  │──▶│  Wait   │──▶│  Check  │──▶│ Choice  │       │ │
│  │  │  Job    │   │ (3 min) │   │ Status  │   │         │       │ │
│  │  └─────────┘   └─────────┘   └─────────┘   └────┬────┘       │ │
│  │                                                  │            │ │
│  │                     ┌────────────────────────────┤            │ │
│  │                     │                            │            │ │
│  │                     ▼                            ▼            │ │
│  │              ┌─────────────┐            ┌─────────────┐      │ │
│  │              │ IN_PROGRESS │            │  COMPLETED  │      │ │
│  │              │ (loop back) │            │  (proceed)  │      │ │
│  │              └──────┬──────┘            └──────┬──────┘      │ │
│  │                     │                          │              │ │
│  │                     └──────────┐    ┌──────────┘              │ │
│  │                                ▼    ▼                         │ │
│  │                           ┌──────────────┐                    │ │
│  │                           │   Process    │                    │ │
│  │                           │   Downloads  │                    │ │
│  │                           └──────────────┘                    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  Cost Model: Charged for EVERY state transition                     │
│  Wait State: STILL COUNTS as billable transition                    │
└─────────────────────────────────────────────────────────────────────┘
```

**Cost Calculation:**

```
Per job polling cycle:
- CreateJob: 1 transition
- Wait: 1 transition  
- CheckStatus: 1 transition
- Choice: 1 transition
= 4 transitions per poll

If job takes 45 min average, polling every 3 min = 15 polls
15 polls × 4 transitions = 60 transitions per job

100,000 jobs/day × 60 transitions = 6,000,000 transitions/day
@ $0.025 per 1000 = $150/day = $4,500/month
```

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|High cost at scale|Very High|High|None - inherent to pattern|
|State transition throttling|Medium|High|Request limit increase|
|1-year execution timeout|Low|Medium|Acceptable for this use case|
|Complexity with Map state + polling|Medium|Medium|Careful design|

#### Pros

- **Visual Workflow**: Built-in visualization in AWS Console
- **Built-in Error Handling**: Retry, catch, and timeout built into ASL
- **Execution History**: Complete audit trail of every execution
- **Simple Architecture**: Fewer moving parts than callback pattern
- **Native Integration**: Direct integration with Lambda, DynamoDB, etc.
- **State Management**: Step Functions manages all state
- **Easy Testing**: Step Functions Local for local testing

#### Cons

- **Extremely High Cost**: $4,500+/month for 100K jobs (vs ~$50 with callback pattern)
- **Billable Wait States**: Wait states still count as transitions
- **State Transition Limits**: 2,000 transitions/second soft limit
- **Execution History Limits**: 25,000 events per execution
- **Long Execution Risk**: Jobs lasting hours consume quota
- **Inflexible Polling**: Interval fixed in workflow definition
- **Not Cost-Effective**: 10-100x more expensive than alternatives

---

### Option 3: Step Functions with EventBridge Scheduler Callback Pattern

Externalize polling to EventBridge Scheduler using Task Tokens for zero-cost waiting. This is the pattern described in the uploaded document.

```
┌─────────────────────────────────────────────────────────────────────┐
│         STEP FUNCTIONS + EVENTBRIDGE SCHEDULER CALLBACK             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                Step Functions Workflow                          │ │
│  │                                                                 │ │
│  │  ┌──────────┐   ┌──────────────────┐   ┌──────────────────┐   │ │
│  │  │  Create  │──▶│ Save TaskToken   │──▶│    WAIT STATE    │   │ │
│  │  │   Job    │   │ + Create         │   │   (Cost: $0)     │   │ │
│  │  │          │   │   Scheduler      │   │                  │   │ │
│  │  └──────────┘   └──────────────────┘   └────────┬─────────┘   │ │
│  │                                                  │             │ │
│  │                           SendTaskSuccess ───────┘             │ │
│  │                                  ▲                             │ │
│  │  ┌────────────────────────────────────────────────────────┐   │ │
│  │  │                    After Resume                         │   │ │
│  │  │  ┌──────────┐   ┌──────────┐   ┌──────────┐           │   │ │
│  │  │  │ Download │──▶│ Process  │──▶│ Complete │           │   │ │
│  │  │  │  Files   │   │  & Upload│   │          │           │   │ │
│  │  │  └──────────┘   └──────────┘   └──────────┘           │   │ │
│  │  └────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              External Polling Engine                            │ │
│  │                                                                 │ │
│  │  ┌─────────────────┐        ┌─────────────────┐               │ │
│  │  │   EventBridge   │───────▶│  Lambda Poller  │               │ │
│  │  │   Scheduler     │        │                 │               │ │
│  │  │  (every 3 min)  │        │  • Get Token    │               │ │
│  │  └─────────────────┘        │  • Check API    │               │ │
│  │                             │  • SendTask     │               │ │
│  │         ┌───────────────────│    Success      │               │ │
│  │         │                   └─────────────────┘               │ │
│  │         ▼                                                      │ │
│  │  ┌─────────────────┐                                          │ │
│  │  │    DynamoDB     │  Stores: jobId, taskToken, attempts      │ │
│  │  │  (Task Tokens)  │                                          │ │
│  │  └─────────────────┘                                          │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Cost Calculation:**

```
Per job:
- CreateJob: 1 transition
- SaveToken + CreateScheduler: 1 transition
- Wait (callback): $0 (no transition until callback)
- Resume after callback: 1 transition
- Process steps: ~3 transitions
= ~6 transitions per job (vs 60 in Option 2)

100,000 jobs/day × 6 transitions = 600,000 transitions/day
@ $0.025 per 1000 = $15/day

EventBridge Scheduler:
- 100,000 schedules created/deleted per day: $0 (free tier covers)
- Schedule invocations: ~1.5M/day @ $1/million = $1.50/day

Lambda Poller:
- ~1.5M invocations @ 500ms avg: ~$10/day

DynamoDB:
- Read/Write for tokens: ~$3/day

Total: ~$30/day = $900/month (vs $4,500 for Option 2)
```

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|Architectural complexity|High|Medium|Good documentation, team training|
|Task Token management complexity|Medium|Medium|Robust DynamoDB schema|
|Scheduler creation/deletion overhead|Medium|Low|Batch operations|
|Lambda poller failure orphans workflow|Medium|High|TTL + cleanup job|
|Debugging distributed flow|Medium|Medium|Correlation IDs, structured logs|

#### Pros

- **87% Cost Savings**: $900/month vs $4,500/month for internal wait loop
- **Zero-Cost Waiting**: Task Token callback pattern costs nothing while waiting
- **Visual Workflow**: Still get Step Functions visualization
- **Flexible Polling**: Can adjust interval per job type
- **Scalable**: Handles millions of jobs per day
- **Built-in Error Handling**: Step Functions retry/catch for processing steps
- **Audit Trail**: Full execution history
- **Serverless**: No persistent infrastructure to manage
- **Timeout Handling**: Can implement max wait time with TTL

#### Cons

- **Increased Complexity**: More components (Scheduler, Lambda, DynamoDB)
- **Distributed State**: Token stored separately from workflow
- **Debugging Difficulty**: Flow spans multiple services
- **Scheduler Management**: Must create/delete schedules per job
- **Learning Curve**: Team must understand callback pattern
- **Potential Orphans**: Failed pollers can leave workflows stuck
- **Cold Start Latency**: Lambda poller has cold start overhead
- **More Failure Points**: More components = more potential failures

---

### Option 4: EventBridge-Driven Choreography

A fully event-driven approach using EventBridge as the central event bus with Lambda functions reacting to events.

```
┌─────────────────────────────────────────────────────────────────────┐
│              EVENTBRIDGE-DRIVEN CHOREOGRAPHY                         │
│                                                                      │
│                    ┌─────────────────────┐                          │
│                    │    EventBridge      │                          │
│                    │    (Event Bus)      │                          │
│                    └──────────┬──────────┘                          │
│                               │                                      │
│         ┌─────────────────────┼─────────────────────┐               │
│         │                     │                     │               │
│         ▼                     ▼                     ▼               │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐        │
│  │ job.created │      │ job.ready   │      │ job.failed  │        │
│  └──────┬──────┘      └──────┬──────┘      └──────┬──────┘        │
│         │                    │                    │                 │
│         ▼                    ▼                    ▼                 │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐        │
│  │   Lambda    │      │   Lambda    │      │   Lambda    │        │
│  │ StartPoller │      │  Download   │      │   Alert     │        │
│  └─────────────┘      └─────────────┘      └─────────────┘        │
│         │                    │                                      │
│         ▼                    ▼                                      │
│  ┌─────────────┐      ┌─────────────┐                              │
│  │ EventBridge │      │   Fargate   │                              │
│  │  Scheduler  │      │   Worker    │                              │
│  │ (polling)   │      │             │                              │
│  └─────────────┘      └─────────────┘                              │
│                                                                      │
│  State: DynamoDB (distributed across services)                      │
│  Coordination: Events + DynamoDB                                    │
│  Visualization: Custom (CloudWatch, X-Ray)                          │
└─────────────────────────────────────────────────────────────────────┘
```

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|Event ordering issues|Medium|High|Idempotency, sequence numbers|
|Difficult to trace flow|High|Medium|Correlation IDs, X-Ray|
|State consistency|High|High|DynamoDB transactions|
|Complex error handling|High|High|Dead letter queues, retry logic|
|No visual workflow|High|Medium|Custom dashboards|

#### Pros

- **Loose Coupling**: Services communicate only through events
- **Highly Scalable**: EventBridge handles millions of events
- **Flexible**: Easy to add new event handlers
- **Low Latency**: Direct event routing
- **Cost Effective**: Pay only for events processed
- **No Orchestrator Bottleneck**: Decentralized coordination

#### Cons

- **No Visual Workflow**: Cannot see flow in one place
- **Complex Debugging**: Events scattered across services
- **State Management Hell**: Must implement distributed saga pattern
- **Error Handling Complexity**: No built-in retry orchestration
- **Event Ordering**: Must handle out-of-order events
- **Steep Learning Curve**: Choreography patterns are complex
- **Testing Difficulty**: Hard to test event flows end-to-end
- **Hidden Coupling**: Event schemas create implicit coupling

---

### Option 5: Hybrid - SQS Orchestration + Step Functions for Complex Flows

Use SQS-based orchestration for the main flow, with Step Functions only for complex sub-workflows that benefit from visualization.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    HYBRID APPROACH                                   │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                 Main Flow: SQS-Based                            │ │
│  │                                                                 │ │
│  │   SQS 1           Orchestrator           SQS 2                 │ │
│  │  ┌──────┐        ┌──────────┐          ┌──────┐               │ │
│  │  │Export│───────▶│ Fargate  │─────────▶│Tasks │               │ │
│  │  │ Jobs │        │          │          │      │               │ │
│  │  └──────┘        └────┬─────┘          └──────┘               │ │
│  │                       │                                        │ │
│  └───────────────────────┼────────────────────────────────────────┘ │
│                          │                                          │
│                          │ Complex failure?                         │
│                          │ Multi-step retry?                        │
│                          ▼                                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │            Complex Sub-flow: Step Functions                     │ │
│  │                                                                 │ │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐       │ │
│  │  │ Analyze │──▶│ Retry   │──▶│ Escalate│──▶│ Resolve │       │ │
│  │  │ Failure │   │ Logic   │   │ or Alert│   │         │       │ │
│  │  └─────────┘   └─────────┘   └─────────┘   └─────────┘       │ │
│  │                                                                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|Unclear boundaries|Medium|Medium|Clear documentation|
|Two mental models|Medium|Low|Team training|
|Integration complexity|Medium|Medium|Well-defined interfaces|

#### Pros

- **Best of Both Worlds**: Simple SQS for main flow, Step Functions where valuable
- **Cost Optimized**: Only use Step Functions when visualization/error handling needed
- **Pragmatic**: Matches tool to problem
- **Incremental**: Can start with SQS, add Step Functions later

#### Cons

- **Two Patterns**: Team must understand both approaches
- **Potential Inconsistency**: Different patterns in different places
- **Integration Points**: Must manage boundaries between patterns

---

## Recommended Option

### Option 1: Pure SQS-Based Orchestration (Two Services)

### Decision Rationale

The decision is based on weighted scoring aligned with the specific requirements of the Export Processing Service:

|Factor|Weight|SQS (Opt 1)|SF Wait (Opt 2)|SF+EB Callback (Opt 3)|EB Choreo (Opt 4)|Hybrid (Opt 5)|
|---|---|---|---|---|---|---|
|Cost efficiency|25%|8|2|8|9|7|
|Operational simplicity|20%|8|9|5|4|6|
|Team expertise fit|15%|9|6|5|4|7|
|Debugging & visibility|15%|6|9|7|4|7|
|Scalability|10%|8|5|8|9|8|
|Error handling|10%|6|9|8|5|7|
|Flexibility|5%|9|5|7|8|8|
|**Weighted Score**|100%|**7.55**|**5.85**|**6.75**|**5.85**|**6.90**|

**Primary Decision Drivers:**

1. **Cost at Scale (25%)**: At 100,000 jobs/day, Step Functions with internal wait loops costs ~$4,500/month—prohibitively expensive. While the Callback Pattern reduces this to ~$900/month, pure SQS-based orchestration costs ~$50-100/month for SQS + Fargate compute.
    
2. **Operational Simplicity (20%)**: The Callback Pattern introduces significant complexity (EventBridge Scheduler management, Task Token storage, Lambda pollers, potential orphaned workflows). For a team already familiar with SQS patterns, this added complexity provides diminishing returns.
    
3. **Team Expertise (15%)**: The team has deep experience with SQS-based architectures from previous ADRs. The Callback Pattern requires learning new concepts (Task Tokens, dynamic scheduler creation, callback reconnection patterns).
    
4. **The Polling Reality**: In the Export Processing Service, the Orchestrator already needs to call the Export API to paginate and discover download URLs. Adding Step Functions Callback Pattern means:
    
    - Still need a service to call Export API
    - Now also need Lambda + Scheduler + DynamoDB for polling
    - More components for the same outcome
5. **Processing Dominance**: The bulk of work is in downloading, extracting, and uploading files—not in orchestration. Step Functions provides the most value for complex, branching workflows with many decision points. This workflow is relatively linear.
    

**Why Not the Step Functions Callback Pattern (Option 3)?**

While the Callback Pattern is an excellent architectural pattern for certain use cases, it's over-engineered for this specific service because:

|Consideration|Analysis|
|---|---|
|Workflow complexity|Linear flow: Create → Poll → Download → Process → Upload. Few decision branches.|
|State requirements|Simple: job status, retry count, timestamps. DynamoDB handles this directly.|
|Visualization need|Moderate. Custom CloudWatch dashboards provide sufficient visibility.|
|Error handling|SQS DLQ + application retry logic covers requirements adequately.|
|Cost/benefit|$800+/month additional cost for visualization that custom dashboards can provide.|

**When WOULD the Callback Pattern be better?**

The Step Functions Callback Pattern excels when:

- Complex branching logic with many decision points
- Need for human approval steps
- Compliance requirements for auditable workflow history
- Multi-step compensation/rollback on failures (saga pattern)
- Workflows that span days or weeks
- Non-technical stakeholders need to see workflow state

### Implications

#### MUST

1. **MUST** implement the Two-Service SQS architecture (Orchestrator + Workers) as defined in ADR-001
    
2. **MUST** implement polling logic within the Orchestrator service:
    
    - Non-blocking async polling with configurable intervals
    - Maximum attempt limits with exponential backoff
    - Timeout handling for jobs that exceed maximum wait time
3. **MUST** use DynamoDB for workflow state management:
    
    ```
    Table: ExportJobState
    - PK: exportJobId
    - status: PENDING | POLLING | READY | PROCESSING | COMPLETED | FAILED
    - attempts: number
    - lastPollAt: timestamp
    - expiresAt: timestamp (TTL)
    - errorMessage: string (optional)
    ```
    
4. **MUST** implement SQS visibility timeout extension (heartbeat) for long-running operations
    
5. **MUST** configure Dead Letter Queues for both SQS queues with appropriate retry policies
    
6. **MUST** implement correlation IDs that flow through entire processing pipeline for traceability
    
7. **MUST** build CloudWatch dashboards for workflow visibility:
    
    - Jobs by status (PENDING, POLLING, PROCESSING, COMPLETED, FAILED)
    - Average polling duration
    - Success/failure rates
    - Processing time distribution

#### SHOULD

1. **SHOULD** implement circuit breaker pattern for Export API calls to handle API degradation gracefully
    
2. **SHOULD** use CloudWatch Logs Insights for workflow debugging:
    
    ```
    fields @timestamp, correlationId, jobId, status, message
    | filter status = 'ERROR'
    | sort @timestamp desc
    ```
    
3. **SHOULD** implement adaptive polling intervals:
    
    - Short jobs (< 10 min history): poll every 1-2 minutes
    - Long jobs (> 30 min history): poll every 5-10 minutes
    - Unknown jobs: start at 3 minutes, adapt based on API hints
4. **SHOULD** implement job priority levels using separate SQS queues or message attributes
    
5. **SHOULD** create runbooks for common failure scenarios:
    
    - Export API timeout
    - Download failures
    - Orphaned jobs (stuck in POLLING)
6. **SHOULD** implement metrics for polling efficiency:
    
    - Average polls per job
    - Wasted polls (API not ready)
    - Poll-to-ready ratio
7. **SHOULD** consider AWS X-Ray for distributed tracing across services
    
8. **SHOULD** implement graceful degradation when Export API is slow or unavailable
    

#### MAY

1. **MAY** evaluate Step Functions Callback Pattern in the future if:
    
    - Workflow complexity significantly increases
    - Compliance requirements mandate auditable workflow history
    - Non-technical stakeholders need workflow visualization
    - Multi-step approval or human-in-the-loop requirements emerge
2. **MAY** implement custom workflow visualization using:
    
    - DynamoDB state + React dashboard
    - CloudWatch dashboards with custom widgets
    - Third-party tools (Datadog, Grafana)
3. **MAY** use EventBridge for specific event-driven extensions:
    
    - Notify downstream systems on job completion
    - Trigger analytics pipelines
    - Send alerts on failures
4. **MAY** implement Step Functions for specific complex sub-workflows:
    
    - Multi-step retry with human escalation
    - Complex compensation/rollback logic
    - Approval workflows
5. **MAY** revisit this decision if AWS releases Step Functions pricing changes that make the Callback Pattern more cost-competitive
    
6. **MAY** implement a lightweight workflow engine library if orchestration needs grow but Step Functions remains cost-prohibitive
    

---

## Appendix A: Cost Comparison Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│         MONTHLY COST COMPARISON (100,000 jobs/day)                  │
│                                                                      │
│  Option                              Estimated Monthly Cost         │
│  ─────────────────────────────────   ─────────────────────────     │
│                                                                      │
│  Option 1: Pure SQS                  $150 - $300                    │
│  ├── SQS (both queues)               ~$50                           │
│  ├── Fargate Orchestrator            ~$50-100                       │
│  ├── Fargate Workers                 ~$50-150                       │
│  └── DynamoDB                        ~$10-30                        │
│                                                                      │
│  Option 2: SF Internal Wait          $4,500 - $5,500                │
│  ├── Step Functions transitions      ~$4,500                        │
│  ├── Lambda (status checks)          ~$500                          │
│  └── DynamoDB                        ~$50                           │
│                                                                      │
│  Option 3: SF + EB Callback          $900 - $1,200                  │
│  ├── Step Functions transitions      ~$450                          │
│  ├── EventBridge Scheduler           ~$50                           │
│  ├── Lambda Poller                   ~$300                          │
│  ├── DynamoDB                        ~$50                           │
│  └── Fargate Workers                 ~$50-150                       │
│                                                                      │
│  Option 4: EventBridge Choreo        $400 - $700                    │
│  ├── EventBridge                     ~$100                          │
│  ├── Lambda functions                ~$200-400                      │
│  ├── Fargate Workers                 ~$50-150                       │
│  └── DynamoDB                        ~$50                           │
│                                                                      │
│  Option 5: Hybrid                    $500 - $900                    │
│  ├── SQS + Fargate (main)            ~$200-400                      │
│  ├── Step Functions (complex)        ~$200-400                      │
│  └── DynamoDB                        ~$50-100                       │
│                                                                      │
│  ═══════════════════════════════════════════════════════════════   │
│  RECOMMENDATION: Option 1 at $150-300/month                         │
│  vs Step Functions Callback at $900-1,200/month                     │
│  Savings: $600-900/month ($7,200-10,800/year)                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Appendix B: Decision Tree for Future Evaluation

```
┌─────────────────────────────────────────────────────────────────────┐
│     WHEN TO RECONSIDER STEP FUNCTIONS CALLBACK PATTERN              │
│                                                                      │
│  Start                                                               │
│    │                                                                 │
│    ▼                                                                 │
│  ┌─────────────────────────────────────┐                            │
│  │ Do you need visual workflow history │                            │
│  │ for compliance/audit?               │                            │
│  └──────────────┬──────────────────────┘                            │
│                 │                                                    │
│        YES ─────┼───── NO                                           │
│         │       │       │                                            │
│         ▼       │       ▼                                            │
│   Consider SF   │   ┌─────────────────────────────────┐             │
│   Callback      │   │ Do you have complex branching   │             │
│                 │   │ with 5+ decision points?        │             │
│                 │   └──────────────┬──────────────────┘             │
│                 │                  │                                 │
│                 │         YES ─────┼───── NO                        │
│                 │          │       │       │                         │
│                 │          ▼       │       ▼                         │
│                 │    Consider SF   │   ┌─────────────────────────┐  │
│                 │    Callback      │   │ Do non-technical users  │  │
│                 │                  │   │ need to see workflow?   │  │
│                 │                  │   └──────────┬──────────────┘  │
│                 │                  │              │                  │
│                 │                  │     YES ─────┼───── NO         │
│                 │                  │      │       │       │          │
│                 │                  │      ▼       │       ▼          │
│                 │                  │ Consider SF  │   STICK WITH    │
│                 │                  │ Callback     │   SQS-BASED     │
│                 │                  │              │                  │
└─────────────────┴──────────────────┴──────────────┴──────────────────┘
```

---

## Appendix C: Step Functions Callback Pattern - When It Shines

For future reference, the Callback Pattern IS the right choice when:

|Scenario|Why Callback Pattern Wins|
|---|---|
|Multi-day workflows|Zero cost during long waits|
|Human approval steps|Natural pause point for human input|
|Regulated industries|Built-in audit trail required|
|Complex saga patterns|Compensation logic visualized|
|Many stakeholders|Non-technical visibility needed|
|Debugging priority|Visual debugging worth the cost|

---

**Decision Date**: [Current Date] **Decision Makers**: [Team/Architect Names] **Status**: Proposed **Supersedes**: N/A **Related ADRs**:

- ADR-001: Service Architecture Selection (Two Services)
- ADR-002: Language and Framework Selection (Node.js/TypeScript/NestJS)