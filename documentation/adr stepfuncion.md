# ADR-001: Architecture for Audio File Reconciliation Process

## Question

What is the most appropriate serverless AWS architecture to implement the audio file reconciliation process that handles approximately 10% of daily call events (~10K reconciliations/day from 100K total events) where the primary audio ingestion flow fails to receive the audio file?

## Assumptions

1. **Volume**: 100K daily events total, with ~10% (10K) requiring reconciliation processing
2. **Trigger**: Step Functions executions are triggered from an SQS queue
3. **External Dependency**: Audio file download is performed by an external service (Fargate or third-party) that will send a callback upon completion
4. **Polling Requirements**: Export Job status must be polled at configurable intervals (e.g., 5 minutes) until completion or timeout
5. **State Persistence**: DynamoDB is used for tracking call processing status and flags
6. **Maximum Retry Window**: Reconciliation attempts should be bounded (e.g., max 6 iterations or 30 minutes)
7. **Serverless Requirement**: Solution must be 100% serverless using AWS managed services
8. **Observability**: Operations team requires visibility into reconciliation process status and failures

## Options Considered

### Option A: Step Functions with Native Wait States

Uses AWS Step Functions Standard Workflows with built-in Wait states to implement polling loops entirely within the state machine.

```
SQS → Lambda → Step Function
                    ├── Create Export Job (Lambda)
                    ├── Wait State (5 min)
                    ├── Check Status (Lambda)
                    │     ├── NOT_COMPLETED → Loop to Wait
                    │     └── COMPLETED → Continue
                    └── Parallel Branch
                          ├── Get Metadata (Lambda)
                          └── Notify External Service (Callback)
```

#### Risk and Impact

- **Cost Risk**: HIGH - Wait states in Standard Workflows charge per state transition, not duration. Each Wait state consumes 2 transitions (enter + exit). With multiple polling iterations, costs can escalate to $95-155/month, making this the most expensive option by a significant margin.
- **Operational Risk**: LOW - Single service to monitor and maintain.
- **Scaling Risk**: LOW - Step Functions scales automatically with concurrent executions.
- **Cost Variability Risk**: MEDIUM - Monthly costs highly dependent on average polling iterations; unpredictable if OCP Export API performance varies.

#### Pros

- Simplest architecture with all logic contained in a single state machine
- Complete execution visibility in Step Functions console
- Native error handling with retry policies, catch blocks, and timeouts
- Built-in callback pattern support via `.waitForTaskToken`
- Easy to understand and modify workflow logic
- Native integration with CloudWatch for metrics and alarms

#### Cons

- Highest cost option due to Wait state transitions (~$60-70/month estimated)
- Standard Workflows required for long-running executions (Express limited to 5 minutes)
- Each polling iteration adds state transitions to billing
- Potential for very long-running executions if export jobs are slow

#### Cost Estimate

**Understanding Wait State Billing:**

In Step Functions Standard Workflows, billing is based on **state transitions**, not execution time. A Wait state incurs charges when:

- Entering the Wait state = 1 transition
- Exiting the Wait state = 1 transition

This means **each Wait state costs 2 transitions**, regardless of whether you wait 1 second or 1 hour.

**Transition Breakdown per Reconciliation (assuming 3 polling iterations):**

|State|Transitions|
|---|---|
|StartExecution|1|
|CreateExportJob (Lambda)|1|
|Wait State (iteration 1)|2|
|CheckStatus (Lambda) - NOT_COMPLETED|1|
|Wait State (iteration 2)|2|
|CheckStatus (Lambda) - NOT_COMPLETED|1|
|Wait State (iteration 3)|2|
|CheckStatus (Lambda) - COMPLETED|1|
|Parallel (branch entry)|1|
|GetMetadata (Lambda)|1|
|NotifyExternal (Lambda)|1|
|Parallel (branch exit)|1|
|EndExecution|1|
|**Total**|**16 transitions**|

**Monthly Cost Calculation:**

