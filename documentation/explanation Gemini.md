Basado en la redacción técnica que hemos trabajado, a continuación presento la **documentación consolidada y detallada** de las Etapas 1 y 2 del proceso de ingestión.

Esta versión unifica los conceptos en un solo documento técnico coherente, ideal para presentar a equipos de arquitectura, desarrollo o auditoría.

---

# Documentación Técnica: Flujo de Ingestión de Archivos de Audio (OCP)

## Visión General

El sistema de ingestión está diseñado para capturar, procesar y almacenar las grabaciones de llamadas provenientes de la plataforma externa **OCP**. El proceso se divide en dos flujos complementarios para garantizar la integridad del 100% de los datos:

1. **Etapa 1 (Flujo en Tiempo Real):** Procesa el 90% de las llamadas mediante eventos y streaming.
    
2. **Etapa 2 (Flujo de Reconciliación):** Recupera el 10% restante mediante procesos asíncronos y trabajos de exportación (Batch/Job).
    

---

## **Etapa 1: Ingestión en Tiempo Real (Ciclo de Vida Estándar)**

_Cobertura aproximada: 90% del volumen total._

Esta etapa se basa en una arquitectura orientada a eventos (**Event-Driven**) y transferencia por **Streaming**. El objetivo es registrar el ciclo de vida de la llamada y capturar el audio inmediatamente después de su finalización.

### **1. Registro del Ciclo de Vida (Trazabilidad)**

El sistema utiliza **Amazon DynamoDB** como fuente de la verdad para el estado de cada llamada.

- **Inicio (CDR Start):** Al iniciar una llamada, OCP emite un evento `CDR Start`. Se crea un registro en DynamoDB con el `Call ID`, timestamp de inicio y metadatos técnicos. Esto "abre" la transacción lógica.
    
- **Actualización (IVR End):** Si la llamada termina en el IVR, se actualiza el registro con la duración y el motivo de cierre.
    
- **Cierre (CDR End):** Al finalizar la llamada, el evento `CDR End` marca el cierre definitivo en la base de datos y actúa como disparador para que OCP genere el archivo de audio.
    

### **2. Transmisión y Procesamiento del Archivo**

Una vez que OCP genera el audio (normalización, conversión a WAV/MP3), inicia la transmisión:

- **Streaming (Push):** OCP envía el archivo hacia nuestra plataforma mediante una suscripción de streaming.
    
- **Recepción y Flagging:** La API de ingestión recibe el binario. Inmediatamente, actualiza el registro en DynamoDB activando el flag `ARCHIVO_RECIBIDO`.
    
- **Post-processing:** Se analiza el archivo para validar su integridad, duración y formato. Al finalizar con éxito, se activa el flag `POST_PROC_OK`.
    

### **3. Almacenamiento Final**

- El archivo validado se copia a un bucket de **Amazon S3**, segmentado por línea de negocio (OB).
    
- Se activa el flag final `ALMACENADO_S3` en DynamoDB.
    

> **Resultado de la Etapa 1:** El ciclo se cierra en segundos/minutos tras la llamada. El registro en DynamoDB refleja un estado "COMPLETED".

---

## **Etapa 2: Proceso de Reconciliación (Recuperación de Fallos)**

_Cobertura aproximada: 10% del volumen total (Casos Excepcionales)._

Esta etapa maneja los casos donde el archivo no llegó por streaming (fallos de red, timeouts, errores en OCP). Es un proceso **Asíncrono (Pull)** basado en el patrón _Saga_ orquestado por **AWS Step Functions**.

### **1. Detección Proactiva (Polling)**

Un proceso programado (Cron) ejecuta una Lambda que escanea **DynamoDB** en busca de "Zombies":

- Registros donde la llamada finalizó (`CDR End` presente) pero el flag `ALMACENADO_S3` no existe o está en falso después de un tiempo prudencial.
    
- Estas llamadas se envían al flujo de reconciliación.
    

### **2. Orquestación de la Recuperación**

Se inicia una **Step Function** para cada llamada pendiente:

1. **Solicitud de Exportación:** Se invoca la API de OCP (`Export API`) para crear un **Export Job**. OCP devuelve un `Job ID`.
    
