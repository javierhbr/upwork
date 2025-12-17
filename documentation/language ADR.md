# Architecture Decision Record: Language and Framework Selection for Export Processing Service

## Question

What programming language and framework should be used to build the Export Processing Service that handles 100,000 daily events with highly variable job durations (5 minutes to hours), consisting primarily of I/O-bound operations (HTTP downloads, S3 uploads, SQS polling) with occasional CPU-intensive tasks (ZIP extraction)?

## Assumptions

1. **Workload Characteristics**: 90% I/O-bound (network calls, file operations), 10% CPU-bound (ZIP extraction, validation)
2. **Concurrency Requirements**: Must handle multiple concurrent downloads, uploads, and API calls efficiently
3. **Runtime Environment**: AWS Fargate with Linux containers
4. **Team Expertise**: Team has primary experience with TypeScript/JavaScript, secondary experience with Java, limited experience with Go/Rust
5. **Maintenance Horizon**: Service expected to be maintained for 3-5 years
6. **Integration Requirements**: AWS SDK support is critical (SQS, S3, DynamoDB)
7. **Observability**: Must integrate with AWS CloudWatch, X-Ray
8. **Development Velocity**: Initial delivery within 6-8 weeks is desired
9. **Hiring Considerations**: Should use technology with reasonable talent pool availability
10. **Existing Infrastructure**: CI/CD pipelines exist for Node.js and Java applications

## Options Considered

### Option 1: Node.js with TypeScript and NestJS

A TypeScript-based solution using NestJS framework, leveraging Node.js's event loop for I/O concurrency and Worker Threads for CPU-intensive operations.

```
┌─────────────────────────────────────────────────────┐
│                 NestJS Application                   │
│  ┌───────────────────────────────────────────────┐  │
│  │              Main Thread (Event Loop)          │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────────────┐ │  │
│  │  │ SQS     │ │ HTTP    │ │ Dependency      │ │  │
│  │  │ Module  │ │ Module  │ │ Injection       │ │  │
│  │  └─────────┘ └─────────┘ └─────────────────┘ │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │           Worker Threads (CPU tasks)          │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐        │  │
│  │  │ Worker1 │ │ Worker2 │ │ WorkerN │        │  │
│  │  └─────────┘ └─────────┘ └─────────┘        │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Technology Stack:**

- Runtime: Node.js 20 LTS
- Language: TypeScript 5.x
- Framework: NestJS 10.x
- AWS SDK: @aws-sdk/client-* v3
- HTTP Client: undici (Node.js native)
- ZIP Handling: unzipper, archiver

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|Event loop blocking during CPU tasks|Medium|High|Worker Threads for ZIP extraction|
|Memory issues with large files|Medium|Medium|Streaming APIs, memory limits|
|Callback hell / complexity|Low|Low|async/await, proper patterns|
|Single-threaded limitations|Medium|Medium|Worker Threads, horizontal scaling|
|GC pauses affecting latency|Low|Low|Streaming, avoid large object allocations|

#### Pros

- **Excellent I/O Performance**: Event loop model is ideal for I/O-bound workloads
- **Team Expertise**: Primary team skill set, minimal learning curve
- **Type Safety**: TypeScript provides compile-time type checking
- **Rich Ecosystem**: npm has extensive library support for all requirements
- **NestJS Benefits**:
    - Dependency injection out of the box
    - Modular architecture enforced by framework
    - Built-in support for microservices patterns
    - Excellent documentation and community
    - Testing utilities included
- **AWS SDK Excellence**: First-class AWS SDK v3 support with modular imports
- **Worker Threads**: Native solution for CPU-bound tasks without external dependencies
- **Fast Development**: High velocity due to team familiarity
- **Debugging**: Excellent tooling (VS Code, Chrome DevTools)
- **Hiring**: Large talent pool for TypeScript/Node.js developers

#### Cons

- **CPU-Bound Limitations**: Event loop blocks on CPU tasks without Worker Threads
- **Memory Model**: V8 heap limits require careful memory management
- **Runtime Overhead**: Higher memory footprint than compiled languages
- **Concurrency Model**: Less intuitive than native thread/goroutine models
- **Cold Start**: Slower container startup than compiled languages
- **NestJS Overhead**: Framework abstractions add some performance cost

---

### Option 2: Go with Standard Library

A Go-based solution using the standard library and minimal dependencies, leveraging goroutines for native concurrency.

```
┌─────────────────────────────────────────────────────┐
│                  Go Application                      │
│  ┌───────────────────────────────────────────────┐  │
│  │              Go Runtime Scheduler              │  │
│  │  ┌──────────────────────────────────────────┐ │  │
│  │  │         Goroutine Pool (thousands)       │ │  │
│  │  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │ │  │
│  │  │  │ G1 │ │ G2 │ │ G3 │ │ G4 │ │ GN │    │ │  │
│  │  │  └────┘ └────┘ └────┘ └────┘ └────┘    │ │  │
│  │  └──────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │    Channels for coordination & backpressure   │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Technology Stack:**