```
10K reconciliations/day × 16 transitions × 30 days = 4.8M transitions/month
Step Functions Standard: $0.025 per 1,000 transitions = $120/month

With fewer iterations (avg 2 polling cycles):
10K × 12 transitions × 30 = 3.6M transitions = ~$90/month

With more iterations (avg 4 polling cycles):
10K × 20 transitions × 30 = 6M transitions = ~$150/month

Lambda invocations: ~1.5M/month = ~$0.30/month
DynamoDB operations: ~$5/month
```

**Total Estimated Range: ~$95-155/month** (depending on average polling iterations)

> ⚠️ **Note**: The previous estimate of $60-70/month was conservative. Actual costs depend heavily on how many polling iterations are needed on average. If OCP Export Jobs typically complete quickly (1-2 polls), costs will be lower. If they frequently require 4-6 polls, costs will be significantly higher.

---

### Option B: EventBridge Scheduler with Lambda Orchestration

Uses Amazon EventBridge Scheduler to create one-time scheduled events that trigger Lambda functions for polling, with state managed entirely in DynamoDB.

```
SQS → Lambda (Init)
         ├── Create Export Job
         ├── Save state to DynamoDB
         └── Create EventBridge Schedule (+5 min)
                    ↓
              Lambda Poller
                 ├── Query Export API
                 ├── NOT_COMPLETED → Create new Schedule
                 └── COMPLETED 
                       ├── Update DynamoDB
                       └── Emit EventBridge Events
                              ├── → Lambda: Get Metadata
                              └── → Lambda: Notify External
```

#### Risk and Impact

- **Cost Risk**: LOW - EventBridge Scheduler has minimal per-schedule pricing.
- **Operational Risk**: HIGH - Distributed state makes debugging and tracing individual reconciliations difficult without custom tooling.
- **Scaling Risk**: LOW - EventBridge and Lambda scale independently and massively.
- **Consistency Risk**: MEDIUM - Race conditions possible without careful DynamoDB design (conditional writes, optimistic locking).

#### Pros

- Lowest cost option (~$10-15/month estimated)
- No idle compute or waiting charges
- Excellent horizontal scalability
- Complete decoupling between components
- Each component can be modified independently
- EventBridge Scheduler supports flexible scheduling patterns

#### Cons

- No unified execution view; requires custom observability solution
- Manual implementation of retry logic, timeouts, and error compensation
- State scattered across DynamoDB, CloudWatch Logs, and EventBridge
- Complex debugging for production issues
- Requires careful handling of duplicate events and idempotency
- Higher development and testing effort

#### Cost Estimate

```
EventBridge Scheduler: 300K schedules/month × $1/million = ~$0.30/month
Lambda invocations: ~3M/month = ~$0.60/month
DynamoDB operations: ~$5-10/month
Total: ~$10-15/month
```

---

### Option C: Step Functions with EventBridge Scheduler (Hybrid)

Combines Step Functions for workflow orchestration and visibility with EventBridge Scheduler for cost-efficient polling delays using the callback pattern.

```
SQS → Lambda → Step Function
                    ├── Create Export Job (Lambda)
                    ├── Persist TaskToken to DynamoDB
                    ├── Create EventBridge Schedule (+5 min)
                    └── .waitForTaskToken ◄────────────────┐
                                                           │
         EventBridge Schedule ─────────────────────────────┤
                    ↓                                      │
              Lambda Poller                                │
                    ├── NOT_COMPLETED → New EB Schedule    │
                    └── COMPLETED → SendTaskSuccess ───────┘
                                         ↓
                               Step Function resumes
                                    └── Parallel
                                          ├── Get Metadata (Lambda)
                                          └── Notify External + waitForTaskToken
```

#### Risk and Impact

- **Cost Risk**: LOW-MEDIUM - Eliminates Wait state charges; pays only for actual state transitions.
- **Operational Risk**: LOW - Step Functions provides unified execution view while EventBridge handles scheduling.
- **Scaling Risk**: LOW - Both services scale independently.
- **Complexity Risk**: MEDIUM - Requires TaskToken management and coordination between two services.

