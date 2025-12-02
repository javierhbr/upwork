Este es un excelente caso de uso para una arquitectura **RAG (Retrieval-Augmented Generation)** local. Dado que tienes restricciones estrictas (sin nube, solo local, acceso a una base de datos vectorial), no necesitas "entrenar" (fine-tune) el modelo modificando sus pesos, lo cual es costoso y lento.

En su lugar, utilizarás la **Base de Datos Vectorial como la "memoria a largo plazo"** de patrones pasados. El flujo lógico será:

1.  **Indexar:** Convertir tus logs históricos (CSV) en vectores y guardarlos.
2.  **Recuperar:** Cuando llega un nuevo caso, buscar los casos históricos más similares (donde ya sabes qué pasó).
3.  **Inferir:** Pasarle al LLM (Ollama) el nuevo caso + los casos similares recuperados y pedirle que detecte el patrón de falla.

Aquí tienes la guía paso a paso y el código necesario para tu Notebook.

### Prerrequisitos

Necesitarás instalar las siguientes librerías en tu entorno local:

```bash
pip install pandas chromadb sentence-transformers ollama
```

  * **Pandas:** Manipulación del CSV.
  * **ChromaDB:** Tu base de datos vectorial local (ligera y no requiere servidor).
  * **Sentence-transformers:** Para crear los "embeddings" (convertir texto a números) localmente sin depender del LLM para esto (es más rápido).
  * **Ollama:** Para interactuar con tu modelo local (Llama 3, Mistral, etc.).

-----

### Paso 1: Preparación y Carga de Datos (CSV)

Primero, debemos transformar las filas de tu CSV en un formato narrativo que el modelo pueda entender semánticamente.

```python
import pandas as pd

# 1. Cargar el CSV
# Supongamos que tu CSV tiene: call_id, steps_history, final_status, error_code, customer_segment
df = pd.read_csv('call_center_data.csv')

# 2. Crear una columna de "Contexto"
# Convertimos la fila estructurada en un texto descriptivo.
# Esto ayuda al modelo a encontrar patrones semánticos.
def create_context(row):
    return f"""
    Interacción ID: {row['call_id']}.
    Secuencia de pasos: {row['steps_history']}.
    Estado Final: {row['final_status']}.
    Código de Error: {row['error_code']}.
    Nota: {row.get('notes', 'Sin notas adicionales')}
    """

df['text_for_embedding'] = df.apply(create_context, axis=1)

# Separar datos: Éxitos vs Errores (para que el modelo compare)
# Aunque para la DB vectorial es mejor meter todo para tener contexto completo.
documents = df['text_for_embedding'].tolist()
ids = df['call_id'].astype(str).tolist()
metadatas = df[['final_status', 'error_code']].to_dict(orient='records')

print(f"Datos preparados: {len(documents)} registros.")
```

-----

### Paso 2: Crear la Base de Datos Vectorial Local

Aquí es donde "guardamos los patrones". Usaremos `sentence-transformers` para crear embeddings de alta calidad localmente y `ChromaDB` para guardarlos.

```python
import chromadb
from chromadb.utils import embedding_functions

# 1. Configurar el cliente local de ChromaDB (se guarda en una carpeta local)
chroma_client = chromadb.PersistentClient(path="./my_local_vectordb")

# 2. Configurar la función de embedding local
# 'all-MiniLM-L6-v2' es pequeño, rápido y muy bueno para clustering semántico.
sentence_transformer_ef = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="all-MiniLM-L6-v2" 
)

# 3. Crear o conectar a la colección
collection = chroma_client.get_or_create_collection(
    name="call_patterns",
    embedding_function=sentence_transformer_ef
)

# 4. Inyectar la data (Esto se hace una sola vez o incrementalmente)
# Chroma maneja la tokenización y vectorización automáticamente con la función definida arriba.
collection.upsert(
    documents=documents,
    ids=ids,
    metadatas=metadatas
)

print("Base de datos vectorial actualizada localmente.")
```

-----

### Paso 3: Lógica de Detección de Patrones (El "Cerebro")