- Runtime: Go 1.21+
- Framework: Standard library (net/http, context)
- AWS SDK: aws-sdk-go-v2
- HTTP Client: net/http with connection pooling
- ZIP Handling: archive/zip (standard library)

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|Team learning curve|High|Medium|Training, pair programming, longer timeline|
|Error handling verbosity|Medium|Low|Consistent patterns, linting|
|Goroutine leaks|Medium|Medium|Context cancellation, proper cleanup|
|Dependency management complexity|Low|Low|Go modules, minimal deps|
|Debugging complexity|Medium|Low|Delve debugger, proper logging|

#### Pros

- **Superior Concurrency**: Goroutines are lightweight (~2KB stack) vs OS threads (~1MB)
- **Native Parallelism**: True parallel execution without additional patterns
- **Performance**: Compiled binary with minimal runtime overhead
- **Memory Efficiency**: Lower memory footprint per concurrent operation
- **Fast Cold Start**: Small binary size, near-instant startup
- **Standard Library**: Comprehensive stdlib reduces external dependencies
- **Garbage Collection**: Modern GC with sub-millisecond pauses
- **Static Binary**: Single binary deployment, no runtime dependencies
- **AWS SDK**: Mature aws-sdk-go-v2 with excellent performance
- **Error Handling**: Explicit error handling prevents silent failures
- **Built-in Profiling**: pprof for CPU and memory profiling

#### Cons

- **Team Learning Curve**: Significant investment needed for team proficiency
- **Development Velocity**: Initially slower due to unfamiliarity
- **Verbose Error Handling**: Repetitive `if err != nil` patterns
- **Less Framework Structure**: No opinionated framework like NestJS
- **Generic Support**: Recent generics still maturing ecosystem
- **Smaller Ecosystem**: Fewer libraries than npm (though sufficient for AWS)
- **Testing Patterns**: Different testing idioms than TypeScript
- **Hiring Pool**: Smaller than JavaScript, though growing

---

### Option 3: Java with Spring Boot

A Java-based solution using Spring Boot framework with Project Reactor for reactive, non-blocking I/O.

```
┌─────────────────────────────────────────────────────┐
│              Spring Boot Application                 │
│  ┌───────────────────────────────────────────────┐  │
│  │              JVM (GraalVM / OpenJDK)          │  │
│  │  ┌─────────────────────────────────────────┐ │  │
│  │  │     Netty Event Loop (Non-blocking)     │ │  │
│  │  └─────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────┐ │  │
│  │  │  Spring WebFlux / Project Reactor       │ │  │
│  │  │  (Reactive Streams)                     │ │  │
│  │  └─────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────┐ │  │
│  │  │  Thread Pool (ForkJoinPool for CPU)     │ │  │
│  │  └─────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Technology Stack:**

- Runtime: Java 21 LTS (or GraalVM for native image)
- Framework: Spring Boot 3.x with WebFlux
- AWS SDK: AWS SDK for Java v2 (async clients)
- Reactive: Project Reactor
- ZIP Handling: java.util.zip, Apache Commons Compress

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|High memory consumption|High|Medium|Tune JVM, use GraalVM native|
|Slow cold start|High|Medium|GraalVM native image, pre-warming|
|Reactive complexity|Medium|Medium|Training, proper patterns|
|Over-engineering|Medium|Low|Keep it simple, avoid enterprise patterns|
|Dependency bloat|Medium|Low|Careful dependency management|

#### Pros

- **Mature Ecosystem**: Battle-tested in enterprise environments
- **Spring Framework**: Comprehensive dependency injection, AOP, security
- **Reactive Support**: Project Reactor for non-blocking I/O
- **AWS SDK**: Excellent async AWS SDK v2
- **Threading Model**: Virtual Threads (Java 21) simplify concurrency
- **Tooling**: Excellent IDE support (IntelliJ IDEA)
- **Monitoring**: Micrometer, Spring Actuator for observability
- **Team Knowledge**: Secondary team skill set
- **Type Safety**: Strong static typing
- **GraalVM Option**: Native compilation for fast startup

#### Cons

- **Memory Footprint**: JVM requires significant baseline memory (512MB+)
- **Cold Start**: 5-15 seconds without GraalVM native image
- **Reactive Learning Curve**: WebFlux/Reactor patterns are complex
- **Verbose**: More boilerplate than TypeScript or Go
- **Container Size**: Larger Docker images (200MB+ vs 20MB for Go)
- **Over-engineering Risk**: Spring encourages complex abstractions
- **Cost**: Higher Fargate costs due to memory requirements
- **Development Speed**: Slower iteration than TypeScript

---

### Option 4: Python with asyncio and FastAPI

A Python-based solution using asyncio for concurrency and FastAPI for structure, with multiprocessing for CPU-bound tasks.

```
┌─────────────────────────────────────────────────────┐
│               Python Application                     │
│  ┌───────────────────────────────────────────────┐  │
│  │           asyncio Event Loop                  │  │
│  │  ┌─────────────────────────────────────────┐ │  │
│  │  │     FastAPI / Starlette (ASGI)          │ │  │
│  │  └─────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────┐ │  │
│  │  │   aiohttp / httpx (async HTTP)          │ │  │
│  │  └─────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  ProcessPoolExecutor (CPU-bound tasks)        │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Technology Stack:**