#### Pros

- Optimized cost by avoiding Wait state transition charges
- Complete workflow visibility in Step Functions console
- Native timeout and error handling at workflow level
- Callback pattern ideal for external service integration
- Clear separation: EventBridge handles timing, Step Functions handles flow
- Single place to monitor reconciliation status
- Easy to implement global timeout for entire reconciliation process

#### Cons

- Moderate complexity with two coordinated services
- Requires TaskToken persistence in DynamoDB
- Additional Lambda code to manage EventBridge schedule creation
- Slightly more complex deployment and IaC

#### Cost Estimate

```
Step Functions: 300K executions × 4 transitions = 1.2M transitions = ~$30/month
EventBridge Scheduler: 900K schedules/month = ~$0.90/month
Lambda + DynamoDB: ~$10/month
Total: ~$40-45/month
```

---

### Option D: SQS Delay Queues with Lambda

Uses SQS message delay feature to implement polling intervals, with Lambda consumers processing messages and re-queuing with delay when needed.

```
SQS (Primary) → Lambda (Init)
                    ├── Create Export Job
                    └── Send to SQS Delay Queue (5 min delay)
                              ↓
                    Lambda Poller
                         ├── NOT_COMPLETED → Re-send with delay
                         └── COMPLETED → Process completion
                                           ├── Get Metadata
                                           └── Notify External
```

#### Risk and Impact

- **Cost Risk**: VERY LOW - SQS pricing is minimal for this volume.
- **Operational Risk**: HIGH - No execution-level visibility; relies entirely on logging.
- **Scaling Risk**: LOW - SQS and Lambda scale well.
- **Functionality Risk**: MEDIUM - Maximum delay of 15 minutes may be insufficient for some scenarios.

#### Pros

- Very low cost (~$5-10/month)
- Simple architecture with minimal components
- Familiar SQS patterns for most teams
- Built-in DLQ support for failed messages
- Easy to implement basic retry logic

#### Cons

- Maximum message delay limited to 15 minutes
- No workflow-level visibility or state machine view
- Difficult to implement complex branching or parallel execution
- Manual correlation of events across logs for debugging
- No native timeout mechanism for entire reconciliation process
- Callback handling from external service requires additional design

#### Cost Estimate

```
SQS requests: ~3M/month = ~$1.20/month
Lambda invocations: ~3M/month = ~$0.60/month
DynamoDB: ~$5/month
Total: ~$5-10/month
```

---

## Recommended Option

**Option C: Step Functions with EventBridge Scheduler (Hybrid)**

### Decisioning

The hybrid approach is recommended based on the following weighted criteria analysis:

|Criteria|Weight|Option A|Option B|Option C|Option D|
|---|---|---|---|---|---|
|Cost Efficiency|25%|1|5|4|5|
|Operational Visibility|25%|5|2|4|2|
|Error Handling|20%|5|2|5|3|
|Implementation Complexity|15%|5|2|3|4|
|External Callback Support|15%|5|3|5|2|
|**Weighted Score**|100%|**3.75**|**2.9**|**4.15**|**3.2**|

**Cost Comparison Summary:**

|Option|Monthly Cost|vs Option C|
|---|---|---|
|Option A (SF + Wait)|$95-155|+110% to +245%|
|Option B (EventBridge only)|$10-15|-65% to -75%|
|**Option C (Hybrid)**|**$40-45**|baseline|
|Option D (SQS Delay)|$5-10|-78% to -88%|

**Key Decision Factors:**

1. **External Service Callback**: The `.waitForTaskToken` pattern in Step Functions provides native support for waiting on external service completion, which is essential for the Fargate download service integration.
    
2. **Cost Optimization**: By using EventBridge Scheduler instead of Wait states, we eliminate the per-transition charges during polling intervals, reducing costs by approximately **60-70%** compared to Option A ($40-45/month vs $95-155/month).
    
