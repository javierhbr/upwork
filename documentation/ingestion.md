
Perfecto. A continuación te dejo una **redacción clara, técnica y lista para documentación** de la **Etapa 1 del proceso de ingestión**, usando un tono neutral (tipo arquitectura / diseño técnico). Si luego quieres, puedo ayudarte a convertirlo en **diagrama**, **ADR**, o **documentación para auditores**.

---

## **Proceso de Ingestión de Archivos desde OCP**

  

### **Etapa 1: Registro y procesamiento inicial de llamadas (≈90% de los archivos)**

  

La ingestión de archivos provenientes de la plataforma externa **OCP** se realiza en dos etapas.

Esta sección describe la **primera etapa**, la cual cubre aproximadamente el **90% de los archivos procesados** y está orientada al **registro del ciclo de vida de las llamadas**.

  

### **1. Inicio de llamada – Evento** 

### **CDR Start**

  

Cada vez que un cliente inicia una llamada, la plataforma OCP genera un evento **CDR Start**.

Este evento indica formalmente que una llamada ha comenzado y marca el punto inicial del flujo de ingestión.

  

Cuando se recibe el evento **CDR Start**:

- Se inserta un nuevo registro en **Amazon DynamoDB**.
    
- Este registro representa el inicio de la llamada.
    
- Se almacena información relevante asociada a la llamada, por ejemplo:
    
    - Identificador único de la llamada (Call ID)
        
    - Timestamp de inicio
        
    - Identificador del cliente
        
    - Canal o IVR de entrada
        
    - Metadatos técnicos necesarios para correlación posterior
        
    

  

El objetivo de este registro es **persistir el estado inicial de la llamada** y permitir el seguimiento completo de su ciclo de vida.

  

### **2. Finalización de llamada en IVR – Actualización del registro**

  

Cuando la llamada finaliza dentro del IVR, OCP emite un nuevo evento indicando el cierre de la interacción.

  

Al recibir este evento:

- Se actualiza el registro previamente creado en DynamoDB.
    
- Se marca la llamada como **finalizada en IVR**.
    
- Se agregan o actualizan datos adicionales, tales como:
    
    - Timestamp de finalización
        
    - Duración total de la llamada
        
    - Estado de salida (por ejemplo: completada, abandonada, transferida)
        
    - Códigos o resultados generados por el IVR
        
    

  

Esta actualización permite consolidar la información completa de la llamada en un único registro lógico, facilitando el procesamiento posterior y la generación de archivos asociados.

  

### **3. Resultado de la Etapa 1**

  

Al finalizar esta etapa:

- La mayoría de las llamadas (≈90%) quedan correctamente registradas y cerradas.
    
- DynamoDB contiene el estado completo del ciclo de vida de cada llamada.
    
- Los registros quedan listos para:
    
    - Procesamiento posterior
        
    - Generación o correlación de archivos
        
    - Validaciones y auditoría
        
    

---

Perfecto. Integro lo que comentas y dejo la **continuación de la documentación**, manteniendo el mismo tono técnico y coherente con la Etapa 1. Puedes pegar esto directamente como siguiente sección.

---

### **3. Término de llamada – Evento** 

### **CDR End**

  

Cuando la llamada finaliza, OCP emite un evento **CDR End**, el cual indica el cierre definitivo de la llamada.

  

Al recibirse este evento:

- Se marca formalmente el término de la llamada en el sistema.
    
- Se actualiza el registro existente en **DynamoDB**, previamente creado con el evento _CDR Start_.
    
- Se confirma que la llamada ha finalizado y queda lista para el procesamiento de su archivo asociado.
    

  

Este evento actúa como el **disparador principal** para la generación del archivo de la llamada.

  

### **4. Generación del archivo de voz**

  

Una vez emitido el evento **CDR End**, la plataforma **OCP** inicia el proceso de generación del archivo de voz correspondiente a la llamada.

  

Durante este proceso, OCP:

- Genera el archivo de audio de la llamada.
    
