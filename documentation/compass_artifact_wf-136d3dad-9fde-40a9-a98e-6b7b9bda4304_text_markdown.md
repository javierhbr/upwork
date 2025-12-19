# Java with virtual threads wins for this Fargate file processing workload

**Java 21+ with virtual threads is the optimal choice** for this export processing service, outperforming Node.js specifically because of the mixed I/O-bound and CPU-intensive workload pattern. The architecture should use **2 vCPU / 8GB memory Fargate tasks** with **150GB ephemeral storage**, pulling single messages from SQS with a heartbeat-based visibility extension pattern that accommodates jobs lasting up to 12 hours.

The key insight driving the language recommendation: while Node.js excels at pure I/O workloads, ZIP extraction creates CPU-intensive bursts that block the event loop. Java's virtual threads handle I/O elegantly (downloads, DynamoDB validation, S3 uploads) while platform threads manage CPU-bound decompression without architectural workarounds. Apache Commons Compress also provides superior Zip64 support for files exceeding 4GB—a likely scenario given the "hundreds of MB to GB" requirement.

## Why Java virtual threads beat Node.js for this specific workload

The workload pattern—downloading files, extracting ZIPs, validating, uploading—appears I/O-dominant but contains a critical CPU bottleneck. ZIP decompression is computationally intensive, and in Node.js, this blocks the event loop despite streaming. While Node.js can offload this to worker threads or rely on libuv's threadpool for zlib operations, this adds architectural complexity and still limits parallelism to the number of cores.

Java 21's virtual threads fundamentally change the concurrency model. When a virtual thread blocks on I/O (downloading from the export API, calling DynamoDB, uploading to S3), the JVM "unmounts" it from the carrier thread, allowing other virtual threads to execute. This means simple, synchronous code achieves reactive-level performance without callbacks or async/await complexity. For CPU-intensive ZIP extraction, standard platform threads in `ForkJoinPool.commonPool()` handle the work efficiently.

**Memory management favors Java for multi-hour jobs**. Node.js has a practical heap limit of **~1.7GB** (expandable via `--max-old-space-size`, but with diminishing returns). Long-running Node.js processes face memory leak risks from closures, uncleaned event listeners, and unbounded caches. Java's generational garbage collection handles multi-hour processes reliably, and the JVM heap can scale to Fargate's memory limits. For streaming large ZIP extraction, Apache Commons Compress transparently supports Zip64 extensions (files >4GB, archives with >65K entries), while Node.js libraries like `yauzl` and `unzipper` require careful configuration.

Cold start differences matter less than they appear. JVM warm-up adds 5-15 seconds to Java startup, but for jobs lasting hours, this overhead is negligible. If most jobs are short (5-15 minutes), consider GraalVM native-image compilation for near-instant startup, though this adds build complexity.

## SQS consumer architecture must handle multi-hour jobs

The critical constraint is SQS's **12-hour maximum visibility timeout**—an absolute ceiling that cannot be reset. For jobs potentially lasting hours, the architecture must use a heartbeat pattern rather than setting a long initial visibility timeout.

**Recommended configuration**: Set initial visibility timeout to **5 minutes (300 seconds)**, then extend it every **2-3 minutes** using `ChangeMessageVisibility`. This approach keeps messages invisible while processing but allows quick redelivery if the worker crashes without sending a heartbeat. The extension call sets a new timeout from the current moment—calling `ChangeMessageVisibility` with 300 seconds after 4 minutes of processing gives 5 more minutes, not 5 minutes from the original receipt.

**Batch size must be 1** for this workload. When jobs vary from 5 minutes to several hours, processing multiple messages creates heartbeat complexity (tracking separate timeouts for each) and risks exceeding the 12-hour limit on some messages while working on others. Each Fargate task should process one message at a time, scaling horizontally for throughput.

