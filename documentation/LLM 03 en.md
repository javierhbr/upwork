# Análisis de Patrones en Llamadas IVR con LLM Local

Te voy a crear un notebook completo que implementa este flujo usando Ollama y ChromaDB (base vectorial local). La arquitectura combina embeddings para encontrar casos similares + LLM para explicar patrones.[Descarga el notebook](https://claude.ai/chat/9fd77ab3-368d-45fc-b93a-58acfe487a0f)

## Arquitectura Implementada

El notebook implementa un sistema **RAG (Retrieval-Augmented Generation)** completamente local:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   CSV Dataset   │────▶│  Procesamiento   │────▶│   Narrativas    │
│  (llamadas IVR) │     │  (Pandas)        │     │   Textuales     │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│    ChromaDB     │◀────│     Ollama       │◀────│   Embeddings    │
│  (persistente)  │     │ nomic-embed-text │     │                 │
└────────┬────────┘     └──────────────────┘     └─────────────────┘
         │
         │  Búsqueda de casos similares
         ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Nueva Llamada  │────▶│  RAG + Contexto  │────▶│     Ollama      │
│   (a analizar)  │     │  (casos simil.)  │     │   llama3.1      │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │   Explicación   │
                                                 │   del Fallo     │
                                                 └─────────────────┘
```

## Requisitos Previos

```bash
# Instalar Ollama (si no lo tienes)
curl -fsSL https://ollama.com/install.sh | sh

# Descargar modelos
ollama pull nomic-embed-text   # Para embeddings
ollama pull llama3.1           # Para análisis (o mistral si prefieres)

# Iniciar servicio
ollama serve
```

## Componentes Clave

|Componente|Función|Tecnología|
|---|---|---|
|`CallDataProcessor`|Convierte filas CSV en narrativas textuales ricas|Pandas|
|`OllamaEmbeddings`|Genera vectores de 768 dimensiones|Ollama + nomic-embed-text|
|`IVRVectorStore`|Almacena y busca casos similares|ChromaDB (persistente)|
|`IVRPatternAnalyzer`|Genera explicaciones contextualizadas|Ollama + llama3.1|

## Uso Típico

```python
# Analizar una llamada específica
resultado = analizar_fallo_rapido(
    call_type="billing",
    failure_step="authentication",
    failure_reason="biometric_fail",
    customer_segment="premium"
)
print(resultado)
```

**Output esperado:**

> "Esta llamada falló en el paso de autenticación debido a un fallo biométrico. Basándome en 5 casos similares, este patrón es común en clientes premium durante horas pico. La causa raíz probable es..."

Adapta las columnas del procesador según la estructura de tu CSV real. Si me compartes una muestra de tu dataset, puedo ajustar el código específicamente para tus datos.