2. **Espera Inteligente (Wait Loop):**
    
    - En lugar de bloquear una Lambda esperando, la Step Function programa un evento en **EventBridge** para verificar el estado en el futuro (ej. en 5 minutos).
        
    - Una **Lambda Puller** verifica el estado del Job en OCP.
        
    - Si está `IN_PROGRESS`, se reprograma otra verificación.
        
    - Si está `COMPLETED`, se notifica a la Step Function para avanzar.
        

### **3. Descarga y Cierre**

Una vez que el Job está listo:

- **Ejecución Paralela:**
    
    - Se descargan los metadatos técnicos.
        
    - Se utiliza **Amazon Fargate** (debido a que la descarga puede ser pesada) para traer el archivo de audio desde OCP.
        
- **Actualización de Estado:** Fargate actualiza los flags en DynamoDB (`ARCHIVO_RECIBIDO`, `ALMACENADO_S3`), cerrando el ciclo que quedó abierto en la Etapa 1.
    

---

## **Resumen Comparativo**

| **Característica**         | **Etapa 1 (Tiempo Real)**             | **Etapa 2 (Reconciliación)**                         |
| -------------------------- | ------------------------------------- | ---------------------------------------------------- |
| **Modelo de Comunicación** | **Push** (OCP nos envía el dato).     | **Pull** (Nosotros pedimos el dato a OCP).           |
| **Disparador**             | Evento de fin de llamada (`CDR End`). | Escaneo periódico de inconsistencias en DB.          |
| **Tecnología Principal**   | API Gateway + Lambda (Streaming).     | Step Functions + Fargate (Batch).                    |
| **Latencia**               | Baja (Inmediato tras la llamada).     | Alta (Depende de la ventana de batch).               |
| **Objetivo**               | Velocidad y procesamiento masivo.     | Garantía de integridad y recuperación (Resiliencia). |

---

Esta estructura explica claramente **qué** sucede, **cómo** sucede y **por qué** se diseñó así (velocidad vs. seguridad), proporcionando una documentación robusta del sistema.


Aquí tienes el paquete completo de documentación técnica consolidada. He estructurado la respuesta en los cuatro bloques que solicitaste, listos para copiar y pegar en tu Wiki, Confluence o documento de arquitectura.

---

## 📂 Documentación Técnica: Ingestión y Reconciliación OCP

## 1. 📋 Tabla de Flags y Estados (Ciclo de Vida del Dato)

Esta tabla define el modelo de datos en **DynamoDB**. Cada flag representa un hito crítico en el proceso de ingestión. El objetivo de auditoría es que todos los registros terminen con todos los flags en `TRUE` o `COMPLETED`.

|**Campo / Flag**|**Tipo de Dato**|**Origen**|**Descripción Funcional**|
|---|---|---|---|
|**`CALL_ID`**|String (PK)|OCP|Identificador único e inmutable de la llamada.|
|**`CALL_START_TS`**|Timestamp|Etapa 1|Marca de tiempo del inicio de la llamada (Evento `CDR Start`).|
|**`CALL_STATUS`**|Enum|Etapa 1|Estado de la llamada (`ACTIVE`, `FINISHED_IVR`, `FINISHED_AGENT`, `COMPLETED`).|
|**`HAS_CDR_END`**|Boolean|Etapa 1|Indica si se recibió el evento de finalización formal de la llamada.|
|**`FILE_RECEIVED`**|Boolean|Etapa 1 / 2|**True** si el binario de audio llegó a la plataforma (ya sea por stream o descarga).|
|**`POST_PROCESS_OK`**|Boolean|Etapa 1 / 2|**True** tras validar formato, duración y metadatos del audio.|
|**`S3_STORED`**|Boolean|Etapa 1 / 2|**True** cuando el archivo se ha persistido exitosamente en el Bucket S3 final.|
|**`INGESTION_SOURCE`**|Enum|Sistema|Indica la vía de obtención: `REALTIME` (Etapa 1) o `RECONCILIATION` (Etapa 2).|
|**`RETRY_COUNT`**|Integer|Etapa 2|Contador de intentos de recuperación en el flujo de reconciliación.|

---

## 2. 🧩 Mapa de Funcionalidades vs. Componentes

Matriz de responsabilidad que detalla qué servicio de AWS ejecuta cada función lógica del sistema.