Ahora creamos la función que usa **Ollama**. Esta función toma un "nuevo caso" (ej. una llamada que falló hoy), busca en la DB vectorial qué pasó en casos parecidos anteriormente, y le pide a Ollama que diagnostique.

```python
import ollama

def analizar_incidente(nuevo_caso_texto):
    
    # 1. BÚSQUEDA SEMÁNTICA (RAG)
    # Buscamos los 5 casos históricos más parecidos a este nuevo problema
    results = collection.query(
        query_texts=[nuevo_caso_texto],
        n_results=5
    )
    
    contexto_recuperado = "\n".join(results['documents'][0])
    
    # 2. CONSTRUCCIÓN DEL PROMPT
    # Le damos al LLM el nuevo caso + la "memoria" de casos similares.
    prompt = f"""
    Eres un analista experto en IVR y experiencia de usuario. 
    
    Tu objetivo es identificar la CAUSA RAÍZ de un fallo en una interacción reciente basándote en patrones históricos.
    
    --- INFORMACIÓN HISTÓRICA SIMILAR (Base de Conocimiento) ---
    {contexto_recuperado}
    ------------------------------------------------------------
    
    --- NUEVO CASO A ANALIZAR ---
    {nuevo_caso_texto}
    -----------------------------
    
    INSTRUCCIONES:
    1. Compara el 'NUEVO CASO' con la 'INFORMACIÓN HISTÓRICA'.
    2. Identifica si existe un patrón común en los pasos previos al error (ej. siempre falla después del paso X).
    3. Explica por qué probablemente falló este caso (ej. Hangup por frustración, error técnico, transferencia forzada).
    4. Sé conciso y técnico.
    
    ANÁLISIS:
    """
    
    # 3. LLAMADA A OLLAMA (Local)
    # Asegúrate de tener corriendo 'ollama serve' y haber hecho 'ollama pull llama3' (o mistral)
    response = ollama.chat(model='llama3', messages=[
        {'role': 'user', 'content': prompt},
    ])
    
    return response['message']['content']

```

-----

### Paso 4: Ejecución (Probando el sistema)

Supongamos que tienes una nueva llamada que falló y quieres saber por qué, basado en lo que el sistema "aprendió" (indexó) de tu CSV.

```python
# Ejemplo de un caso nuevo que entra hoy
nuevo_caso = """
Interacción ID: NEW_999.
Secuencia de pasos: Inicio -> Autenticación -> Consulta Saldo -> Menú Pagos -> ERROR_API_TIMEOUT.
Estado Final: Error.
Nota: Cliente colgó después de 5 segundos de silencio.
"""

# Ejecutamos el análisis
analisis = analizar_incidente(nuevo_caso)

print("### Resultado del Análisis de Patrones ###")
print(analisis)
```

### ¿Por qué esta arquitectura es la mejor para tu caso?

1.  **Detección de Patrones Reales:** Si en tu CSV histórico hay 50 llamadas que fallaron en "Menú Pagos" por un error de API, la base de datos vectorial traerá esos ejemplos específicos. Ollama leerá esos ejemplos y dirá: *"Basado en los registros históricos, este fallo coincide con un patrón recurrente de Timeouts en el módulo de Pagos, lo que usualmente resulta en abandono (hang up) por parte del usuario debido a la espera."*
2.  **100% Local:** ChromaDB guarda archivos en disco. Ollama corre en tu CPU/GPU. Nada sale de tu máquina.
3.  **Sin "Entrenamiento" pesado:** No necesitas gastar días entrenando un modelo. Si mañana tienes un nuevo CSV con más datos, solo haces `collection.upsert` y el modelo es instantáneamente más inteligente.

### Resumen de pasos para ti:

1.  Limpia tu CSV para que los nombres de los pasos sean consistentes.
2.  Corre el script de **Carga** (Paso 1 y 2) una sola vez para llenar la base de datos.
3.  Usa el script de **Análisis** (Paso 3) cada vez que quieras diagnosticar una falla.

Aquí tienes el código completo estructurado para copiar y pegar directamente en un **Jupyter Notebook**.

Lo he diseñado para que sea **autocontenido**: incluye un generador de datos falsos (para que puedas probarlo ahora mismo sin tu CSV real) y luego la lógica para cargar tu CSV real.

