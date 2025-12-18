
# Step Functions Implementation: Native Wait + Polling Loop

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     RECONCILIATION STEP FUNCTION FLOW                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────┐    ┌─────────────┐    ┌──────────────────────────────────────┐   │
│   │   SQS   │───►│   Lambda    │───►│         STEP FUNCTION                │   │
│   │  Queue  │    │  (Trigger)  │    │                                      │   │
│   └─────────┘    └─────────────┘    │  ┌──────────────────────────────┐   │   │
│                                      │  │ 1. Initialize                │   │   │
│                                      │  └─────────────┬────────────────┘   │   │
│                                      │                ▼                     │   │
│                                      │  ┌──────────────────────────────┐   │   │
│                                      │  │ 2. CreateExportJob (Lambda)  │   │   │
│                                      │  └─────────────┬────────────────┘   │   │
│                                      │                ▼                     │   │
│                                      │  ┌──────────────────────────────┐   │   │
│                                      │  │ 3. UpdateStatusCreated (DB)  │   │   │
│                                      │  └─────────────┬────────────────┘   │   │
│                                      │                ▼                     │   │
│                                      │  ╔══════════════════════════════╗   │   │
│                                      │  ║    POLLING LOOP              ║   │   │
│                                      │  ║  ┌────────────────────────┐  ║   │   │
│                                      │  ║  │ 4. WaitForExport (5m)  │◄─╫───┐   │
│                                      │  ║  └───────────┬────────────┘  ║   │   │
│                                      │  ║              ▼               ║   │   │
│                                      │  ║  ┌────────────────────────┐  ║   │   │
│                                      │  ║  │ 5. CheckExportStatus   │  ║   │   │
│                                      │  ║  └───────────┬────────────┘  ║   │   │
│                                      │  ║              ▼               ║   │   │
│                                      │  ║  ┌────────────────────────┐  ║   │   │
│                                      │  ║  │ 6. EvaluateStatus      │──╫───┘   │
│                                      │  ║  │    NOT_COMPLETED ──────┘  ║       │
│                                      │  ║  │    COMPLETED ─────────────╫──┐    │
│                                      │  ║  │    MAX_RETRIES ───────────╫──┼─►FAIL
│                                      │  ║  └────────────────────────┘  ║  │    │
│                                      │  ╚══════════════════════════════╝  │    │
│                                      │                                    │    │
│                                      │                ┌───────────────────┘    │
│                                      │                ▼                        │
│                                      │  ┌──────────────────────────────┐       │
│                                      │  │ 7. Parallel Processing       │       │
│                                      │  │  ┌────────────────────────┐  │       │
│                                      │  │  │ Branch A: GetMetadata  │  │       │
│                                      │  │  └────────────────────────┘  │       │
│                                      │  │  ┌────────────────────────┐  │       │
│                                      │  │  │ Branch B: NotifyFargate│  │       │
│                                      │  │  │ + WaitForCallback      │  │       │
│                                      │  │  └────────────────────────┘  │       │
│                                      │  └─────────────┬────────────────┘       │
│                                      │                ▼                        │
│                                      │  ┌──────────────────────────────┐       │
│                                      │  │ 8. UpdateFinalStatus         │       │
│                                      │  └─────────────┬────────────────┘       │
│                                      │                ▼                        │
│                                      │             SUCCESS                     │
│                                      └──────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Step Function Definition (ASL)