|**Componente AWS**|**Rol en la Arquitectura**|**Funcionalidad Específica**|
|---|---|---|
|**Amazon DynamoDB**|**State Store**|Fuente de la verdad del estado de la llamada. Almacena metadatos y flags de control.|
|**API Gateway**|**Ingress**|Punto de entrada seguro para los webhooks de OCP (Eventos CDR) y streaming de audio.|
|**AWS Lambda**|**Compute (Ligero)**|- Procesamiento de eventos `Start`/`End`.<br><br>  <br><br>- Recepción de streaming (Etapa 1).<br><br>  <br><br>- Polling de estado de Jobs (Etapa 2).|
|**AWS Step Functions**|**Orquestador**|Manejo del flujo de larga duración en la Etapa 2 (Reconciliación). Gestiona esperas y reintentos.|
|**Amazon EventBridge**|**Scheduler**|- Trigger del Cron para detectar llamadas pendientes.<br><br>  <br><br>- Manejo de eventos diferidos (wait loops).|
|**AWS Fargate (ECS)**|**Compute (Pesado)**|Descarga y procesamiento de archivos en la Etapa 2 (evita límites de tiempo/memoria de Lambda).|
|**Amazon S3**|**Storage**|Almacenamiento persistente, encriptado y segregado por línea de negocio.|

---

## 3. 📊 Diagrama End-to-End (Etapa 1 + Etapa 2)

Este diagrama muestra cómo el flujo "Happy Path" (Tiempo Real) convive con el flujo de recuperación, asegurando que nada se pierda.

Code snippet

```
flowchart TD
    subgraph OCP_Platform [Plataforma OCP Externa]
        StartCall([Inicio Llamada])
        EndCall([Fin Llamada])
        StreamAudio[Stream Audio]
        ExportAPI[Export API]
    end

    subgraph AWS_Ingestion [Plataforma de Ingestión AWS]
        DDB[(Amazon DynamoDB)]
        
        %% ETAPA 1
        subgraph Stage_1 [Etapa 1: Tiempo Real]
            EventLambda[Lambda: Event Processor]
            StreamLambda[Lambda: Ingestion API]
            S3_Final[(S3 Bucket)]
        end

        %% ETAPA 2
        subgraph Stage_2 [Etapa 2: Reconciliación]
            Cron[EventBridge Cron]
            Scanner[Lambda: Scanner]
            SFN{{Step Functions}}
            Poller[Lambda: Job Poller]
            Fargate[ECS Fargate: Downloader]
        end
    end

    %% Flujo Etapa 1
    StartCall -->|CDR Start| EventLambda
    EndCall -->|CDR End| EventLambda
    EventLambda -->|Upsert Reg| DDB
    
    EndCall -.-> StreamAudio
    StreamAudio -->|Push Audio| StreamLambda
    StreamLambda -->|Validar & Copiar| S3_Final
    StreamLambda -->|Update: FILE_RECEIVED| DDB

    %% Transición a Etapa 2
    Cron -->|Trigger c/30min| Scanner
    Scanner -->|Query: Missing Files| DDB
    Scanner -->|Start Exec| SFN

    %% Flujo Etapa 2
    SFN -->|1. Create Job| ExportAPI
    SFN -->|2. Wait Loop| Poller
    Poller <-->|Check Status| ExportAPI
    Poller -->|Status OK?| SFN
    
    SFN -->|3. Download| Fargate
    Fargate <-->|Pull Audio| ExportAPI
    Fargate -->|Copy File| S3_Final
    Fargate -->|Update: RECONCILED| DDB
    
    classDef realTime fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef recovery fill:#fff3e0,stroke:#e65100,stroke-width:2px;
    classDef storage fill:#f3e5f5,stroke:#4a148c,stroke-width:2px;

    class Stage_1 realTime;
    class Stage_2 recovery;
    class DDB,S3_Final storage;
```

---

## 4. 🧾 Resumen Ejecutivo para Auditoría

Este texto está diseñado para ser entregado a equipos de **Compliance, Auditoría Interna o Gestión de Riesgos**.

### **Informe de Integridad y Control de Datos: Ingestión de Voz**

Objetivo del Sistema:

Garantizar la captura, custodia y almacenamiento del 100% de las grabaciones generadas en la plataforma OCP, cumpliendo con los estándares de trazabilidad y seguridad de la organización.

**Mecanismos de Control:**

1. Principio de Captura Dual:
    
    El sistema no depende de un único mecanismo de ingestión.
    
    - **Mecanismo Primario (Tiempo Real):** Procesa el 90% del volumen de manera inmediata.
        
    - **Mecanismo de Seguridad (Reconciliación):** Actúa como red de seguridad para capturar cualquier registro que falle en la primera instancia debido a latencia o interrupciones de red.
        
