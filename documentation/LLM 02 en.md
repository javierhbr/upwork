Here is the translation and step-by-step explanation of the provided solution.

This solution is designed to build a **Local RAG (Retrieval-Augmented Generation) System** for analyzing call center logs. It uses **Ollama** (for AI models) and **ChromaDB** (for memory) to run entirely on your machine without the cloud.

The solution is divided into three parts:

1. **The Jupyter Notebook:** For prototyping and understanding the logic.
    
2. **Production Scripts:** Python files ready for real-world use.
    
3. **Repository Structure:** How to organize files for a professional project.
    

---

### Part 1: The Jupyter Notebook (`analisis_llamadas.ipynb`)

This notebook is the "laboratory" where we build the logic step-by-step.

#### **Cell 1 & 2: Setup and Installation**

**Concept:** We install the necessary tools.

- `pandas`: To handle the CSV data table.
    
- `chromadb`: The local database to store "vectors" (mathematical representations of text).
    
- `scikit-learn`: For the K-Means clustering algorithm.
    
- `ollama`: To communicate with the local AI models.
    

#### **Cell 3 & 4: Loading Data**

**Concept:** We load the raw data (`llamadas.csv`) into a dataframe.

#### **Cell 5: Cleaning and Feature Engineering**

Concept: The AI needs to know if a call was a "Success" or a "Failure" to learn patterns.

Explanation: We define a function label(row) that looks at columns like success, transferred, or hangup and assigns a single text label (e.g., "fail_user_hangup"). This creates a clean "Target" variable.

#### **Cell 6: Semantic Text Conversion**

Concept: Vector databases store text, not Excel rows.

Explanation: The function to_text(row) takes a structured row (e.g., Step 1=OK, Step 2=Error 500) and converts it into a narrative paragraph: "CallID: 101 | Result: Fail. Step 1=OK; Step 2=Error 500...". This allows the AI to "read" the row as a story.

#### **Cell 7: Generating Embeddings**

Concept: Translating text into numbers.

Explanation: We use ollama.embeddings with the model nomic-embed-text. This turns the paragraph created in Cell 6 into a list of numbers (a vector). Similar calls will have mathematically similar numbers.

#### **Cell 8: Local Vector Database (ChromaDB)**

Concept: Storing the "memories."

Explanation:

1. We initialize a local Chroma client.
    
2. We create a collection named "calls".
    
3. We `.add()` the IDs, text, and vectors. Now the data is searchable by meaning.
    

#### **Cell 9: Clustering (K-Means)**

Concept: Finding hidden groups.

Explanation: We use K-Means to group the vectors into 5 clusters. The AI might discover that "Cluster 1" contains mostly calls that failed due to payment APIs, even if you didn't explicitly label them that way.

#### **Cell 10: The Advanced Analysis Function (The Core Logic)**

Concept: This function performs the RAG workflow.

Step-by-Step flow of the code:

1. **Embed:** It takes a _new_ call and converts it to a vector.
    
2. **Search:** It asks ChromaDB: "Give me the 10 most similar calls from history."
    
3. **Statistics:** It calculates the failure rate of specific steps within those 10 similar calls (e.g., "In similar cases, Step 3 failed 80% of the time").
    
4. **Prompting:** It creates a prompt for **Llama 3** containing:
    
    - The historical similar cases.
        
    - The calculated failure stats.
        
    - The new call details.
        
5. **Inference:** It asks Llama 3 to act as an expert and diagnose the root cause based on that evidence.
    

---

### Part 2: Production Scripts

These scripts take the logic from the notebook and make it robust for actual usage (error handling, batch processing, logging).

#### **1. `analyzer_service.py` (The Backend Logic)**

This is a reusable Python class. You don't run this directly; other scripts import it.

- **Class `CallAnalyzer`:** manages the connection to ChromaDB and Ollama.
    
- **`embed_text`:** Handles retries (if Ollama glitches, it tries again 3 times).
    
- **`analyze_advanced`:** The same logic as Cell 10 in the notebook but cleaner and with error logging.
    
- **`add_or_update_records`:** Ensures you don't create duplicate entries in your database.
    

#### **2. `regenerate_embeddings.py` (The Data Ingestion)**

You run this script to "teach" the system new data.

- **What it does:** It reads your CSV, generates embeddings in batches (e.g., 64 at a time) to avoid crashing memory, and saves them to ChromaDB.
    
- **Usage:** `python regenerate_embeddings.py --csv my_data.csv --overwrite`
    

#### **3. `batch_analysis_pipeline.py` (The Processor)**

You run this script when you have 1,000 new calls and want to diagnose them all at once.

- **What it does:** It uses `joblib` to run in parallel (using multiple CPU cores). It processes the new calls and outputs a `parquet` or CSV file with the AI's diagnosis for every single row.
    

---

### Part 3: The Mini-Repo Structure

This section provides a clean folder structure to organize the project.

#### **Directory Tree**

Plaintext

```
selfservice-analyzer/
│
├── requirements.txt       # List of python libraries to install
├── Makefile               # Shortcuts for terminal commands
├── data/                  # Folder to hold your CSVs
│   └── llamadas_sinteticas.csv
│
└── src/                   # Source code folder
    ├── common.py          # Shared functions (setup DB, etc.)
    ├── generate_embeddings.py  # Script to load data
    ├── batch_analyzer.py       # Script to analyze many calls
    └── analyze_one.py          # Script to test a single call
```

#### **Makefile Translation**

A Makefile helps you run long commands with short keywords.

- `make install`: Runs pip install.
    
- `make embeddings`: Runs the script to ingest data.
    
- `make batch`: Runs the bulk analysis.
    
- `make one`: Runs a single test case.
    

#### **Simplified Source Scripts (`src/`)**

These are simplified versions of the production scripts for easier reading:

- **`common.py`:** Contains the shared `embed` function and DB connection so you don't repeat code.
    
- **`batch_analyzer.py`:** Loops through your CSV, asks the database for similar cases, and saves the results to a JSON file.
    
- **`analyze_one.py`:** A simple test script. You hardcode a call pattern in the script, run it, and watch the AI explain why it failed in the terminal.
    

#### **Synthetic Data (`llamadas_sinteticas.csv`)**

This is a fake dataset provided so you can copy/paste it and test the code immediately without needing your real data yet. It contains columns for step statuses (`ok`, `error_xx`), duration, and final results.

### Summary of Next Steps for You:

1. **Install requirements:** `pip install pandas chromadb scikit-learn ollama tqdm`.
    
2. **Pull models:** Run `ollama pull llama3` and `ollama pull nomic-embed-text` in your terminal.
    
3. **Copy the Repo:** Create the folder structure and files as shown in "Part 3".
    
4. **Run Ingestion:** Run `make embeddings` to fill your local database.
    
5. **Test:** Run `make one` to see the AI diagnose a fake failure.