- Runtime: Python 3.11+
- Framework: FastAPI with asyncio
- AWS SDK: aioboto3 (async boto3 wrapper)
- HTTP Client: aiohttp or httpx
- ZIP Handling: zipfile with ProcessPoolExecutor

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|GIL limiting parallelism|High|High|multiprocessing, but adds complexity|
|Performance bottlenecks|Medium|High|Profile early, optimize hot paths|
|async/await complexity|Medium|Medium|Proper patterns, training|
|Dependency conflicts|Medium|Low|Poetry/pipenv, virtual envs|
|Type checking limitations|Medium|Low|mypy, pydantic|

#### Pros

- **Readability**: Clean, expressive syntax
- **Fast Development**: Rapid prototyping and iteration
- **FastAPI**: Modern framework with automatic OpenAPI docs
- **Data Processing**: Excellent libraries for data manipulation
- **AWS SDK**: Comprehensive boto3 support
- **Type Hints**: Modern Python supports type annotations
- **Community**: Large community and extensive documentation

#### Cons

- **GIL Limitation**: Global Interpreter Lock prevents true parallelism
- **Performance**: 10-100x slower than compiled languages for CPU tasks
- **Memory Usage**: Higher memory per concurrent connection than Node.js
- **Async Ecosystem**: Not all libraries support asyncio natively
- **Multiprocessing Overhead**: Process spawning has significant cost
- **Type System**: Optional typing, not enforced at runtime
- **Cold Start**: Slower than Go, comparable to Node.js
- **Production Maturity**: asyncio ecosystem less mature than Node.js

---

### Option 5: Rust with Tokio

A Rust-based solution using Tokio async runtime for high-performance, safe concurrent processing.