3. **Operational Requirements**: At 10K reconciliations per day, the operations team needs clear visibility into process status, failures, and bottlenecks. Step Functions execution history provides this without custom tooling.
    
4. **Error Handling**: Native Step Functions error handling (timeouts, retries, catch blocks) significantly reduces implementation effort compared to Options B and D.
    

### Implications

#### MUST

1. **Implement TaskToken Persistence**: Create a DynamoDB table or attribute to store TaskTokens associated with each reconciliation process, keyed by Export Job ID or Dialog Group ID.
    
2. **Implement Global Timeout**: Configure Step Functions execution timeout (e.g., 2 hours) to prevent indefinitely stuck reconciliations.
    
3. **Implement Idempotency**: Ensure Lambda functions are idempotent to handle potential duplicate SQS messages or EventBridge schedule executions.
    
4. **Implement Dead Letter Handling**: Configure DLQ for SQS trigger queue and Step Functions execution failures.
    
5. **Implement EventBridge Schedule Cleanup**: Ensure completed or failed reconciliations trigger cleanup of any pending EventBridge schedules to prevent orphaned schedules.
    

#### SHOULD

1. **Implement Structured Logging**: Use consistent correlation IDs (Dialog Group ID, Export Job ID) across all Lambda functions for end-to-end tracing.
    
2. **Implement CloudWatch Alarms**: Create alarms for reconciliation failures, timeout rates, and queue depth.
    
3. **Implement X-Ray Tracing**: Enable X-Ray on Step Functions and Lambda for distributed tracing across the hybrid architecture.
    
4. **Implement Exponential Backoff**: Consider increasing polling intervals progressively (e.g., 2min, 5min, 10min) to reduce API calls for slow export jobs.
    
5. **Implement Maximum Retry Counter**: Store and check iteration count to prevent infinite polling loops even if global timeout is not reached.
    

#### MAY

1. **Implement Dashboard**: Create CloudWatch dashboard showing reconciliation metrics, success rates, and average completion times.
    
2. **Implement SNS Notifications**: Send alerts for reconciliations exceeding threshold durations or retry counts.
    
3. **Implement Batch Processing**: If export API supports it, batch multiple pending calls into single export jobs to reduce API calls.
    
4. **Implement Step Functions Express for Initial Steps**: Use Express Workflow for the synchronous portion (job creation) before transitioning to Standard for the async wait, further optimizing costs.
    
5. **Implement Circuit Breaker**: If OCP Export API experiences sustained failures, implement circuit breaker pattern to pause reconciliation attempts temporarily.
    

---

## Appendix A: Scaling Impact Analysis - 1 Million Daily Requests

This section analyzes the cost and operational impact if the system scales to **1 million daily events** (10x current volume), resulting in approximately **100K reconciliations per day** (maintaining the 10% reconciliation rate).

### Cost Projection at 1M Daily Events

|Option|100K Events/day|1M Events/day|Increase Factor|Monthly Cost at Scale|
|---|---|---|---|---|
|**Option A** (SF + Wait)|$95-155|$950-1,550|10x|**$950-1,550/month**|
|**Option B** (EventBridge)|$10-15|$60-110|6-7x|**$60-110/month**|
|**Option C** (Hybrid)|$40-45|$400-450|10x|**$400-450/month**|
|**Option D** (SQS Delay)|$5-10|$50-70|7-10x|**$50-70/month**|

### Detailed Breakdown at 1M Daily Events

#### Option A: Step Functions + Wait States

```
100K reconciliations/day × 16 transitions × 30 days = 48M transitions/month
Step Functions: $0.025 per 1,000 transitions = $1,200/month (avg)

Range based on polling iterations:
- 2 iterations (optimistic): 36M transitions = $900/month
- 4 iterations (pessimistic): 60M transitions = $1,500/month

Lambda invocations: ~15M/month = ~$3/month
DynamoDB operations: ~$50/month

Total: $950 - $1,550/month
```