2. Trazabilidad Inmutable (Audit Trail):
    
    Cada llamada genera un "expediente digital" único en nuestra base de datos de control (DynamoDB). Este registro audita cronológicamente:
    
    - Cuándo inició y terminó la llamada.
        
    - En qué momento exacto se recibió el archivo.
        
    - La ubicación final encriptada del archivo.
        
    - Si el archivo requirió recuperación manual o automática.
        
3. **Segregación y Seguridad:**
    
    - Los archivos se almacenan en repositorios (Buckets S3) segregados lógicamente por unidad de negocio.
        
    - El acceso es estrictamente programático y basado en roles (RBAC).
        
    - Se valida la integridad técnica de cada archivo (duración y formato) antes de su almacenamiento final.
        

Conclusión:

La arquitectura implementada asegura la resiliencia operativa. Ante una caída total del servicio de streaming en tiempo real, el sistema de reconciliación (Etapa 2) tiene la capacidad autónoma de recuperar la totalidad de los datos pendientes sin intervención humana, garantizando la completitud de la información para fines regulatorios y de calidad.


----

Based on the technical drafting we have worked on, below is the **consolidated and detailed documentation** of the Ingestion Process Stages 1 and 2.

This version unifies the concepts into a single coherent technical document, ideal for presentation to architecture, development, or audit teams.

---

# Technical Documentation: Audio File Ingestion Flow (OCP)

## Overview

The ingestion system is designed to capture, process, and store call recordings from the external **OCP** platform. The process is divided into two complementary flows to guarantee 100% data integrity:

1. **Stage 1 (Real-Time Flow):** Processes 90% of calls via events and streaming.
    
2. **Stage 2 (Reconciliation Flow):** Recovers the remaining 10% via asynchronous processes and export jobs (Batch/Job).
    

---

## **Stage 1: Real-Time Ingestion (Standard Lifecycle)**

_Approximate Coverage: 90% of total volume._

This stage relies on an **Event-Driven** architecture and **Streaming** transfer. The objective is to register the call lifecycle and capture the audio immediately upon completion.

### **1. Lifecycle Registration (Traceability)**

The system uses **Amazon DynamoDB** as the source of truth for the status of each call.

- **Start (CDR Start):** When a call begins, OCP emits a `CDR Start` event. A record is created in DynamoDB with the `Call ID`, start timestamp, and technical metadata. This "opens" the logical transaction.
    
- **Update (IVR End):** If the call ends within the IVR, the record is updated with the duration and closure reason.
    
- **Close (CDR End):** Upon call completion, the `CDR End` event marks the definitive closure in the database and acts as the trigger for OCP to generate the audio file.
    

### **2. File Transmission and Processing**

Once OCP generates the audio (normalization, conversion to WAV/MP3), transmission begins:

- **Streaming (Push):** OCP sends the file to our platform via a streaming subscription.
    
- **Reception and Flagging:** The Ingestion API receives the binary. It immediately updates the record in DynamoDB by activating the `FILE_RECEIVED` flag.
    
- **Post-processing:** The file is analyzed to validate its integrity, duration, and format. Upon successful completion, the `POST_PROC_OK` flag is activated.
    

### **3. Final Storage**

- The validated file is copied to an **Amazon S3** bucket, segmented by Line of Business (OB).
    
- The final flag `S3_STORED` is activated in DynamoDB.
    

> **Stage 1 Result:** The cycle closes within seconds/minutes after the call. The DynamoDB record reflects a "COMPLETED" state.

---

## **Stage 2: Reconciliation Process (Failure Recovery)**

_Approximate Coverage: 10% of total volume (Exceptional Cases)._

This stage handles cases where the file was not received via streaming (network failures, timeouts, OCP errors). It is an **Asynchronous (Pull)** process based on the _Saga_ pattern orchestrated by **AWS Step Functions**.

### **1. Proactive Detection (Polling)**

A scheduled process (Cron) executes a Lambda that scans **DynamoDB** for "Zombies":

- Records where the call finished (`CDR End` is present) but the `S3_STORED` flag does not exist or is false after a reasonable buffer time.
    
- These calls are sent to the reconciliation flow.
    

### **2. Recovery Orchestration**

A **Step Function** is initiated for each pending call:

1. **Export Request:** The OCP API (`Export API`) is invoked to create an **Export Job**. OCP returns a `Job ID`.
    
2. **Smart Wait (Wait Loop):**
    
    - Instead of blocking a Lambda while waiting, the Step Function schedules an **EventBridge** event to check the status in the future (e.g., in 5 minutes).
        
    - A **Lambda Puller** checks the Job status in OCP.
        
    - If `IN_PROGRESS`, another check is rescheduled.
        
    - If `COMPLETED`, the Step Function is notified to proceed.
        

### **3. Download and Close**

Once the Job is ready:

- **Parallel Execution:**
    
    - Technical metadata is downloaded.
        
    - **Amazon Fargate** is used (since the download may be heavy) to pull the audio file from OCP.
        
- **State Update:** Fargate updates the flags in DynamoDB (`FILE_RECEIVED`, `S3_STORED`), closing the cycle that remained open in Stage 1.
    

---



---

## **Stage 2: Audio File Reconciliation Process (≈10% of cases)**

Occasionally, there may be calls for which the audio file is not received within the main flow described in Stage 1.

This can occur for multiple reasons, such as temporary failures, delays in file generation, or communication issues with OCP.

To handle these cases, the system implements a **reconciliation process** aimed at identifying, recovering, and completing the processing of pending calls.

---

### **1. Detection of Pending Calls**

The reconciliation system executes periodically, with a configurable frequency (e.g., every 30 minutes, every 1 hour, or every _N_ minutes).

In each execution:

- A scheduled event is triggered.
    
- This event invokes a **polling Lambda**.
    
- The Lambda queries **DynamoDB** to identify calls that:
    
    - Have not completed all status flags defined in Stage 1.
        
    - Are considered pending receipt or processing of the audio file.
        

If incomplete calls are detected:

- These calls are selected and queued for reprocessing.
    
- The **reconciliation process** is initiated via **AWS Step Functions**.
    

---

### **2. Initiation of the Reconciliation Process with Step Functions**

The polling process generates an event that:

- Triggers the execution of a **Step Functions State Machine**.
    
- Step Functions creates:
    
    - A **Task ID**.
        
    - A **Task Token**, which will be used for asynchronous callbacks.
        
- The reconciliation flow formally begins.
    

---

### **3. Creation of the Export Job in OCP**

The first step of the State Machine consists of:

- Invoking the **Omilia / OCP Export APIs**.
    
- Creating an **Export Job** for the pending call.
    
- Obtaining an **Export Job ID** as a response.
    

This Export Job is responsible for preparing the audio files associated with the call.

---

### **4. Scheduling the Export Job Polling**

Once the Export Job is created:

- The flow advances to a step that **does not immediately check the status**.
    
- Instead, a **scheduled event is created in Amazon EventBridge** for a configurable future time (e.g., 1, 2, 5, or 6 minutes).
    

This future event:

- Triggers a **Puller Lambda**, responsible for checking the status of the Export Job.
    

---

### **5. Checking Export Job Status (Controlled Loop)**

The Puller Lambda receives the following minimum information:

- Export Job ID
    
- Task Token
    
- Dialog Group ID
    

With this data:

- It executes the **OCP Export API** endpoint to check the status of the Export Job.
    

#### **Behavior based on status:**

- **If the status is NOT `COMPLETED`** (e.g., `IN_PROGRESS` or temporary error):
    
    - The Lambda creates a **new event in EventBridge** to check the status again in the future.
        
    - The polling process repeats in a controlled loop.
        
    - The number of iterations and the maximum wait time must be configured and limited.
        
- **If the status is `COMPLETED`**:
    
    - The Puller Lambda sends a **callback to Step Functions** using the **Task Token**.
        
    - The corresponding status is updated in **DynamoDB**.
        
    - The State Machine is notified that it can proceed to the next step.
        

---

### **6. Parallel Execution Upon Export Job Completion**

Once confirmed that the Export Job is complete, the Step Function proceeds to a **parallel execution step**, which includes:

#### **6.1 Metadata Retrieval**

- A Lambda queries the **OCP Export API** again.
    
- It retrieves the **Export Job metadata**.
    
- This information is stored and associated with the corresponding call.
    

#### **6.2 File Download (Fargate)**

- In parallel, another step is initiated that:
    
    - Generates a wait event.
        
    - Is consumed by a **service on Amazon Fargate**.
        