```
┌─────────────────────────────────────────────────────┐
│                Rust Application                      │
│  ┌───────────────────────────────────────────────┐  │
│  │           Tokio Async Runtime                 │  │
│  │  ┌─────────────────────────────────────────┐ │  │
│  │  │    Multi-threaded work-stealing         │ │  │
│  │  │    scheduler (M:N threading)            │ │  │
│  │  └─────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────┐ │  │
│  │  │  Tasks (lightweight, zero-cost async)   │ │  │
│  │  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐          │ │  │
│  │  │  │ T1 │ │ T2 │ │ T3 │ │ TN │          │ │  │
│  │  │  └────┘ └────┘ └────┘ └────┘          │ │  │
│  │  └─────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Technology Stack:**

- Language: Rust (stable)
- Async Runtime: Tokio
- AWS SDK: aws-sdk-rust (official)
- HTTP Client: reqwest or hyper
- ZIP Handling: zip crate

#### Risk and Impact

|Risk|Probability|Impact|Mitigation|
|---|---|---|---|
|Extreme learning curve|Very High|High|3-6 months ramp-up, training investment|
|Development velocity impact|Very High|High|Accept longer timeline|
|Hiring difficulty|High|High|Limited talent pool|
|Async complexity|High|Medium|Tokio patterns, proper error handling|
|Ecosystem maturity|Medium|Medium|aws-sdk-rust still evolving|

#### Pros

- **Performance**: Near-C performance with zero-cost abstractions
- **Memory Safety**: Compile-time guarantees prevent memory bugs
- **No GC Pauses**: Deterministic memory management
- **Concurrency Safety**: Ownership model prevents data races
- **Small Binary**: Tiny container images (~10-20MB)
- **Instant Cold Start**: Sub-100ms startup time
- **Resource Efficiency**: Minimal memory and CPU overhead
- **Tokio**: Battle-tested async runtime
- **Long-term Maintenance**: Compiler catches many bugs at compile time

#### Cons

- **Learning Curve**: 3-6 months to proficiency, steep initial curve
- **Development Speed**: Slower development, especially initially
- **Hiring**: Very limited Rust talent pool
- **Team Investment**: Requires significant training commitment
- **AWS SDK**: aws-sdk-rust is newer than other SDKs
- **Ecosystem Size**: Smaller than Node.js/Python/Java
- **Compile Times**: Long compilation affects iteration speed
- **Over-engineering Risk**: Can spend too much time fighting borrow checker

---

## Recommended Option

### Option 1: Node.js with TypeScript and NestJS

### Decision Rationale

The decision is based on weighted scoring aligned with project priorities:

|Factor|Weight|Node/TS|Go|Java|Python|Rust|
|---|---|---|---|---|---|---|
|Team expertise & velocity|25%|9|4|6|7|2|
|I/O-bound performance|20%|9|9|8|7|10|
|Time to production|15%|9|5|6|8|3|
|Maintainability|15%|8|8|7|6|9|
|AWS SDK maturity|10%|9|8|9|8|6|
|Operational efficiency|10%|7|9|5|6|10|
|Hiring & team growth|5%|9|6|8|8|3|
|**Weighted Score**|100%|**8.45**|**6.65**|**6.75**|**6.95**|**5.35**|

**Primary Decision Drivers:**

1. **Team Expertise (25%)**: The team's primary skill set is TypeScript/Node.js. Using familiar technology reduces risk and accelerates delivery. Context-switching to a new language during a critical project introduces unnecessary risk.
    
2. **I/O-Bound Workload Fit (20%)**: Node.js's event loop model is specifically designed for I/O-bound workloads, which represents 90% of this service's operations. The performance characteristics align perfectly with the use case.
    
3. **Time to Production (15%)**: With a 6-8 week target, team familiarity with Node.js/TypeScript enables faster delivery. Go or Rust would require 3-6 months of ramp-up before reaching equivalent velocity.
    
4. **NestJS Framework Benefits**: Provides structure, dependency injection, and patterns that enforce consistency across the codebase, improving maintainability for a service expected to run 3-5 years.
    
5. **AWS SDK Maturity**: The AWS SDK v3 for JavaScript is excellent, with modular imports, TypeScript definitions, and first-class async/await support.
    

**Why Not the Alternatives:**

- **Go**: Superior technical choice for this workload type, but team ramp-up time (3-4 months) conflicts with delivery timeline. Would be the recommendation if the team had Go experience.
    
- **Java/Spring**: Higher resource consumption (memory, cold start) increases Fargate costs without proportional benefits. Reactive programming in Spring WebFlux has a steep learning curve.
    
- **Python**: GIL limitations and lower performance make it suboptimal for high-concurrency workloads. Better suited for data processing and ML applications.
    
- **Rust**: Exceptional performance and safety, but extreme learning curve (6+ months) and limited hiring pool make it impractical for this timeline and team composition.
    

### Implications

#### MUST

1. **MUST** use Node.js 20 LTS as the runtime for long-term support and stability
    
2. **MUST** use TypeScript with strict mode enabled (`strict: true` in tsconfig.json)
    
3. **MUST** use NestJS 10.x as the application framework
    
4. **MUST** use AWS SDK v3 (@aws-sdk/client-*) with modular imports, NOT v2
    
5. **MUST** implement Worker Threads for CPU-intensive operations (ZIP extraction) to prevent event loop blocking
    
6. **MUST** use streaming APIs for file downloads and uploads to minimize memory pressure:
    
    - `stream.pipeline()` for composing streams
    - Avoid `Buffer.concat()` or loading full files into memory
7. **MUST** implement proper error handling with typed exceptions and NestJS exception filters
    
8. **MUST** configure ESLint with TypeScript rules and Prettier for code consistency
    
9. **MUST** use `undici` or native `fetch` (Node 18+) for HTTP requests instead of axios for better performance
    
10. **MUST** implement structured logging with correlation IDs using a library like `pino` or `winston`
    

#### SHOULD

1. **SHOULD** use connection pooling for HTTP clients:
    
    ```
    - undici Pool for Export API connections
    - AWS SDK built-in connection management for AWS services
    ```
    
2. **SHOULD** implement graceful shutdown handling:
    
    - Listen for SIGTERM/SIGINT
    - Stop accepting new work
    - Complete in-flight operations with timeout
    - Clean up resources
3. **SHOULD** use `pnpm` as the package manager for faster installs and disk efficiency
    
4. **SHOULD** implement health check endpoints following NestJS Terminus patterns
    
5. **SHOULD** configure TypeScript path aliases for cleaner imports
    
6. **SHOULD** use Zod or class-validator for runtime validation of external inputs (SQS messages, API responses)
    
7. **SHOULD** implement circuit breaker pattern using `opossum` or similar library for Export API calls
    
8. **SHOULD** use `tsconfig-paths` for module resolution in production builds
    
9. **SHOULD** implement unit tests with Jest and e2e tests with NestJS testing utilities
    
10. **SHOULD** use Docker multi-stage builds to minimize production image size
    

#### MAY

1. **MAY** evaluate Fastify adapter for NestJS if benchmarking reveals HTTP performance bottlenecks (Fastify is ~2x faster than Express for HTTP handling)
    
2. **MAY** implement distributed tracing using AWS X-Ray SDK for Node.js
    
3. **MAY** use `esbuild` or `swc` for faster TypeScript compilation during development
    
4. **MAY** implement custom NestJS decorators for common patterns (e.g., SQS message validation, timing metrics)
    
5. **MAY** use `bullmq` with Redis for internal job queuing if complex retry patterns are needed beyond SQS capabilities
    
6. **MAY** consider `tsx` for development to enable direct TypeScript execution without compilation step
    
7. **MAY** implement OpenTelemetry for vendor-agnostic observability if multi-cloud becomes a consideration
    
8. **MAY** evaluate Bun as an alternative runtime in the future if it reaches production maturity and offers significant performance benefits
    
9. **MAY** use `clinic.js` for performance profiling and identifying bottlenecks
    
10. **MAY** implement memory leak detection using `--inspect` flag and Chrome DevTools during development
    

---

## Appendix: Performance Characteristics Comparison

### Theoretical Throughput for I/O-Bound Workload

```
Scenario: 1000 concurrent HTTP requests, 100ms average response time