**⚠️ Critical Concern**: At this scale, Wait state transitions become a significant cost driver. Annual cost could reach **$11,400 - $18,600**.

#### Option B: EventBridge Scheduler Only

```
EventBridge Scheduler: 
- 100K reconciliations × 3 avg schedules × 30 days = 9M schedules/month
- $1 per million schedules = ~$9/month

Lambda invocations: ~30M/month = ~$6/month
DynamoDB operations (heavy): ~$50-100/month
CloudWatch Logs: ~$10-20/month

Total: $60 - $110/month
```

**✅ Advantage**: EventBridge scales very cost-efficiently. However, operational complexity increases significantly at this volume without proper tooling.

#### Option C: Step Functions + EventBridge (Hybrid)

```
Step Functions:
- 100K executions/day × 4 transitions × 30 days = 12M transitions/month
- $0.025 per 1,000 = $300/month

EventBridge Scheduler:
- 100K × 3 avg schedules × 30 = 9M schedules/month = ~$9/month

Lambda invocations: ~30M/month = ~$6/month
DynamoDB operations: ~$50-100/month
CloudWatch Logs: ~$20-30/month

Total: $400 - $450/month
```

**✅ Best Balance**: Maintains visibility benefits while keeping costs 70% lower than Option A at scale.

#### Option D: SQS Delay Queues

```
SQS requests: ~30M/month = ~$12/month
Lambda invocations: ~30M/month = ~$6/month
DynamoDB operations: ~$30-50/month

Total: $50 - $70/month
```

**⚠️ Limitation**: While cheapest, the 15-minute maximum delay constraint becomes more problematic at scale if OCP Export API experiences latency issues.

### Operational Impact at Scale

|Aspect|Option A|Option B|Option C|Option D|
|---|---|---|---|---|
|**Concurrent Executions**|~7K SF executions|N/A (stateless)|~7K SF executions|N/A (stateless)|
|**SF Account Limits**|May need increase|N/A|May need increase|N/A|
|**DynamoDB Capacity**|Medium|High|Medium-High|Medium|
|**Debugging at Scale**|Easy (SF console)|Very Hard|Easy (SF console)|Hard|
|**Blast Radius**|Contained|Distributed|Contained|Distributed|
|**Recovery from Failures**|Native retries|Manual|Native retries|DLQ-based|

### Service Limits to Consider at 1M Scale

|Service|Default Limit|Required for 1M|Action Needed|
|---|---|---|---|
|Step Functions concurrent executions|1,000|~7,000|Request increase|
|Step Functions StartExecution/sec|500|~1,200|Request increase|
|EventBridge Scheduler schedules|1,000,000|~270K active|OK|
|Lambda concurrent executions|1,000|~2,000-3,000|Request increase|
|DynamoDB WCU (on-demand)|40,000|~5,000 peak|OK|

### Recommendations for 1M Scale

#### If Choosing Option A (SF + Wait)

- **MUST** request Step Functions limit increases before scaling
- **MUST** budget $12,000-18,000/year for Step Functions costs
- **SHOULD** implement aggressive caching of export job status to reduce polling iterations

#### If Choosing Option B (EventBridge)

- **MUST** implement comprehensive distributed tracing (X-Ray + custom correlation)
- **MUST** build operational dashboards for visibility
- **SHOULD** implement saga pattern for error compensation
- **MAY** consider investing savings into observability tooling

#### If Choosing Option C (Hybrid) - RECOMMENDED

- **MUST** request Step Functions limit increases (concurrent executions, StartExecution rate)
- **SHOULD** implement Step Functions execution batching if possible
- **SHOULD** use DynamoDB on-demand capacity for unpredictable scaling
- **MAY** consider reserved capacity for DynamoDB if traffic is predictable

#### If Choosing Option D (SQS Delay)