- The Fargate service:
    
    - Downloads the audio files using the **OCP Export API**.
        
    - Executes necessary post-processing (validations, organization, etc.).
        

Once the download and processing are complete:

- The Fargate service sends a **callback to Step Functions** using the **Task Token**.
    
- It indicates that the **Download File** step has finished successfully.
    

---

### **7. Completion of the Reconciliation Process**

Upon receipt of the final callback:

- The **Step Function** execution completes.
    
- Final flags are updated in **DynamoDB**.
    
- The call remains fully reconciled and processed.
    
- The ingestion cycle for that exceptional case is closed.
    

---

### **8. Benefits of the Reconciliation Approach**

This model allows for:

- Recovering calls where no file was received in the main flow.
    
- Avoiding unnecessary reprocessing.
    
- Maintaining complete traceability via persisted states.
    
- Controlling timings, retries, and iterations.
    
- Clearly separating the **happy path (90%)** from the **exceptional cases (10%)**.
    

---

If you like, the ideal next step would be:

- 📊 A complete **sequence diagram** (happy path + reconciliation).
    
- 📋 A **table of states, flags, and transitions**.
    
- ⚠️ Defining **timeouts, polling limits, and error policies**.
    
- 🧾 Converting this into an **architecture document** (HLD / LLD).
    

Let me know what you need, and we will put it together.
---

## **Comparative Summary**

|**Feature**|**Stage 1 (Real-Time)**|**Stage 2 (Reconciliation)**|
|---|---|---|
|**Communication Model**|**Push** (OCP sends data to us).|**Pull** (We request data from OCP).|
|**Trigger**|Call end event (`CDR End`).|Periodic scan for DB inconsistencies.|
|**Core Technology**|API Gateway + Lambda (Streaming).|Step Functions + Fargate (Batch).|
|**Latency**|Low (Immediate after call).|High (Depends on batch window).|
|**Objective**|Speed and mass processing.|Integrity guarantee and recovery (Resilience).|

---

## 📂 Technical Documentation Package: Ingestion & Reconciliation

## 1. 📋 Flags and Status Table (Data Lifecycle)

This table defines the data model in **DynamoDB**. Each flag represents a critical milestone in the ingestion process. The audit goal is for all records to end with all flags set to `TRUE` or `COMPLETED`.

|**Field / Flag**|**Data Type**|**Origin**|**Functional Description**|
|---|---|---|---|
|**`CALL_ID`**|String (PK)|OCP|Unique and immutable call identifier.|
|**`CALL_START_TS`**|Timestamp|Stage 1|Timestamp of call start (`CDR Start` event).|
|**`CALL_STATUS`**|Enum|Stage 1|Call status (`ACTIVE`, `FINISHED_IVR`, `FINISHED_AGENT`, `COMPLETED`).|
|**`HAS_CDR_END`**|Boolean|Stage 1|Indicates if the formal call completion event was received.|
|**`FILE_RECEIVED`**|Boolean|Stage 1 / 2|**True** if the audio binary reached the platform (via stream or download).|
|**`POST_PROCESS_OK`**|Boolean|Stage 1 / 2|**True** after validating audio format, duration, and metadata.|
|**`S3_STORED`**|Boolean|Stage 1 / 2|**True** when the file has been successfully persisted in the final S3 Bucket.|
|**`INGESTION_SOURCE`**|Enum|System|Indicates acquisition path: `REALTIME` (Stage 1) or `RECONCILIATION` (Stage 2).|
|**`RETRY_COUNT`**|Integer|Stage 2|Counter for recovery attempts in the reconciliation flow.|

---

## 2. 🧩 Feature vs. Component Map

Responsibility matrix detailing which AWS service executes each logical system function.

|**AWS Component**|**Role in Architecture**|**Specific Functionality**|
|---|---|---|
|**Amazon DynamoDB**|**State Store**|Source of truth for call state. Stores metadata and control flags.|
|**API Gateway**|**Ingress**|Secure entry point for OCP webhooks (CDR Events) and audio streaming.|
|**AWS Lambda**|**Compute (Light)**|- Processing `Start`/`End` events.<br><br>  <br><br>- Receiving streaming (Stage 1).<br><br>  <br><br>- Polling Job status (Stage 2).|
|**AWS Step Functions**|**Orchestrator**|Handling long-running flow in Stage 2 (Reconciliation). Manages waits and retries.|
|**Amazon EventBridge**|**Scheduler**|- Triggering Cron to detect pending calls.<br><br>  <br><br>- Handling delayed events (wait loops).|
|**AWS Fargate (ECS)**|**Compute (Heavy)**|Downloading and processing files in Stage 2 (avoids Lambda time/memory limits).|
|**Amazon S3**|**Storage**|Persistent, encrypted storage, segregated by line of business.|