Node.js (Event Loop):
├── Single thread handles all I/O
├── Memory: ~200MB for 1000 connections
├── Throughput: ~10,000 req/sec
└── Latency: p99 ~120ms

Go (Goroutines):
├── One goroutine per request
├── Memory: ~2MB for 1000 goroutines
├── Throughput: ~15,000 req/sec
└── Latency: p99 ~105ms

Java (Virtual Threads - Java 21):
├── One virtual thread per request
├── Memory: ~500MB baseline + ~50MB for 1000 threads
├── Throughput: ~12,000 req/sec
└── Latency: p99 ~110ms

Python (asyncio):
├── Single thread event loop
├── Memory: ~300MB for 1000 connections
├── Throughput: ~5,000 req/sec
└── Latency: p99 ~150ms

Rust (Tokio):
├── Work-stealing scheduler
├── Memory: ~50MB for 1000 tasks
├── Throughput: ~20,000 req/sec
└── Latency: p99 ~100ms
```

### Memory Footprint Comparison (Container at Rest)

```
┌─────────────────────────────────────────────────────┐
│              Container Memory Usage                  │
│                                                      │
│  Rust      [██░░░░░░░░░░░░░░░░░░]  20MB            │
│  Go        [███░░░░░░░░░░░░░░░░░]  30MB            │
│  Node.js   [████████░░░░░░░░░░░░]  80MB            │
│  Python    [█████████░░░░░░░░░░░]  100MB           │
│  Java      [████████████████████]  512MB+          │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Cold Start Time Comparison (Fargate)

```
┌─────────────────────────────────────────────────────┐
│              Container Cold Start                    │
│                                                      │
│  Rust        [█░░░░░░░░░░░░░░░░░░]  ~100ms         │
│  Go          [██░░░░░░░░░░░░░░░░░]  ~200ms         │
│  Node.js     [█████░░░░░░░░░░░░░░]  ~800ms         │
│  Python      [██████░░░░░░░░░░░░░]  ~1s            │
│  Java        [████████████████░░░]  ~5-15s         │
│  Java Native [███░░░░░░░░░░░░░░░░]  ~300ms         │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

**Decision Date**: [Current Date] **Decision Makers**: [Team/Architect Names] **Status**: Proposed **Supersedes**: N/A **Related ADRs**: ADR-001 (Service Architecture Selection)