- Aplica filtros y transformaciones configuradas, tales como:
    
    - Normalización de audio
        
    - Recortes o silencios
        
    - Otras reglas de procesamiento definidas por la plataforma
        
    
- Finaliza el archivo en su formato estándar (por ejemplo, WAV o MP3).
    

  

Este proceso se realiza de forma asíncrona y puede tomar un tiempo variable dependiendo de la duración de la llamada y la carga del sistema.

  

### **5. Envío del archivo mediante streaming**

  

Una vez finalizada la generación del archivo de voz:

- OCP publica el archivo utilizando el mecanismo de **suscripción de streaming** configurado.
    
- El archivo es transmitido hacia nuestra plataforma como parte del flujo de ingestión.
    
- El envío incluye la información necesaria para correlacionar el archivo con la llamada registrada en DynamoDB (por ejemplo, Call ID).
    

  

Nuestra plataforma recibe el archivo y lo asocia al registro correspondiente, permitiendo su almacenamiento, procesamiento adicional o análisis posterior.

  

### **6. Resultado de la Etapa 1**

  

Con la recepción del archivo de voz:

- Se completa el flujo principal de ingestión de llamadas.
    
- El registro en DynamoDB queda enriquecido con el estado final y la referencia al archivo generado.
    
- Aproximadamente el **90% de los archivos** se procesan exitosamente dentro de esta etapa, sin requerir reprocesos adicionales.
    

Perfecto. A continuación te dejo la **continuación integrada y cerrando la Etapa 1**, con lenguaje formal, claro y consistente para documentación técnica.

---

### **6. Recepción del archivo en la plataforma**

  

Cuando el archivo de voz es recibido en nuestra plataforma a través del mecanismo de streaming:

- La **API de ingestión** procesa el archivo entrante.
    
- Se actualiza el registro correspondiente en **DynamoDB**, marcando un flag que indica que el **archivo fue recibido exitosamente**.
    
- Este flag permite confirmar que la llamada cuenta con su archivo de audio asociado.
    

  

### **7. Post-processing del archivo**

  

Una vez confirmada la recepción del archivo, se inicia el proceso de **post-processing**.

  

Durante esta fase:

- Se analizan y extraen **metadatos del archivo**, tales como:
    
    - Duración real del audio
        
    - Formato y características técnicas
        
    - Identificadores de correlación
        
    
- Se ejecutan las **validaciones necesarias**, que pueden incluir:
    
    - Integridad del archivo
        
    - Coherencia entre metadatos y datos de la llamada
        
    - Cumplimiento de reglas de negocio
        
    

  

Al finalizar el post-processing:

- Se actualiza nuevamente el registro en **DynamoDB**.
    
- Se marca un segundo flag indicando que el **post-processing fue completado exitosamente**.
    

  

### **8. Almacenamiento final en Amazon S3**

  

Una vez concluido el post-processing:

- El archivo de voz se copia hacia un **bucket de Amazon S3** correspondiente a la **línea de negocio (OB)** asociada a la llamada.
    
- El bucket de destino está segmentado por línea de negocio para garantizar:
    
    - Separación lógica de datos
        
    - Control de acceso
        
    - Escalabilidad y gobernanza
        
    

  

Al completarse la copia en S3:

- Se marca un nuevo flag en **DynamoDB**, indicando que el **archivo fue almacenado correctamente en su ubicación final**.
    

  

### **9. Finalización del flujo principal**

  

Con la actualización del último flag:

- Se considera **completado el flujo principal de ingestión**.
    
- El registro en DynamoDB refleja el estado completo del ciclo:
    
    - Inicio de llamada
        
    - Fin de llamada
        
    - Recepción del archivo
        
    - Post-processing completado
        
    - Almacenamiento final en S3
        
    

  

Este flujo cubre aproximadamente el **90% de los archivos recibidos**, los cuales se procesan de manera automática y sin intervención adicional.