The consumer loop should be pull-based, not Lambda-triggered (Lambda's 15-minute timeout is insufficient). Use **20-second long polling** (the maximum) to reduce empty responses and costs. With a 60-minute latency tolerance, this polling interval is optimal. Before each poll, acquire ECS Task Scale-In Protection via the `$ECS_AGENT_URI/task-protection/v1/state` endpoint, then release it after message deletion. This prevents auto-scaling from terminating tasks mid-job—protection can extend up to **48 hours**.

For the dead letter queue, set `maxReceiveCount` to **3-5**. With heartbeats working correctly, legitimate processing never increments the receive count; each receive typically indicates a failure. Setting it to 1 is dangerous—a failed `ReceiveMessage` call can inadvertently move a message to the DLQ.

## Fargate task sizing balances I/O efficiency with CPU bursts

The recommended configuration is **2 vCPU, 8GB memory, 150GB ephemeral storage**. This sizing reflects the workload's characteristics: predominantly I/O-bound with periodic CPU spikes during decompression.

Network throughput scales with vCPU allocation on Fargate, making 2 vCPU essential for downloading large files efficiently. The 8GB memory provides headroom for streaming buffers (ZIP libraries typically need **2-4x compressed size** for efficient streaming), Java heap space, and container overhead. Memory is relatively cheap at **$0.004445/GB-hour** compared to the cost of job failures from OOM errors.

Ephemeral storage should be **100-150GB**. The default 20GB is insufficient for extracting multi-GB ZIP files. At **$0.000111/GB-hour** for storage beyond 20GB, the cost for 150GB ephemeral storage is approximately $0.014/hour—negligible compared to compute costs. Ephemeral storage provides local SSD-like performance, far superior to EFS for the random I/O patterns of ZIP extraction. Reserve EFS for checkpointing if implementing Spot instance support.

**Scaling strategy**: Use target tracking auto-scaling with a custom "backlog per task" metric rather than raw `ApproximateNumberOfMessagesVisible`. The formula is `ApproximateNumberOfMessages / RunningTaskCount`, with a target based on `acceptable_latency / average_job_duration`. For a 60-minute latency tolerance with 30-minute average jobs, target 2 messages per task. Set scale-out cooldown to **2 minutes** (react quickly to spikes) and scale-in cooldown to **5-10 minutes** (conservative for long jobs).

**Spot viability is limited** for this workload. Fargate Spot provides only a 2-minute interruption warning—insufficient for checkpointing multi-hour jobs. The recommended approach is a hybrid capacity provider strategy: `FARGATE (base=2, weight=1)` for reliable baseline capacity, `FARGATE_SPOT (base=0, weight=3)` for burst capacity during 3-5x peak spikes. Route short jobs (<30 minutes) to Spot-eligible tasks; ensure long jobs run on On-Demand capacity or implement robust checkpoint/resume logic.

## Streaming architecture minimizes memory pressure

The file processing pipeline should stream data end-to-end without buffering entire files in memory. The pattern: download stream → ZIP parser stream → validation → S3 multipart upload stream.

For ZIP extraction, use streaming libraries that process entries as they're read. In Java, Apache Commons Compress with `ZipInputStream` provides streaming access. In Node.js (if chosen), `unzipper` with `forceStream: true` enables entry-by-entry streaming. Critical caveat: ZIP format stores the central directory at the end of the file, so true streaming extraction may report incorrect sizes for some entries. For reliable extraction of very large archives, download to ephemeral storage first, then use random-access extraction.

**S3 uploads require `@aws-sdk/lib-storage`** (Node.js) or the SDK's built-in multipart upload (Java) for streaming. Configure **10-50MB part sizes** (larger for faster uploads, smaller for reliability) and **2-4 concurrent part uploads** (queue size). The pattern pipes ZIP entry streams directly to S3 upload bodies through PassThrough streams, avoiding intermediate disk writes for files under a few hundred MB.

For parallel file processing within a job, use bounded concurrency. In Java, a `Semaphore` or `ExecutorService` limits concurrent operations. In Node.js, `p-limit` or `p-queue` provides this control. Set concurrency based on memory constraints—processing 5 files concurrently with each buffering 100MB requires 500MB of headroom. Implement backpressure: pause extraction when upload queue depth exceeds a threshold.

**Cleanup is critical**. On SIGTERM or job failure, abort incomplete S3 multipart uploads (they incur storage costs indefinitely) and delete temporary files from ephemeral storage. Implement a periodic cleanup job or S3 lifecycle rule to abort multipart uploads older than 24 hours.

## Idempotency and reliability require DynamoDB state tracking

At-least-once SQS delivery combined with multi-hour jobs creates significant duplicate risk. The solution: use DynamoDB conditional writes to track job state with message ID as the idempotency key.

**Job tracking schema**:
- **PK**: `msg#{message_id}`, **SK**: `JOB`
- **Attributes**: `status` (PENDING/IN_PROGRESS/COMPLETE/FAILED), `in_progress_expiry` (timestamp), `checkpoint_data` (Map), `worker_id` (Fargate task ARN), `ttl` (24-48 hours for auto-cleanup)

Before processing, attempt a conditional put: `ConditionExpression: "attribute_not_exists(pk) OR #exp < :now"`. If `ConditionalCheckFailedException` occurs, another worker is processing or has completed this message—either skip or return the cached result. The `in_progress_expiry` handles cases where a worker crashes without updating status; after expiry, another worker can claim the job.

**S3 conditional writes** (released August 2024) provide output idempotency. Use `If-None-Match: "*"` header on PutObject—the request fails with HTTP 412 if the object already exists. Combine this with content-addressable key patterns like `{message_id}/{content_hash}.ext` for natural deduplication.

**Checkpointing for multi-hour jobs**: Save progress to DynamoDB every 5-10 minutes or every 10,000 records. Store `bytes_processed`, `records_processed`, `last_processed_record_id`. On job restart (after worker crash or Spot interruption), query for the latest checkpoint and resume from that position. For very large state (>400KB), store checkpoint metadata in DynamoDB with a reference to full state in S3.

**Graceful shutdown**: Configure `stopTimeout: 120` seconds in the task definition (Fargate maximum). Handle SIGTERM in application code: set a shutdown flag, wait for current operation to complete or reach a checkpoint, save final checkpoint, extend SQS visibility timeout to 0 (makes message immediately visible for another worker), then exit. Enable `initProcessEnabled: true` in Linux parameters to ensure signals reach the application rather than being trapped by the shell.

## Concrete implementation recommendations

The production architecture should follow this pattern:

**Task definition**: 2 vCPU, 8192 MB memory, 150 GiB ephemeral storage, `stopTimeout: 120`, single container with tini init process enabled.

**SQS configuration**: Standard queue (not FIFO—throughput matters more than ordering), `VisibilityTimeout: 300` (5 minutes base), `ReceiveMessageWaitTimeSeconds: 20`, `MessageRetentionPeriod: 14 days`. DLQ with `maxReceiveCount: 5`.

**Application loop**: Poll with `MaxNumberOfMessages: 1`, acquire task protection, start heartbeat thread (extend visibility every 2-3 minutes), process message with checkpointing, delete message on success, release task protection. On failure, save checkpoint and let visibility timeout return message to queue.

**Capacity providers**: `FARGATE base=2 weight=1`, `FARGATE_SPOT base=0 weight=3`. Minimum capacity 2 tasks, maximum based on peak throughput calculation (~100-200 for 500K messages with 30-minute average processing).

**DynamoDB tables**: Job tracking table with TTL enabled, on-demand capacity mode (handles spikes without provisioning). GSI on `status-updated_at` for finding stuck jobs.

**Monitoring**: CloudWatch alarms on DLQ depth >0, `ApproximateAgeOfOldestMessage` exceeding latency SLO, jobs in IN_PROGRESS state exceeding 2x expected duration. Custom metrics for job duration, records processed, checkpoint frequency.

For Java specifically: use Java 21+ with `Executors.newVirtualThreadPerTaskExecutor()` for I/O operations, `ForkJoinPool.commonPool()` for ZIP extraction. Apache Commons Compress for Zip64 support. AWS SDK v2 with async clients wrapping virtual thread executors. If team strongly prefers TypeScript, Node.js with `unzipper`, `@aws-sdk/lib-storage`, and `worker_threads` for CPU-bound work is viable but requires more careful memory management and event loop monitoring.