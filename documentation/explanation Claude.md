Te explico el proceso completo de ingestión de archivos desde OCP, que está dividido en dos etapas bien diferenciadas.

## Etapa 1: Flujo Principal (≈90% de los archivos)

Esta es la ruta "feliz" donde todo funciona correctamente de forma automática.

### El ciclo de vida de una llamada

**1. Inicio (CDR Start)** Cuando un cliente inicia una llamada, OCP emite un evento CDR Start. En ese momento se crea un registro en DynamoDB con el Call ID, timestamp, identificador del cliente, canal IVR y metadatos de correlación.

**2. Término (CDR End)** Al finalizar la llamada, OCP emite CDR End. Este evento es el disparador principal: actualiza el registro en DynamoDB y señala que la llamada está lista para generar su archivo de audio.

**3. Generación del archivo** OCP genera el archivo de voz de forma asíncrona, aplicando normalización de audio, recortes y otras transformaciones. El tiempo depende de la duración de la llamada y la carga del sistema.

**4. Streaming del archivo** OCP publica el archivo mediante suscripción de streaming hacia tu plataforma, incluyendo el Call ID para correlacionar con el registro existente.

**5. Recepción y post-processing** La API de ingestión recibe el archivo, marca un flag en DynamoDB confirmando la recepción, extrae metadatos (duración, formato, etc.) y ejecuta validaciones de integridad.

**6. Almacenamiento en S3** El archivo se copia al bucket correspondiente según la línea de negocio (OB), y se marca el flag final en DynamoDB.

### Sistema de flags

Cada paso actualiza un flag específico en DynamoDB:

- Llamada iniciada
- Llamada finalizada
- Archivo recibido
- Post-processing completado
- Archivo copiado a S3

Esto permite **resiliencia**: si algo falla, el sistema puede reanudar exactamente donde quedó sin reprocesar todo.

---

## Etapa 2: Reconciliación (≈10% de los casos)

Para llamadas que no recibieron su archivo en el flujo principal.

### Flujo de recuperación

**1. Detección periódica** Un evento programado (cada N minutos configurable) invoca una Lambda de polling que consulta DynamoDB buscando llamadas con flags incompletos.

**2. Inicio de Step Functions** Si hay llamadas pendientes, se dispara una State Machine que genera un Task ID y Task Token para callbacks asíncronos.

**3. Creación del Export Job** Se invoca la API de OCP/Omilia para crear un Export Job, obteniendo un Export Job ID.

**4. Polling controlado del Export Job** En lugar de esperar activamente, se programa un evento futuro en EventBridge (1-6 minutos). Una Lambda Puller consulta el estado:

- Si no está COMPLETED → programa otro evento y repite el loop
- Si está COMPLETED → envía callback a Step Functions y actualiza DynamoDB

**5. Ejecución paralela** Cuando el Export Job termina, se ejecutan dos tareas simultáneas:

- **Lambda de metadatos**: consulta la API y almacena los metadatos
- **Fargate para descarga**: descarga los archivos de audio y ejecuta el procesamiento

**6. Finalización** Fargate envía callback a Step Functions, se actualizan los flags finales y la llamada queda completamente reconciliada.

---

## Visión general

|Aspecto|Etapa 1|Etapa 2|
|---|---|---|
|Cobertura|~90%|~10%|
|Trigger|Eventos en tiempo real de OCP|Polling periódico|
|Mecanismo|Streaming directo|Export Jobs + EventBridge|
|Complejidad|Lineal|Orquestado con Step Functions|

El diseño es elegante porque separa claramente el flujo normal del manejo de excepciones, usando DynamoDB como fuente de verdad para el estado de cada llamada.