Perfecto. Continúo la redacción y la dejo **cerrada, clara y lista para documentación**, incorporando el concepto de **estado, resiliencia y recuperación**.

---

### **10. Gestión de estado y persistencia del proceso**

  

Cada vez que una llamada **se inicia**, **finaliza** y **su archivo es recibido**, el sistema persiste de forma incremental los **registros y flags de estado** en **DynamoDB**.

  

Estos flags permiten:

- Mantener el **estado exacto** del archivo asociado a cada llamada.
    
- Tener visibilidad clara de en qué etapa del flujo se encuentra cada llamada.
    
- Soportar procesos asíncronos y desacoplados.
    
- Facilitar la detección de fallos y la recuperación del proceso.
    

  

El estado se actualiza de manera progresiva a lo largo del flujo, incluyendo, entre otros:

- Llamada iniciada
    
- Llamada finalizada
    
- Archivo recibido
    
- Post-processing completado
    
- Archivo copiado a S3
    

  

### **11. Manejo de interrupciones y reintentos**

  

Si por alguna razón el proceso se interrumpe en cualquiera de las etapas (por ejemplo, fallos de red, errores temporales en servicios externos o problemas internos de procesamiento):

- El estado persistido en **DynamoDB** permite identificar con precisión el **último paso exitoso**.
    
- El sistema puede **reanudar el procesamiento** desde la última etapa completada, sin necesidad de reprocesar la llamada completa.
    
- Se evitan duplicaciones de archivos y operaciones innecesarias.
    

  

Este enfoque garantiza:

- **Idempotencia** en el procesamiento.
    
- **Resiliencia** ante fallos parciales.
    
- **Consistencia** en la ingestión de archivos.
    

  

### **12. Beneficios del modelo basado en flags**

  

El uso de flags de estado en DynamoDB proporciona los siguientes beneficios clave:

- Trazabilidad completa del ciclo de vida de la llamada y su archivo.
    
- Capacidad de monitoreo y alertas por estados incompletos.
    
- Base sólida para manejar el **10% de casos excepcionales** fuera del flujo principal.
    
- Escalabilidad del sistema sin incrementar complejidad operativa.
    

---
Excelente, con esto ya tenemos el **flujo completo de la Etapa 2 (reconciliación)**. A continuación te dejo una **redacción estructurada, clara y formal**, lista para documentación de arquitectura / diseño técnico. He ordenado el texto, eliminado repeticiones y dejado explícitos los puntos de control.

---

## **Etapa 2: Proceso de Reconciliación de Archivos de Audio (≈10% de los casos)**

  

De manera eventual, pueden existir llamadas para las cuales **no se recibe el archivo de audio** dentro del flujo principal descrito en la Etapa 1.

Esto puede ocurrir por múltiples razones, tales como fallos temporales, retrasos en la generación del archivo o problemas de comunicación con OCP.

  

Para manejar estos casos, el sistema implementa un **proceso de reconciliación**, cuyo objetivo es **identificar, recuperar y completar el procesamiento de las llamadas pendientes**.

---

### **1. Detección de llamadas pendientes**

  

El sistema de reconciliación se ejecuta de forma **periódica**, con una frecuencia configurable (por ejemplo, cada 30 minutos, cada 1 hora o cada _N_ minutos).

  

En cada ejecución:

- Se gatilla un evento programado.
    
- Este evento invoca una **Lambda de polling**.
    
- La Lambda consulta **DynamoDB** para identificar llamadas que:
    
    - No han completado todos los flags de estado definidos en la Etapa 1.
        
    - Se consideran pendientes de recibir o procesar el archivo de audio.
        
    

  

Si se detectan llamadas incompletas:

- Estas llamadas son seleccionadas y ordenadas para su reprocesamiento.
    
- Se inicia el **proceso de reconciliación** mediante **AWS Step Functions**.
    

---

### **2. Inicio del proceso de reconciliación con Step Functions**

  

El proceso de polling genera un evento que:

- Dispara la ejecución de una **State Machine de Step Functions**.
    