```json
{
  "Comment": "Audio File Reconciliation Process - Polls OCP Export API and processes audio files",
  "StartAt": "Initialize",
  "TimeoutSeconds": 14400,
  "States": {
    
    "Initialize": {
      "Type": "Pass",
      "Comment": "Initialize execution context with retry counter and timestamps",
      "Parameters": {
        "input.$": "$",
        "context": {
          "retryCount": 0,
          "maxRetries": 6,
          "startedAt.$": "$$.Execution.StartTime",
          "executionId.$": "$$.Execution.Id"
        }
      },
      "ResultPath": "$",
      "Next": "CreateExportJob"
    },

    "CreateExportJob": {
      "Type": "Task",
      "Comment": "Call OCP Export API to create export job for the pending call",
      "Resource": "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:CreateExportJobFunction",
      "Parameters": {
        "dialogGroupId.$": "$.input.dialogGroupId",
        "callId.$": "$.input.callId",
        "requestedAt.$": "$$.State.EnteredTime"
      },
      "ResultPath": "$.exportJob",
      "Retry": [
        {
          "ErrorEquals": ["OCPAPIThrottlingError", "OCPAPITimeoutError"],
          "IntervalSeconds": 30,
          "MaxAttempts": 3,
          "BackoffRate": 2.0
        },
        {
          "ErrorEquals": ["Lambda.ServiceException", "Lambda.TooManyRequestsException"],
          "IntervalSeconds": 5,
          "MaxAttempts": 3,
          "BackoffRate": 2.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["OCPAPIError"],
          "ResultPath": "$.error",
          "Next": "HandleOCPAPIError"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.error",
          "Next": "HandleUnexpectedError"
        }
      ],
      "Next": "UpdateStatusExportCreated"
    },

    "UpdateStatusExportCreated": {
      "Type": "Task",
      "Comment": "Update DynamoDB with export job created status",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET exportJobId = :jobId, exportJobStatus = :status, exportCreatedAt = :createdAt, lastUpdated = :now",
        "ExpressionAttributeValues": {
          ":jobId": {
            "S.$": "$.exportJob.exportJobId"
          },
          ":status": {
            "S": "CREATED"
          },
          ":createdAt": {
            "S.$": "$$.State.EnteredTime"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "ResultPath": "$.dynamoResult",
      "Next": "WaitForExportJob"
    },

    "WaitForExportJob": {
      "Type": "Wait",
      "Comment": "Wait 5 minutes before checking export job status",
      "Seconds": 300,
      "Next": "CheckExportJobStatus"
    },

    "CheckExportJobStatus": {
      "Type": "Task",
      "Comment": "Query OCP Export API for job status",
      "Resource": "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:CheckExportStatusFunction",
      "Parameters": {
        "exportJobId.$": "$.exportJob.exportJobId",
        "dialogGroupId.$": "$.input.dialogGroupId"
      },
      "ResultPath": "$.statusCheck",
      "Retry": [
        {
          "ErrorEquals": ["OCPAPIThrottlingError", "OCPAPITimeoutError"],
          "IntervalSeconds": 15,
          "MaxAttempts": 3,
          "BackoffRate": 2.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.error",
          "Next": "HandleStatusCheckError"
        }
      ],
      "Next": "IncrementRetryCounter"
    },

    "IncrementRetryCounter": {
      "Type": "Pass",
      "Comment": "Increment the retry counter for loop control",
      "Parameters": {
        "input.$": "$.input",
        "exportJob.$": "$.exportJob",
        "statusCheck.$": "$.statusCheck",
        "context": {
          "retryCount.$": "States.MathAdd($.context.retryCount, 1)",
          "maxRetries.$": "$.context.maxRetries",
          "startedAt.$": "$.context.startedAt",
          "executionId.$": "$.context.executionId"
        }
      },
      "Next": "EvaluateExportStatus"
    },

    "EvaluateExportStatus": {
      "Type": "Choice",
      "Comment": "Determine next action based on export job status",
      "Choices": [
        {
          "Variable": "$.statusCheck.status",
          "StringEquals": "COMPLETED",
          "Next": "UpdateStatusExportCompleted"
        },
        {
          "Variable": "$.statusCheck.status",
          "StringEquals": "FAILED",
          "Next": "HandleExportJobFailed"
        },
        {
          "And": [
            {
              "Variable": "$.statusCheck.status",
              "StringEquals": "IN_PROGRESS"
            },
            {
              "Variable": "$.context.retryCount",
              "NumericGreaterThanEquals": 6
            }
          ],
          "Next": "HandleMaxRetriesExceeded"
        },
        {
          "Variable": "$.statusCheck.status",
          "StringEquals": "IN_PROGRESS",
          "Next": "UpdateStatusPolling"
        }
      ],
      "Default": "HandleUnknownStatus"
    },

    "UpdateStatusPolling": {
      "Type": "Task",
      "Comment": "Update DynamoDB with current polling iteration",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET exportJobStatus = :status, pollingIteration = :iteration, lastPolledAt = :now, lastUpdated = :now",
        "ExpressionAttributeValues": {
          ":status": {
            "S": "POLLING"
          },
          ":iteration": {
            "N.$": "States.Format('{}', $.context.retryCount)"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "ResultPath": "$.dynamoResult",
      "Next": "WaitForExportJob"
    },

    "UpdateStatusExportCompleted": {
      "Type": "Task",
      "Comment": "Update DynamoDB - export job completed successfully",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET exportJobStatus = :status, exportCompletedAt = :completedAt, lastUpdated = :now",
        "ExpressionAttributeValues": {
          ":status": {
            "S": "EXPORT_COMPLETED"
          },
          ":completedAt": {
            "S.$": "$$.State.EnteredTime"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "ResultPath": "$.dynamoResult",
      "Next": "ParallelProcessing"
    },

    "ParallelProcessing": {
      "Type": "Parallel",
      "Comment": "Execute metadata retrieval and file download in parallel",
      "Branches": [
        {
          "StartAt": "GetExportMetadata",
          "States": {
            "GetExportMetadata": {
              "Type": "Task",
              "Comment": "Retrieve metadata from OCP Export API",
              "Resource": "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:GetExportMetadataFunction",
              "Parameters": {
                "exportJobId.$": "$.exportJob.exportJobId",
                "dialogGroupId.$": "$.input.dialogGroupId"
              },
              "Retry": [
                {
                  "ErrorEquals": ["OCPAPIThrottlingError"],
                  "IntervalSeconds": 10,
                  "MaxAttempts": 3,
                  "BackoffRate": 2.0
                }
              ],
              "End": true
            }
          }
        },
        {
          "StartAt": "NotifyDownloadService",
          "States": {
            "NotifyDownloadService": {
              "Type": "Task",
              "Comment": "Send download task to Fargate service and wait for callback",
              "Resource": "arn:aws:states:::lambda:invoke.waitForTaskToken",
              "Parameters": {
                "FunctionName": "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:NotifyDownloadServiceFunction",
                "Payload": {
                  "taskToken.$": "$$.Task.Token",
                  "exportJobId.$": "$.exportJob.exportJobId",
                  "dialogGroupId.$": "$.input.dialogGroupId",
                  "callId.$": "$.input.callId",
                  "downloadUrl.$": "$.statusCheck.downloadUrl"
                }
              },
              "TimeoutSeconds": 7200,
              "HeartbeatSeconds": 600,
              "Retry": [
                {
                  "ErrorEquals": ["Lambda.ServiceException"],
                  "IntervalSeconds": 5,
                  "MaxAttempts": 2,
                  "BackoffRate": 2.0
                }
              ],
              "Catch": [
                {
                  "ErrorEquals": ["States.Timeout", "States.HeartbeatTimeout"],
                  "ResultPath": "$.downloadError",
                  "Next": "HandleDownloadTimeout"
                }
              ],
              "End": true
            },
            "HandleDownloadTimeout": {
              "Type": "Pass",
              "Comment": "Mark download as timed out but don't fail entire execution",
              "Parameters": {
                "status": "DOWNLOAD_TIMEOUT",
                "error": "Download service did not complete within timeout period"
              },
              "End": true
            }
          }
        }
      ],
      "ResultPath": "$.parallelResults",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.parallelError",
          "Next": "HandleParallelError"
        }
      ],
      "Next": "ProcessParallelResults"
    },

    "ProcessParallelResults": {
      "Type": "Task",
      "Comment": "Consolidate results from parallel branches",
      "Resource": "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:ProcessParallelResultsFunction",
      "Parameters": {
        "dialogGroupId.$": "$.input.dialogGroupId",
        "metadataResult.$": "$.parallelResults[0]",
        "downloadResult.$": "$.parallelResults[1]"
      },
      "ResultPath": "$.consolidatedResult",
      "Next": "UpdateFinalStatus"
    },

    "UpdateFinalStatus": {
      "Type": "Task",
      "Comment": "Update DynamoDB with final reconciliation status",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET reconciliationStatus = :status, completedAt = :completedAt, lastUpdated = :now, metadata = :metadata",
        "ExpressionAttributeValues": {
          ":status": {
            "S": "COMPLETED"
          },
          ":completedAt": {
            "S.$": "$$.State.EnteredTime"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          },
          ":metadata": {
            "S.$": "States.JsonToString($.consolidatedResult)"
          }
        }
      },
      "ResultPath": "$.finalUpdate",
      "Next": "ReconciliationSuccess"
    },

    "ReconciliationSuccess": {
      "Type": "Succeed",
      "Comment": "Reconciliation completed successfully"
    },

    "HandleStatusCheckError": {
      "Type": "Choice",
      "Comment": "Decide whether to retry status check or fail",
      "Choices": [
        {
          "Variable": "$.context.retryCount",
          "NumericLessThan": 6,
          "Next": "WaitBeforeStatusRetry"
        }
      ],
      "Default": "HandleMaxRetriesExceeded"
    },

    "WaitBeforeStatusRetry": {
      "Type": "Wait",
      "Comment": "Wait before retrying status check after error",
      "Seconds": 60,
      "Next": "CheckExportJobStatus"
    },

    "HandleExportJobFailed": {
      "Type": "Task",
      "Comment": "Handle case where OCP export job failed",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET reconciliationStatus = :status, failureReason = :reason, failedAt = :failedAt, lastUpdated = :now",
        "ExpressionAttributeValues": {
          ":status": {
            "S": "FAILED_EXPORT_ERROR"
          },
          ":reason": {
            "S.$": "$.statusCheck.errorMessage"
          },
          ":failedAt": {
            "S.$": "$$.State.EnteredTime"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "ResultPath": "$.failureUpdate",
      "Next": "SendToDeadLetterQueue"
    },

    "HandleMaxRetriesExceeded": {
      "Type": "Task",
      "Comment": "Handle case where max polling retries exceeded",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET reconciliationStatus = :status, failureReason = :reason, failedAt = :failedAt, lastUpdated = :now, totalPollingAttempts = :attempts",
        "ExpressionAttributeValues": {
          ":status": {
            "S": "FAILED_MAX_RETRIES"
          },
          ":reason": {
            "S": "Export job did not complete within maximum polling attempts"
          },
          ":failedAt": {
            "S.$": "$$.State.EnteredTime"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          },
          ":attempts": {
            "N.$": "States.Format('{}', $.context.retryCount)"
          }
        }
      },
      "ResultPath": "$.failureUpdate",
      "Next": "SendToDeadLetterQueue"
    },

    "HandleOCPAPIError": {
      "Type": "Task",
      "Comment": "Handle OCP API errors during job creation",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET reconciliationStatus = :status, failureReason = :reason, errorDetails = :error, failedAt = :failedAt, lastUpdated = :now",
        "ExpressionAttributeValues": {
          ":status": {
            "S": "FAILED_OCP_API_ERROR"
          },
          ":reason": {
            "S": "Failed to create export job in OCP"
          },
          ":error": {
            "S.$": "States.JsonToString($.error)"
          },
          ":failedAt": {
            "S.$": "$$.State.EnteredTime"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "ResultPath": "$.failureUpdate",
      "Next": "SendToDeadLetterQueue"
    },

    "HandleUnknownStatus": {
      "Type": "Task",
      "Comment": "Handle unexpected export job status",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET reconciliationStatus = :status, failureReason = :reason, unknownStatus = :unknownStatus, failedAt = :failedAt, lastUpdated = :now",
        "ExpressionAttributeValues": {
          ":status": {
            "S": "FAILED_UNKNOWN_STATUS"
          },
          ":reason": {
            "S": "Export job returned unexpected status"
          },
          ":unknownStatus": {
            "S.$": "$.statusCheck.status"
          },
          ":failedAt": {
            "S.$": "$$.State.EnteredTime"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "ResultPath": "$.failureUpdate",
      "Next": "SendToDeadLetterQueue"
    },

    "HandleParallelError": {
      "Type": "Task",
      "Comment": "Handle errors from parallel processing",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET reconciliationStatus = :status, failureReason = :reason, errorDetails = :error, failedAt = :failedAt, lastUpdated = :now",
        "ExpressionAttributeValues": {
          ":status": {
            "S": "FAILED_PARALLEL_ERROR"
          },
          ":reason": {
            "S": "Error during parallel processing (metadata or download)"
          },
          ":error": {
            "S.$": "States.JsonToString($.parallelError)"
          },
          ":failedAt": {
            "S.$": "$$.State.EnteredTime"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "ResultPath": "$.failureUpdate",
      "Next": "SendToDeadLetterQueue"
    },

    "HandleUnexpectedError": {
      "Type": "Task",
      "Comment": "Catch-all for unexpected errors",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ReconciliationTableName}",
        "Key": {
          "PK": {
            "S.$": "States.Format('CALL#{}', $.input.dialogGroupId)"
          },
          "SK": {
            "S": "RECONCILIATION"
          }
        },
        "UpdateExpression": "SET reconciliationStatus = :status, failureReason = :reason, errorDetails = :error, failedAt = :failedAt, lastUpdated = :now",
        "ExpressionAttributeValues": {
          ":status": {
            "S": "FAILED_UNEXPECTED_ERROR"
          },
          ":reason": {
            "S": "Unexpected error during reconciliation"
          },
          ":error": {
            "S.$": "States.JsonToString($.error)"
          },
          ":failedAt": {
            "S.$": "$$.State.EnteredTime"
          },
          ":now": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "ResultPath": "$.failureUpdate",
      "Next": "SendToDeadLetterQueue"
    },

    "SendToDeadLetterQueue": {
      "Type": "Task",
      "Comment": "Send failed reconciliation to DLQ for manual review or reprocessing",
      "Resource": "arn:aws:states:::sqs:sendMessage",
      "Parameters": {
        "QueueUrl": "${DeadLetterQueueUrl}",
        "MessageBody": {
          "dialogGroupId.$": "$.input.dialogGroupId",
          "callId.$": "$.input.callId",
          "exportJobId.$": "$.exportJob.exportJobId",
          "failureReason.$": "$.failureUpdate.Attributes.failureReason.S",
          "reconciliationStatus.$": "$.failureUpdate.Attributes.reconciliationStatus.S",
          "executionId.$": "$.context.executionId",
          "failedAt.$": "$$.State.EnteredTime"
        },
        "MessageAttributes": {
          "FailureType": {
            "DataType": "String",
            "StringValue.$": "$.failureUpdate.Attributes.reconciliationStatus.S"
          }
        }
      },
      "ResultPath": "$.dlqResult",
      "Next": "ReconciliationFailed"
    },

    "ReconciliationFailed": {
      "Type": "Fail",
      "Comment": "Reconciliation failed after error handling",
      "Error": "ReconciliationFailed",
      "Cause": "Reconciliation process failed - see DynamoDB and DLQ for details"
    }
  }
}
```

