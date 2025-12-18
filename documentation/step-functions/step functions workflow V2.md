I'll create all the files for the complete implementation.I've created the complete implementation. Here's the summary of all files:

## Project Structure

```
reconciliation-step-function/
├── template.yaml                    # CloudFormation/SAM template
├── samconfig.toml                   # SAM CLI configuration
├── README.md                        # Documentation
├── state-machine/
│   └── reconciliation-state-machine.asl.json  # Step Function (ASL)
├── lambdas/
│   ├── requirements.txt
│   ├── shared/
│   │   └── utils.py                 # Shared utilities, OCP client, exceptions
│   ├── create_export_job/
│   │   └── handler.py               # Creates OCP job + updates DynamoDB
│   ├── check_export_status/
│   │   └── handler.py               # Polls OCP for job status
│   ├── get_export_metadata/
│   │   └── handler.py               # Retrieves call metadata
│   ├── notify_download_service/
│   │   └── handler.py               # Notifies Fargate + stores task token
│   ├── process_parallel_results/
│   │   └── handler.py               # Consolidates parallel results
│   └── trigger_reconciliation/
│       └── handler.py               # SQS trigger for Step Function
└── events/                          # Sample test events
    ├── step_function_input.json
    ├── create_export_job_event.json
    ├── check_export_status_event.json
    ├── notify_download_service_event.json
    ├── process_parallel_results_event.json
    └── sqs_trigger_event.json
```

## Key Features Implemented

|Feature|Details|
|---|---|
|**Global Timeout**|6 hours (configurable)|
|**Download Timeout**|5 hours (configurable)|
|**Heartbeat**|10 min interval (configurable)|
|**Polling Interval**|5 min (configurable)|
|**Max Retries**|6 iterations (configurable)|
|**Error Handling**|All paths → DLQ with context|
|**Task Token Storage**|DynamoDB for recovery|
|**Idempotency**|Prevents duplicate processing|

## Download Links

- [Download ZIP](https://claude.ai/chat/ccb3c386-ea5f-4191-a618-cbc437341c71)
- [View Project Folder](https://claude.ai/chat/ccb3c386-ea5f-4191-a618-cbc437341c71)

## Deployment

```bash
# Build and deploy
sam build
sam deploy --guided

# Or deploy to specific environment
sam deploy --config-env prod
```