### Requisitos previos (Terminal)

Antes de abrir el notebook, asegúrate de tener **Ollama** corriendo en tu máquina con el modelo que quieras usar (ej. Llama3):

Bash

```
ollama serve
ollama pull llama3
```

---

### 📘 TU NOTEBOOK: Detección de Patrones en IVR con RAG Local

Copia cada bloque de código en una celda separada de tu Jupyter Notebook.

#### Celda 1: Instalación de Librerías

Instalamos las dependencias necesarias. `chromadb` es nuestra base de datos vectorial local y `sentence-transformers` genera los vectores numéricos sin depender de la nube.

Python

```
!pip install pandas chromadb sentence-transformers ollama
```

#### Celda 2: Importaciones y Configuración

Configuramos las librerías.

Python

```
import pandas as pd
import chromadb
from chromadb.utils import embedding_functions
import ollama
import os

# Configuración
MODELO_LLM = "llama3"  # Asegúrate de tenerlo descargado en Ollama
COLECCION_NOMBRE = "ivr_patterns_db"
PATH_DB_VECTORIAL = "./local_chroma_db" # Carpeta donde se guardará la "memoria"

print("Librerías importadas correctamente.")
```

#### Celda 3: Carga de Datos (Opción A: Generar datos de prueba)

Si aún no tienes tu CSV limpio, ejecuta esta celda para crear un dataset de prueba que simula logs de IVR con errores y éxitos.

Python

```
# --- GENERADOR DE DATOS DE PRUEBA (SOLO SI NO TIENES CSV AÚN) ---
data = {
    'call_id': [101, 102, 103, 104, 105, 106],
    'steps_history': [
        "Inicio -> Menu Principal -> Consulta Saldo -> Fin",
        "Inicio -> Menu Principal -> Pagos -> Ingreso Tarjeta -> Error 500",
        "Inicio -> Menu Principal -> Pagos -> Ingreso Tarjeta -> Timeout",
        "Inicio -> Soporte -> Espera -> Agente",
        "Inicio -> Menu Principal -> Pagos -> Ingreso Tarjeta -> Rechazada",
        "Inicio -> Menu Principal -> Pagos -> Ingreso Tarjeta -> Error 503"
    ],
    'final_status': ['Exito', 'Error', 'Hangup', 'Transferencia', 'Error', 'Error'],
    'error_code': ['N/A', 'API_FAIL', 'USER_TIMEOUT', 'N/A', 'BANK_DECLINE', 'API_FAIL'],
    'user_segment': ['Gold', 'Standard', 'Standard', 'Gold', 'Premium', 'Standard']
}

df = pd.DataFrame(data)
print("Datos de prueba generados:")
display(df.head())
```

#### Celda 4: Carga de Datos (Opción B: Tu CSV Real)

Cuando tengas tu archivo, usa esta celda en lugar de la anterior.

Python

```
# Descomenta las líneas de abajo para usar tu archivo real
# df = pd.read_csv('tu_archivo_de_datos.csv')

# Asegúrate de que las columnas coincidan o renómbralas
# df = df.rename(columns={'id_llamada': 'call_id', ...})
```

#### Celda 5: Preparación de Datos y Creación de Embeddings

Aquí convertimos las filas de la tabla en "Historias" de texto para que el modelo entienda el contexto semántico (ej: que un Error 503 es similar a un Error 500).

Python

