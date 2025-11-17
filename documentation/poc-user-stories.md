# User Stories: Step Functions + EventBridge Scheduler PoC

## Epic: Validate Callback Pattern for Cost-Effective Job Orchestration

**Epic ID:** ORCH-001  
**Sprint:** 1 (2 weeks)  
**Business Goal:** Prove 87% cost reduction in workflow orchestration through callback pattern

---

## User Story 1: Local Development Environment & Infrastructure

**US-001: Setup Complete Local PoC Environment**

```
AS A cloud architect
I WANT TO deploy a complete local environment with all AWS services emulated
SO THAT I can validate the callback pattern without AWS costs or account dependencies
```

### Acceptance Criteria

- [ ] LocalStack container runs Step Functions, Lambda, and DynamoDB services
- [ ] DynamoDB tables created: `poc-task-tokens` (token storage) and `poc-jobs` (simulated jobs)
- [ ] Three Lambda functions deployed and functional:
  - `poc-simulated-api`: Simulates external job processing
  - `poc-create-job`: Creates jobs and persists Task Tokens
  - `poc-poller`: Checks status and reconnects workflows
- [ ] Step Functions state machine deployed with `waitForTaskToken` pattern
- [ ] All infrastructure deployable with single script in < 5 minutes
- [ ] Environment reproducible on any machine with Docker

### Technical Tasks

| Task | Description | Estimate |
|------|-------------|----------|
| T1.1 | Create `docker-compose.yml` for LocalStack with required services | 2h |
| T1.2 | Create DynamoDB table schemas (task-tokens, jobs) | 1h |
| T1.3 | Implement `poc-simulated-api` Lambda (CREATE_JOB, CHECK_STATUS actions) | 3h |
| T1.4 | Implement `poc-create-job` Lambda (job creation + token persistence) | 4h |
| T1.5 | Implement `poc-poller` Lambda (status check + SendTaskSuccess/Failure) | 6h |
| T1.6 | Create Step Functions state machine definition (ASL JSON) | 2h |
| T1.7 | Create `deploy-local.sh` script for automated deployment | 2h |
| T1.8 | Document setup prerequisites and installation steps | 1h |

**Story Points:** 13  
**Priority:** High  
**Dependencies:** None  
**Definition of Done:** All infrastructure components deployed locally, Lambda functions executable, state machine created

---

## User Story 2: Core Callback Pattern Implementation

**US-002: Implement Task Token Workflow Reconnection**

```
AS A Step Functions workflow
I WANT TO pause execution using Task Token and resume when external polling detects job completion
SO THAT I pay zero cost during wait periods while maintaining workflow state
```

### Acceptance Criteria

- [ ] Step Functions generates unique Task Token when entering `waitForTaskToken` state
- [ ] CreateJob Lambda saves Task Token to DynamoDB with job metadata
- [ ] Workflow enters WAITING state with $0 cost (no active transitions)
- [ ] Poller Lambda retrieves Task Token from DynamoDB by job ID
- [ ] Poller calls `SendTaskSuccess` with token when job status = COMPLETED
- [ ] Step Functions workflow resumes immediately after receiving callback
- [ ] Job result data passed through to next workflow state
- [ ] Workflow completes successfully with final output
- [ ] Attempt counter tracked accurately in DynamoDB
- [ ] Multiple polling cycles execute before completion (simulating real scenario)

### Technical Tasks

| Task | Description | Estimate |
|------|-------------|----------|
| T2.1 | Configure state machine with `lambda:invoke.waitForTaskToken` resource | 2h |
| T2.2 | Inject Task Token via `$$.Task.Token` in state parameters | 1h |
| T2.3 | Implement token persistence logic in CreateJob Lambda | 2h |
| T2.4 | Implement token retrieval logic in Poller Lambda | 2h |
| T2.5 | Implement `SendTaskSuccess` call with proper output structure | 3h |
| T2.6 | Implement job completion detection (poll count >= threshold) | 2h |
| T2.7 | Add idempotency check (skip if already processed) | 1h |
| T2.8 | Verify workflow resumes and reaches success state | 2h |
| T2.9 | Create manual polling script for testing | 1h |

**Story Points:** 8  
**Priority:** High  
**Dependencies:** US-001  
**Definition of Done:** Complete workflow executes from start → wait → callback → completion with validated token mechanism

---

## User Story 3: Error Handling & Validation Testing

**US-003: Implement Error Scenarios and End-to-End Validation**