---

## Visual State Machine Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           STATE MACHINE VISUALIZATION                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                              ┌──────────────┐                                   │
│                              │  Initialize  │                                   │
│                              └──────┬───────┘                                   │
│                                     │                                           │
│                                     ▼                                           │
│                          ┌───────────────────┐                                  │
│                          │ CreateExportJob   │───────────────┐                  │
│                          │     (Lambda)      │               │                  │
│                          └─────────┬─────────┘               │ Error            │
│                                    │                         │                  │
│                                    ▼                         ▼                  │
│                     ┌────────────────────────────┐  ┌─────────────────┐        │
│                     │ UpdateStatusExportCreated  │  │HandleOCPAPIError│────┐   │
│                     │        (DynamoDB)          │  └─────────────────┘    │   │
│                     └─────────────┬──────────────┘                         │   │
│                                   │                                        │   │
│    ┌──────────────────────────────┼──────────────────────────────────────┐ │   │
│    │   POLLING LOOP               │                                      │ │   │
│    │   ┌──────────────────────────┼────────────────────────────────────┐ │ │   │
│    │   │                          ▼                                    │ │ │   │
│    │   │               ┌───────────────────┐                           │ │ │   │
│    │   │    ┌─────────►│  WaitForExportJob │                           │ │ │   │
│    │   │    │          │    (5 minutes)    │                           │ │ │   │
│    │   │    │          └─────────┬─────────┘                           │ │ │   │
│    │   │    │                    │                                     │ │ │   │
│    │   │    │                    ▼                                     │ │ │   │
│    │   │    │         ┌────────────────────┐                           │ │ │   │
│    │   │    │         │CheckExportJobStatus│                           │ │ │   │
│    │   │    │         │     (Lambda)       │                           │ │ │   │
│    │   │    │         └─────────┬──────────┘                           │ │ │   │
│    │   │    │                   │                                      │ │ │   │
│    │   │    │                   ▼                                      │ │ │   │
│    │   │    │        ┌────────────────────┐                            │ │ │   │
│    │   │    │        │IncrementRetryCount │                            │ │ │   │
│    │   │    │        └─────────┬──────────┘                            │ │ │   │
│    │   │    │                  │                                       │ │ │   │
│    │   │    │                  ▼                                       │ │ │   │
│    │   │    │       ┌─────────────────────┐                            │ │ │   │
│    │   │    │       │ EvaluateExportStatus│                            │ │ │   │
│    │   │    │       │      (Choice)       │                            │ │ │   │
│    │   │    │       └─────────┬───────────┘                            │ │ │   │
│    │   │    │                 │                                        │ │ │   │
│    │   │    │    ┌────────────┼────────────┬──────────────┐           │ │ │   │
│    │   │    │    │            │            │              │           │ │ │   │
│    │   │    │    ▼            ▼            ▼              ▼           │ │ │   │
│    │   │    │ COMPLETED   IN_PROGRESS   FAILED     MAX_RETRIES       │ │ │   │
│    │   │    │    │            │            │              │           │ │ │   │
│    │   │    │    │            │            │              │           │ │ │   │
│    │   │    │    │            ▼            │              │           │ │ │   │
│    │   │    │    │   ┌────────────────┐    │              │           │ │ │   │
│    │   │    │    │   │UpdateStatus    │    │              │           │ │ │   │
│    │   │    └────┼───│Polling         │    │              │           │ │ │   │
│    │   │         │   └────────────────┘    │              │           │ │ │   │
│    │   │         │                         │              │           │ │ │   │
│    │   └─────────┼─────────────────────────┼──────────────┼───────────┘ │ │   │
│    └─────────────┼─────────────────────────┼──────────────┼─────────────┘ │   │
│                  │                         │              │               │   │
│                  │                         ▼              ▼               │   │
│                  │              ┌──────────────────────────────┐          │   │
│                  │              │  HandleExportJobFailed /     │──────────┤   │
│                  │              │  HandleMaxRetriesExceeded    │          │   │
│                  │              └──────────────────────────────┘          │   │
│                  │                                                        │   │
│                  ▼                                                        │   │
│    ┌─────────────────────────────┐                                       │   │
│    │UpdateStatusExportCompleted  │                                       │   │
│    └─────────────┬───────────────┘                                       │   │
│                  │                                                        │   │
│                  ▼                                                        │   │
│    ╔═════════════════════════════════════════════════════════╗           │   │
│    ║              PARALLEL PROCESSING                        ║           │   │
│    ║  ┌─────────────────────┐  ┌─────────────────────────┐  ║           │   │
│    ║  │  Branch A:          │  │  Branch B:              │  ║           │   │
│    ║  │  GetExportMetadata  │  │  NotifyDownloadService  │  ║           │   │
│    ║  │  (Lambda)           │  │  (Lambda+Callback)      │  ║           │   │
│    ║  │                     │  │                         │  ║           │   │
│    ║  │                     │  │  TimeoutSeconds: 7200   │  ║           │   │
│    ║  │                     │  │  HeartbeatSeconds: 600  │  ║           │   │
│    ║  └─────────────────────┘  └─────────────────────────┘  ║           │   │
│    ╚═══════════════════════════════╤═════════════════════════╝           │   │
│                                    │                                     │   │
│                                    ▼                                     │   │
│                      ┌─────────────────────────┐                         │   │
│                      │  ProcessParallelResults │                         │   │
│                      │        (Lambda)         │                         │   │
│                      └────────────┬────────────┘                         │   │
│                                   │                                      │   │
│                                   ▼                                      │   │
│                       ┌───────────────────────┐                          │   │
│                       │   UpdateFinalStatus   │                          │   │
│                       │      (DynamoDB)       │                          │   │
│                       └───────────┬───────────┘                          │   │
│                                   │                                      │   │
│                                   ▼                                      │   │
│                       ╔═══════════════════════╗                          │   │
│                       ║ ReconciliationSuccess ║                          │   │
│                       ╚═══════════════════════╝                          │   │
│                                                                          │   │
│                                                                          │   │
│    ┌─────────────────────────────────────────────────────────────────────┘   │
│    │                                                                         │
│    │   ERROR HANDLING PATH                                                   │
│    │   ┌─────────────────────────────────────────────────────────────────┐  │
│    │   │                                                                 │  │
│    │   ▼                                                                 │  │
│    │   ┌─────────────────────────┐                                       │  │
│    │   │  SendToDeadLetterQueue  │                                       │  │
│    │   │        (SQS)            │                                       │  │
│    │   └────────────┬────────────┘                                       │  │
│    │                │                                                    │  │
│    │                ▼                                                    │  │
│    │   ╔═══════════════════════════╗                                     │  │
│    │   ║  ReconciliationFailed     ║                                     │  │
│    │   ╚═══════════════════════════╝                                     │  │
│    │                                                                     │  │
│    └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Input/Output Specifications