- **MUST** implement robust DLQ processing and alerting
- **MUST** handle the 15-minute delay limitation with fallback strategies
- **SHOULD** implement comprehensive logging and tracing

### Cost Projection Summary (Annual)

|Option|100K/day (Current)|1M/day (10x Scale)|
|---|---|---|
|**Option A**|$1,140 - $1,860/year|**$11,400 - $18,600/year**|
|**Option B**|$120 - $180/year|**$720 - $1,320/year**|
|**Option C**|$480 - $540/year|**$4,800 - $5,400/year**|
|**Option D**|$60 - $120/year|**$600 - $840/year**|

> 💡 **Key Insight**: At 1M daily events, the cost difference between Option A and Option C becomes **$6,600 - $13,200/year**. The hybrid approach (Option C) provides similar operational benefits at significantly lower cost, making it even more compelling at scale.

---

## Appendix B: Architecture Diagram (Option C)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           RECONCILIATION PROCESS                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────┐    ┌─────────────┐    ┌──────────────────────────────────────────┐ │
│  │   SQS   │───▶│   Lambda    │───▶│          Step Functions                  │ │
│  │  Queue  │    │  (Trigger)  │    │         (Standard Workflow)              │ │
│  └─────────┘    └─────────────┘    │                                          │ │
│                                     │  ┌────────────────────────────────────┐ │ │
│                                     │  │ 1. Create Export Job (Lambda)     │ │ │
│                                     │  └────────────────────────────────────┘ │ │
│                                     │                   │                      │ │
│                                     │                   ▼                      │ │
│                                     │  ┌────────────────────────────────────┐ │ │
│  ┌─────────────┐                   │  │ 2. Save TaskToken + Schedule EB    │ │ │
│  │  DynamoDB   │◀──────────────────│  └────────────────────────────────────┘ │ │
│  │ (TaskToken) │                   │                   │                      │ │
│  └─────────────┘                   │                   ▼                      │ │
│        │                           │  ┌────────────────────────────────────┐ │ │
│        │                           │  │ 3. .waitForTaskToken               │◀┼─┼─┐
│        │                           │  └────────────────────────────────────┘ │ │ │
│        │                           │                   │                      │ │ │
│        │                           │         (on callback received)          │ │ │
│        │                           │                   ▼                      │ │ │
│        │                           │  ┌────────────────────────────────────┐ │ │ │
│        │                           │  │ 4. Parallel Execution              │ │ │ │
│        │                           │  │    ├── Get Metadata (Lambda)       │ │ │ │
│        │                           │  │    └── Notify External + Callback  │ │ │ │
│        │                           │  └────────────────────────────────────┘ │ │ │
│        │                           │                   │                      │ │ │
│        │                           │                   ▼                      │ │ │
│        │                           │  ┌────────────────────────────────────┐ │ │ │
│        │                           │  │ 5. Update Final State              │ │ │ │
│        │                           │  └────────────────────────────────────┘ │ │ │
│        │                           └──────────────────────────────────────────┘ │
│        │                                                                        │
│        │         ┌─────────────────────────────────────────┐                   │
│        │         │         EventBridge Scheduler            │                   │
│        │         │      (One-time scheduled events)         │                   │
│        │         └─────────────────────────────────────────┘                   │
│        │                            │                                           │
│        │                            ▼ (+5 min delay)                           │
│        │         ┌─────────────────────────────────────────┐                   │
│        │         │           Lambda Poller                  │                   │
│        └────────▶│  - Read TaskToken from DynamoDB         │                   │
│                  │  - Query OCP Export API                 │                   │
│                  │  - If NOT_COMPLETED: New EB Schedule    │───┐               │
│                  │  - If COMPLETED: SendTaskSuccess ───────┼───┼───────────────┘
│                  └─────────────────────────────────────────┘   │
│                                     ▲                          │
│                                     └──────────────────────────┘
│                                        (retry loop)
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

**Decision Date**: [To be filled]  
**Decision Makers**: [To be filled]  
**Status**: PROPOSED