```
AS A developer validating the PoC
I WANT TO test error handling scenarios and run automated end-to-end tests
SO THAT I can confirm the pattern is production-ready and handles failures gracefully
```

### Acceptance Criteria

- [ ] `SendTaskFailure` sent when job status = FAILED
- [ ] `SendTaskFailure` sent when max polling attempts exceeded
- [ ] `SendTaskFailure` sent when polling timeout expires
- [ ] Workflow catches timeout errors and transitions to TimeoutState
- [ ] Workflow catches task failures and transitions to FailedState
- [ ] DynamoDB status updated correctly for all scenarios (COMPLETED, FAILED, TIMEOUT, MAX_ATTEMPTS)
- [ ] Automated test script executes complete happy path
- [ ] Test script monitors execution progress in real-time
- [ ] Test validates pattern key points:
  - ✅ Task Token generation
  - ✅ Token persistence
  - ✅ External polling simulation
  - ✅ Workflow reconnection
  - ✅ Final state completion
- [ ] All tests pass consistently (3+ runs without failure)
- [ ] PoC documentation complete with architecture diagrams and cost analysis

### Technical Tasks

| Task | Description | Estimate |
|------|-------------|----------|
| T3.1 | Implement `SendTaskFailure` for FAILED job status | 2h |
| T3.2 | Implement max attempts exceeded detection and failure | 2h |
| T3.3 | Implement timeout expiration check in Poller | 2h |
| T3.4 | Add Catch blocks in state machine for States.Timeout and States.TaskFailed | 1h |
| T3.5 | Create TimeoutState and FailedState with error details | 1h |
| T3.6 | Implement DynamoDB status update for all terminal states | 2h |
| T3.7 | Create `test-local.sh` automated test script | 4h |
| T3.8 | Add real-time progress monitoring to test script | 2h |
| T3.9 | Create `monitor.sh` for resource inspection | 1h |
| T3.10 | Document all error scenarios and expected behaviors | 2h |
| T3.11 | Run validation tests (minimum 3 successful runs) | 1h |
| T3.12 | Create final PoC summary report with findings | 2h |

**Story Points:** 13  
**Priority:** High  
**Dependencies:** US-002  
**Definition of Done:** All error scenarios handled correctly, automated tests pass consistently, documentation complete

---

## Sprint Summary

| Story | Points | Priority | Duration |
|-------|--------|----------|----------|
| US-001: Local Environment Setup | 13 | High | Days 1-3 |
| US-002: Core Callback Implementation | 8 | High | Days 4-6 |
| US-003: Error Handling & Validation | 13 | High | Days 7-10 |
| **Total** | **34** | | **10 days** |

---

## Definition of Done (Epic Level)

- [ ] All 3 user stories completed and accepted
- [ ] Complete workflow executes end-to-end successfully
- [ ] Task Token mechanism validated (generation, persistence, callback)
- [ ] Error scenarios handled (timeout, failure, max attempts)
- [ ] Automated tests pass consistently
- [ ] Cost savings documented (87% reduction validated)
- [ ] Architecture decision documented
- [ ] Local PoC environment reproducible
- [ ] Ready for production implementation planning

---

## Success Metrics

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| Workflow completion | 100% success rate | Automated test script |
| Token reconnection | < 1 second latency | Execution timestamps |
| Error handling | All 4 scenarios covered | Test each failure path |
| Setup time | < 5 minutes | Time deploy script |
| Documentation | Complete | Peer review |

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| LocalStack Step Functions limitations | High | Medium | Validate core features early; document gaps |
| Task Token expiration issues | High | Low | Set generous timeouts for PoC; test edge cases |
| Lambda cold starts affect timing | Low | Medium | Use consistent execution environment |
| EventBridge Scheduler not in LocalStack | Medium | High | Use manual polling; document production difference |

---

## Next Steps After PoC

1. **Production Planning:** Create implementation stories for AWS deployment
2. **Cost Analysis:** Document actual vs projected savings
3. **Scale Testing:** Test with higher volumes (100+ concurrent jobs)
4. **Integration:** Connect to real external API
5. **Monitoring:** Set up CloudWatch dashboards and alerts

---

## Attachments

- [x] Architecture diagram (see main documentation)
- [x] Cost analysis spreadsheet (87% savings calculation)
- [x] State machine ASL definition
- [x] Lambda function code templates
- [x] Infrastructure as Code (Terraform for AWS deployment)

---

**Created by:** Cloud Architecture Team  
**Review Date:** [Date]  
**Approved by:** [Tech Lead Name]