```
# 1. Función para crear una narrativa de texto por fila
def row_to_text(row):
    return f"""
    ID Interacción: {row['call_id']}
    Secuencia de Pasos: {row['steps_history']}
    Resultado Final: {row['final_status']}
    Código de Error: {row['error_code']}
    Segmento Usuario: {row.get('user_segment', 'General')}
    """

# Aplicamos la función
df['text_content'] = df.apply(row_to_text, axis=1)

# 2. Inicializar ChromaDB (Base de datos vectorial local)
client = chromadb.PersistentClient(path=PATH_DB_VECTORIAL)

# Usamos un modelo de embeddings ligero y local (muy rápido)
# all-MiniLM-L6-v2 es estándar para esto.
emb_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="all-MiniLM-L6-v2"
)

# 3. Crear o resetear la colección
try:
    client.delete_collection(name=COLECCION_NOMBRE) # Limpiamos si ya existía para evitar duplicados en pruebas
except:
    pass

collection = client.create_collection(
    name=COLECCION_NOMBRE,
    embedding_function=emb_fn
)

# 4. Inyectar datos en la DB Vectorial
print("Indexando datos en la base vectorial local...")
collection.add(
    documents=df['text_content'].tolist(),
    metadatas=df[['final_status', 'error_code']].to_dict(orient='records'),
    ids=[str(x) for x in df['call_id'].tolist()]
)

print(f"¡Éxito! {len(df)} registros indexados en la memoria local.")
```

#### Celda 6: La Lógica de IA (El "Cerebro")

Esta función hace la magia. Recibe un caso nuevo, busca en la DB casos parecidos, y se los envía a Ollama para que opine.

Python

```
def analizar_patron_falla(nuevo_caso_steps, nuevo_caso_error):
    
    # 1. Construir el texto de búsqueda
    query_text = f"Secuencia: {nuevo_caso_steps}. Error: {nuevo_caso_error}"
    
    # 2. Recuperar contextos similares (RAG)
    results = collection.query(
        query_texts=[query_text],
        n_results=3  # Traemos los 3 casos históricos más parecidos
    )
    
    contexto = "\n---\n".join(results['documents'][0])
    
    # 3. Prompt para Ollama
    prompt = f"""
    Actúa como un analista experto en datos de Call Center e IVR.
    Tu tarea es analizar por qué falló una interacción reciente basándote en patrones históricos.

    === HISTORIAL DE CASOS SIMILARES (MEMORIA) ===
    {contexto}
    ==============================================

    === NUEVO CASO A ANALIZAR ===
    Pasos: {nuevo_caso_steps}
    Error Reportado: {nuevo_caso_error}
    =============================

    INSTRUCCIONES:
    1. Analiza los "Casos Similares". ¿Ves un patrón en donde ocurren los fallos?
    2. Compara con el "Nuevo Caso".
    3. Predice la causa raíz más probable (ej: fallo de API en paso de pago, usuario frustrado por longitud del menú, etc.).
    4. Responde en Español, directo y conciso.
    """

    # 4. Llamada al modelo local
    print("Consultando a Ollama (esto puede tardar unos segundos dependiendo de tu CPU/GPU)...")
    response = ollama.chat(model=MODELO_LLM, messages=[
        {'role': 'user', 'content': prompt},
    ])
    
    return response['message']['content']
```

#### Celda 7: Ejecución y Prueba

Simulamos que entra una llamada nueva que falló y le preguntamos al sistema.

Python

```
# --- SIMULACIÓN DE UN CASO NUEVO ---
# Imagina que esto acaba de pasar en producción:
nueva_secuencia = "Inicio -> Menu Principal -> Pagos -> Ingreso Tarjeta -> Error de conexión"
nuevo_error = "API_TIMEOUT"

print(f"Analizando incidente: {nuevo_error} en {nueva_secuencia}\n")

resultado = analizar_patron_falla(nueva_secuencia, nuevo_error)

print("-" * 30)
print("REPORTE DEL MODELO:")
print(resultado)
print("-" * 30)
```

### ¿Qué está pasando "por detrás"?

1. **ChromaDB** convierte tu texto "Ingreso Tarjeta -> Error de conexión" en números.
    
2. Busca en los vectores guardados y encuentra que los IDs 102 y 106 (del generador de datos) son matemáticamente muy cercanos porque también tuvieron problemas en "Pagos" e "Ingreso Tarjeta".
    
3. Recupera esos textos completos.
    
4. **Ollama** recibe un prompt que dice: _"Mira, en el pasado, cuando la gente entraba a Pagos y fallaba, era usualmente un 'API_FAIL'. Ahora tengo este caso nuevo. ¿Qué opinas?"_
    
5. Ollama razona y te responde identificando el patrón.
    

Esta estructura es totalmente local, privada y no requiere internet para funcionar una vez instaladas las librerías.