### Step Function Input (from SQS via Lambda Trigger)

```json
{
  "dialogGroupId": "DG-2024-001234",
  "callId": "CALL-5678-ABCD",
  "originalTimestamp": "2024-01-15T10:30:00Z",
  "retryAttempt": 0,
  "source": "RECONCILIATION_QUEUE"
}
```

### Lambda Function Contracts

#### 1. CreateExportJobFunction

```
Input:
{
  "dialogGroupId": "DG-2024-001234",
  "callId": "CALL-5678-ABCD",
  "requestedAt": "2024-01-15T10:35:00Z"
}

Output (Success):
{
  "exportJobId": "EXP-JOB-9999",
  "status": "CREATED",
  "estimatedCompletionTime": "2024-01-15T10:45:00Z"
}

Output (Error):
{
  "errorType": "OCPAPIError",
  "errorMessage": "Failed to create export job: Rate limit exceeded"
}
```

#### 2. CheckExportStatusFunction

```
Input:
{
  "exportJobId": "EXP-JOB-9999",
  "dialogGroupId": "DG-2024-001234"
}

Output (In Progress):
{
  "status": "IN_PROGRESS",
  "progress": 45,
  "estimatedSecondsRemaining": 180
}

Output (Completed):
{
  "status": "COMPLETED",
  "downloadUrl": "https://ocp-export.example.com/files/EXP-JOB-9999.zip",
  "fileSize": 15728640,
  "completedAt": "2024-01-15T10:42:00Z"
}

Output (Failed):
{
  "status": "FAILED",
  "errorMessage": "Audio file not found in storage"
}
```