- Step Functions crea:
    
    - Un **Task ID**
        
    - Un **Task Token**, que será utilizado para callbacks asíncronos.
        
    
- Se inicia formalmente el flujo de reconciliación.
    

---

### **3. Creación del Export Job en OCP**

  

El primer paso del State Machine consiste en:

- Invocar las **APIs de Omilia / OCP Export API**.
    
- Crear un **Export Job** para la llamada pendiente.
    
- Obtener como respuesta un **Export Job ID**.
    

  

Este Export Job es el encargado de preparar los archivos de audio asociados a la llamada.

---

### **4. Programación del polling del Export Job**

  

Una vez creado el Export Job:

- El flujo avanza a un paso que **no consulta inmediatamente el estado**.
    
- En su lugar, se crea un **evento programado en Amazon EventBridge** para un tiempo futuro configurable (por ejemplo, 1, 2, 5 o 6 minutos).
    

  

Este evento futuro:

- Gatilla una **Lambda Puller**, encargada de consultar el estado del Export Job.
    

---

### **5. Consulta del estado del Export Job (loop controlado)**

  

La Lambda Puller recibe como información mínima:

- Export Job ID
    
- Task Token
    
- Dialog Group ID
    

  

Con estos datos:

- Ejecuta el endpoint de **OCP Export API** para consultar el estado del Export Job.
    

  

#### **Comportamiento según el estado:**

- **Si el estado no es** **COMPLETED** (por ejemplo, IN_PROGRESS o error temporal):
    
    - La Lambda crea un **nuevo evento en EventBridge** para volver a consultar el estado en el futuro.
        
    - Se repite el proceso de polling en un loop controlado.
        
    - El número de iteraciones y el tiempo máximo de espera deben estar configurados y limitados.
        
    
- **Si el estado es** **COMPLETED**:
    
    - La Lambda Puller envía un **callback a Step Functions** utilizando el **Task Token**.
        
    - Se actualiza el estado correspondiente en **DynamoDB**.
        
    - Se notifica al State Machine que puede avanzar al siguiente paso.
        
    

---

### **6. Ejecución en paralelo tras la finalización del Export Job**

  

Una vez confirmado que el Export Job está completo, la Step Function avanza a un **paso de ejecución en paralelo**, que incluye:

  

#### **6.1 Obtención de metadatos**

- Una Lambda consulta nuevamente la **OCP Export API**.
    
- Obtiene los **metadatos del Export Job**.
    
- Esta información se almacena y se asocia a la llamada correspondiente.
    

  

#### **6.2 Descarga de archivos (Fargate)**

- En paralelo, se inicia otro step que:
    
    - Genera un evento de espera.
        
    - Es consumido por un **servicio en Amazon Fargate**.
        
    
- El servicio en Fargate:
    
    - Descarga los archivos de audio usando la **Export API de OCP**.
        
    - Ejecuta el procesamiento posterior necesario (validaciones, organización, etc.).
        
    

  

Una vez completada la descarga y el procesamiento:

- El servicio en Fargate envía un **callback a Step Functions**, utilizando el **Task Token**.
    
- Indica que el paso de **Download File** ha finalizado exitosamente.
    

---

### **7. Finalización del proceso de reconciliación**

  

Con la recepción del callback final:

- La ejecución de la **Step Function** se completa.
    
- Se actualizan los flags finales en **DynamoDB**.
    
- La llamada queda completamente reconciliada y procesada.
    
- Se cierra el ciclo de ingestión para ese caso excepcional.
    

---

### **8. Beneficios del enfoque de reconciliación**

  

Este modelo permite:

- Recuperar llamadas sin archivo recibido en el flujo principal.
    
- Evitar reprocesamientos innecesarios.
    
- Mantener trazabilidad completa mediante estados persistidos.
    
- Controlar tiempos, reintentos e iteraciones.
    
- Separar claramente el **happy path (90%)** de los **casos excepcionales (10%)**.
    

---