---

## 3. 📊 End-to-End Diagram (Stage 1 + Stage 2)

This diagram shows how the "Happy Path" (Real-Time) coexists with the recovery flow, ensuring nothing is lost.

Code snippet

```
flowchart TD
    subgraph OCP_Platform [External OCP Platform]
        StartCall([Call Start])
        EndCall([Call End])
        StreamAudio[Stream Audio]
        ExportAPI[Export API]
    end

    subgraph AWS_Ingestion [AWS Ingestion Platform]
        DDB[(Amazon DynamoDB)]
        
        %% STAGE 1
        subgraph Stage_1 [Stage 1: Real-Time]
            EventLambda[Lambda: Event Processor]
            StreamLambda[Lambda: Ingestion API]
            S3_Final[(S3 Bucket)]
        end

        %% STAGE 2
        subgraph Stage_2 [Stage 2: Reconciliation]
            Cron[EventBridge Cron]
            Scanner[Lambda: Scanner]
            SFN{{Step Functions}}
            Poller[Lambda: Job Poller]
            Fargate[ECS Fargate: Downloader]
        end
    end

    %% Stage 1 Flow
    StartCall -->|CDR Start| EventLambda
    EndCall -->|CDR End| EventLambda
    EventLambda -->|Upsert Reg| DDB
    
    EndCall -.-> StreamAudio
    StreamAudio -->|Push Audio| StreamLambda
    StreamLambda -->|Validate & Copy| S3_Final
    StreamLambda -->|Update: FILE_RECEIVED| DDB

    %% Transition to Stage 2
    Cron -->|Trigger every 30min| Scanner
    Scanner -->|Query: Missing Files| DDB
    Scanner -->|Start Exec| SFN

    %% Stage 2 Flow
    SFN -->|1. Create Job| ExportAPI
    SFN -->|2. Wait Loop| Poller
    Poller <-->|Check Status| ExportAPI
    Poller -->|Status OK?| SFN
    
    SFN -->|3. Download| Fargate
    Fargate <-->|Pull Audio| ExportAPI
    Fargate -->|Copy File| S3_Final
    Fargate -->|Update: RECONCILED| DDB
    
    classDef realTime fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef recovery fill:#fff3e0,stroke:#e65100,stroke-width:2px;
    classDef storage fill:#f3e5f5,stroke:#4a148c,stroke-width:2px;

    class Stage_1 realTime;
    class Stage_2 recovery;
    class DDB,S3_Final storage;
```

---

## 4. 🧾 Executive Summary for Audit

This text is designed to be delivered to **Compliance, Internal Audit, or Risk Management** teams.

### **Data Integrity and Control Report: Voice Ingestion**

System Objective:

To guarantee the capture, custody, and storage of 100% of recordings generated on the OCP platform, complying with the organization's traceability and security standards.

**Control Mechanisms:**

1. Dual Capture Principle:
    
    The system does not rely on a single ingestion mechanism.
    
    - **Primary Mechanism (Real-Time):** Processes 90% of volume immediately.
        
    - **Safety Mechanism (Reconciliation):** Acts as a safety net to capture any record that fails in the first instance due to latency or network interruptions.
        
2. Immutable Traceability (Audit Trail):
    
    Each call generates a unique "digital file" in our control database (DynamoDB). This record chronologically audits:
    
    - When the call started and ended.
        
    - The exact moment the file was received.
        
    - The final encrypted location of the file.
        
    - Whether the file required manual or automatic recovery.
        
3. **Segregation and Security:**
    
    - Files are stored in repositories (S3 Buckets) logically segregated by business unit.
        
    - Access is strictly programmatic and Role-Based (RBAC).
        
    - Technical integrity of each file (duration and format) is validated before final storage.
        

Conclusion:

The implemented architecture ensures operational resilience. Even in the event of a total failure of the real-time streaming service, the reconciliation system (Stage 2) has the autonomous capability to recover all pending data without human intervention, guaranteeing information completeness for regulatory and quality purposes.