#### 3. GetExportMetadataFunction

```
Input:
{
  "exportJobId": "EXP-JOB-9999",
  "dialogGroupId": "DG-2024-001234"
}

Output:
{
  "metadata": {
    "duration": 324,
    "channels": 2,
    "sampleRate": 8000,
    "format": "WAV",
    "agentId": "AGENT-001",
    "queueName": "Sales"
  }
}
```

#### 4. NotifyDownloadServiceFunction

```
Input:
{
  "taskToken": "AAAA...long-token...ZZZZ",
  "exportJobId": "EXP-JOB-9999",
  "dialogGroupId": "DG-2024-001234",
  "callId": "CALL-5678-ABCD",
  "downloadUrl": "https://ocp-export.example.com/files/EXP-JOB-9999.zip"
}

Action:
- Sends message to SQS (Orchestrator queue) with taskToken
- Does NOT wait for download completion

Output:
{
  "notificationSent": true,
  "sqsMessageId": "MSG-12345"
}
```

---

## DynamoDB Table Schema

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         RECONCILIATION TABLE                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Table Name: ReconciliationTable                                                 │
│                                                                                  │
│  Primary Key:                                                                    │
│    PK (Partition Key): CALL#{dialogGroupId}                                     │
│    SK (Sort Key): RECONCILIATION                                                │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │ Attribute              │ Type   │ Description                          │    │
│  ├────────────────────────┼────────┼──────────────────────────────────────┤    │
│  │ PK                     │ String │ CALL#DG-2024-001234                  │    │
│  │ SK                     │ String │ RECONCILIATION                       │    │
│  │ dialogGroupId          │ String │ DG-2024-001234                       │    │
│  │ callId                 │ String │ CALL-5678-ABCD                       │    │
│  │ exportJobId            │ String │ EXP-JOB-9999                         │    │
│  │ exportJobStatus        │ String │ CREATED|POLLING|EXPORT_COMPLETED     │    │
│  │ reconciliationStatus   │ String │ IN_PROGRESS|COMPLETED|FAILED_*       │    │
│  │ pollingIteration       │ Number │ 3                                    │    │
│  │ exportCreatedAt        │ String │ ISO 8601 timestamp                   │    │
│  │ exportCompletedAt      │ String │ ISO 8601 timestamp                   │    │
│  │ lastPolledAt           │ String │ ISO 8601 timestamp                   │    │
│  │ completedAt            │ String │ ISO 8601 timestamp                   │    │
│  │ failedAt               │ String │ ISO 8601 timestamp                   │    │
│  │ failureReason          │ String │ Error description                    │    │
│  │ errorDetails           │ String │ JSON string with error context       │    │
│  │ metadata               │ String │ JSON string with call metadata       │    │
│  │ lastUpdated            │ String │ ISO 8601 timestamp                   │    │
│  │ sfExecutionId          │ String │ Step Function execution ARN          │    │
│  │ TTL                    │ Number │ Epoch timestamp for auto-cleanup     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  GSI: StatusIndex                                                               │
│    PK: reconciliationStatus                                                     │
│    SK: lastUpdated                                                              │
│    (For querying failed reconciliations, monitoring dashboards)                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Cost Estimation (Revisited)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    COST BREAKDOWN: 10K Reconciliations/Day                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Scenario: Average 3 polling iterations per reconciliation                       │
│                                                                                  │
│  STATE TRANSITIONS PER EXECUTION:                                               │
│  ┌────────────────────────────────────────┬──────────────┐                      │
│  │ State                                  │ Transitions  │                      │
│  ├────────────────────────────────────────┼──────────────┤                      │
│  │ Initialize                             │ 1            │                      │
│  │ CreateExportJob                        │ 1            │                      │
│  │ UpdateStatusExportCreated              │ 1            │                      │
│  │ WaitForExportJob (×3 iterations)       │ 6            │ (2 per wait)         │
│  │ CheckExportJobStatus (×3)              │ 3            │                      │
│  │ IncrementRetryCounter (×3)             │ 3            │                      │
│  │ EvaluateExportStatus (×3)              │ 3            │                      │
│  │ UpdateStatusPolling (×2)               │ 2            │                      │
│  │ UpdateStatusExportCompleted            │ 1            │                      │
│  │ Parallel (entry + 2 branches)          │ 3            │                      │
│  │ ProcessParallelResults                 │ 1            │                      │
│  │ UpdateFinalStatus                      │ 1            │                      │
│  │ ReconciliationSuccess                  │ 1            │                      │
│  ├────────────────────────────────────────┼──────────────┤                      │
│  │ TOTAL                                  │ 27           │                      │
│  └────────────────────────────────────────┴──────────────┘                      │
│                                                                                  │
│  MONTHLY COST:                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │ Step Functions:                                                        │     │
│  │   10K × 27 transitions × 30 days = 8.1M transitions                   │     │
│  │   $0.025 per 1K = $202.50/month                                       │     │
│  │                                                                        │     │
│  │ Lambda (5 functions × ~3 invocations each):                           │     │
│  │   10K × 15 invocations × 30 days = 4.5M invocations                   │     │
│  │   ~$1/month                                                            │     │
│  │                                                                        │     │
│  │ DynamoDB (On-Demand):                                                  │     │
│  │   ~8 writes per execution = 2.4M WCU/month = ~$3/month                │     │
│  │   ~2 reads per execution = 600K RCU/month = ~$0.15/month              │     │
│  │                                                                        │     │
│  │ SQS (DLQ - assuming 1% failure rate):                                 │     │
│  │   ~3K messages/month = negligible                                     │     │
│  ├────────────────────────────────────────────────────────────────────────┤     │
│  │ TOTAL ESTIMATED: ~$210/month                                          │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
│  Note: This is higher than initial ADR estimate due to more accurate            │
│  counting of all state transitions including DynamoDB updates and               │
│  parallel branch overhead.                                                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Fargate Callback Integration

When the Fargate download service completes, it must call Step Functions API:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    FARGATE → STEP FUNCTIONS CALLBACK                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  On Success:                                                                    │
│  ───────────                                                                    │
│  aws stepfunctions send-task-success \                                          │
│    --task-token "AAAA...taskToken...ZZZZ" \                                    │
│    --task-output '{"status":"SUCCESS","filePath":"s3://bucket/audio.wav"}'     │
│                                                                                  │
│  On Failure:                                                                    │
│  ──────────                                                                     │
│  aws stepfunctions send-task-failure \                                          │
│    --task-token "AAAA...taskToken...ZZZZ" \                                    │
│    --error "DownloadFailed" \                                                   │
│    --cause "Connection timeout to OCP server"                                   │
│                                                                                  │
│  Heartbeat (if still processing):                                               │
│  ─────────────────────────────────                                              │
│  aws stepfunctions send-task-heartbeat \                                        │
│    --task-token "AAAA...taskToken...ZZZZ"                                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

Do you want me to create the actual file with this Step Function definition, or would you like me to elaborate on any specific part of the implementation?