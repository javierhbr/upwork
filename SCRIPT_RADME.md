# Data Processing and Organization Workflow

## **📋 Processing Pipeline**

### Phase 1: Data Discovery and Processing
1. **Initialize Root Directory Scan**
   - Locate and load the `config.yaml` file for system configurations

2. **Navigate Directory Structure**
   - Scan all first-level subdirectories (dataset folders)
   - Identify JSON test files within each subdirectory

3. **Extract and Match Files**
   - Read each JSON file to extract the `Golden Dialog` attribute
   - Locate the corresponding file in the `Golden/` subdirectory using the attribute value as filename

4. **Link Related Content**
   - Open the matching Golden file and extract the `Golden Dialog ID` field
   - Create relationships between test files and their golden references

5. **Store in MongoDB**
   - Insert documents with the following structure:
   ```json
   {
     "json_file_path": "path/to/test/file.json",
     "golden_file_path": "path/to/golden/file.json",
     "json_content": { /* test file content */ },
     "golden_content": { /* golden file content */ },
     "dataset": "dataset_name",
     "relation": {
       "goldenDialog": "<Golden Dialog attribute>",
       "goldenDialogId": "<Golden Dialog ID value>"
     }
   }
   ```

---

## **🏗️ Directory Structure Overview**

**Source Structure:**
```
root/
 ├── config.yaml
 ├── dataset1/
 │    ├── file1.json          # Test files
 │    ├── file2.json          # Test files
 │    └── Golden/
 │         ├── dialog1.json   # Reference files
 │         └── dialog2.json   # Reference files
 ├── dataset2/
 │    ├── file3.json
 │    ├── file4.json
 │    └── Golden/
 │         ├── dialog3.json
 │         └── dialog4.json
 └── ...
```

**Processing Logic:**
- Iterate through all **top-level subdirectories** (dataset1, dataset2, etc.)
- Within each subdirectory, process **JSON files** (excluding the Golden/ directory)
- For each test JSON, find its corresponding file in the same subdirectory's Golden/ folder
- Link the files and save both to MongoDB with relationship metadata

---

## **📦 Phase 2: File Reorganization**

### Batch Creation Process
Using an array of file paths from MongoDB documents:
```json
[
  {
    "json_file_path": "path/to/test/file.json",
    "golden_file_path": "path/to/golden/file.json"
  }
]
```

**Reorganization Steps:**
1. **Create Batched Directories**
   - Generate new directories with configurable maximum file limits
   - When a directory reaches the XXX file limit, create the next batch directory

2. **Copy and Structure Files**
   - Copy test files to the root of each new directory
   - Copy golden files to a `Golden/` subdirectory within each new directory
   - Maintain the original file relationships

**Target Structure:**
```
output_root/
 ├── config.yaml
 ├── batch_001/
 │    ├── file1.json
 │    ├── file2.json
 │    └── Golden/
 │         ├── dialog1.json
 │         └── dialog2.json
 ├── batch_002/
 │    ├── file3.json
 │    ├── file4.json
 │    └── Golden/
 │         ├── dialog3.json
 │         └── dialog4.json
 └── ...
```

---

## **⚙️ Configuration Notes**

**Assumptions:**
- Test files are located in subdirectory roots (not in Golden/ folders)
- Golden reference files are in `Golden/` subdirectories
- Golden filenames exactly match the `Golden Dialog` field values from test files
- Directory structure follows the specified pattern

**Customization Options:**
- Adjust `JSON_DIR` and `GOLDEN_DIR` variables if directory structure differs
- Configure maximum files per batch directory (XXX parameter)
- Optional: Include YAML configuration data in MongoDB documents

**Key Features:**
- Automatic subdirectory traversal and processing
- Relationship mapping between test and golden files
- Dataset identification and labeling
- Configurable batch sizing for output organization
- Comprehensive MongoDB storage with full content and metadata



I'll create a comprehensive Python script that implements both phases of your workflow. This will be a robust solution with proper error handling and configuration management.I've created a comprehensive Python script that implements your two-phase workflow. Here are the key features and components:

## **Key Features:**

### **Phase 1: Data Discovery and Processing**
- **Directory Scanning**: Automatically finds all dataset subdirectories
- **JSON Processing**: Reads test files and extracts "Golden Dialog" attributes
- **File Matching**: Locates corresponding golden files using the attribute value
- **MongoDB Storage**: Stores complete file contents and relationships
- **Error Handling**: Robust error handling with detailed logging

### **Phase 2: File Reorganization**
- **Batch Creation**: Creates directories with configurable file limits
- **File Copying**: Maintains original structure (test files in root, golden files in Golden/ subdirectory)
- **Progress Tracking**: Logs progress for large datasets
- **Flexible Input**: Can use MongoDB data or custom file path arrays

## **Usage Instructions:**

1. **Install Dependencies:**
```bash
pip install pymongo pyyaml
```

2. **Update Configuration:**
- Set `ROOT_DIR` to your source directory path
- Set `OUTPUT_DIR` to your desired output path
- Configure MongoDB connection settings
- Adjust `MAX_FILES_PER_BATCH` as needed

3. **Run the Script:**
```bash
python data_processor.py
```

## **Key Methods:**

- `process_phase1()`: Implements the complete Phase 1 workflow
- `process_phase2()`: Handles file reorganization with batching
- `get_file_paths_from_mongodb()`: Retrieves file paths for Phase 2
- `setup_mongodb()`: Configures database connection

## **Customization Options:**

- **Batch Size**: Configure `MAX_FILES_PER_BATCH` parameter
- **MongoDB Settings**: Adjust connection string, database, and collection names
- **File Filtering**: Modify `_find_test_json_files()` for custom file selection
- **Golden File Matching**: The script handles both exact and case-insensitive matching

## **Error Handling:**
- Comprehensive logging at different levels
- Graceful handling of missing files or directories
- MongoDB connection management
- Progress reporting for large datasets

The script is production-ready with proper error handling, logging, and configurability. You can run both phases together or separately as needed.

```python
#!/usr/bin/env python3
"""
Data Processing and Organization Workflow
Implements a two-phase pipeline for processing JSON test files and their golden references.

Phase 1: Data Discovery and Processing
Phase 2: File Reorganization into Batches
"""

import os
import json
import yaml
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from pymongo import MongoClient
from pymongo.collection import Collection
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DataProcessor:
    """Main class for processing and organizing JSON data files."""
    
    def __init__(self, root_dir: str, config_path: Optional[str] = None):
        """
        Initialize the data processor.
        
        Args:
            root_dir: Root directory containing datasets
            config_path: Path to config.yaml file (optional)
        """
        self.root_dir = Path(root_dir)
        self.config_path = config_path or self.root_dir / "config.yaml"
        self.config = self._load_config()
        self.mongo_client = None
        self.collection = None
        
    def _load_config(self) -> Dict:
        """Load configuration from YAML file."""
        try:
            if self.config_path and os.path.exists(self.config_path):
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    config = yaml.safe_load(f)
                logger.info(f"Loaded config from {self.config_path}")
                return config or {}
            else:
                logger.warning(f"Config file not found at {self.config_path}")
                return {}
        except Exception as e:
            logger.error(f"Error loading config: {e}")
            return {}
    
    def setup_mongodb(self, connection_string: str = "mongodb://localhost:27017/", 
                     database: str = "data_processing", 
                     collection: str = "file_relations"):
        """
        Setup MongoDB connection.
        
        Args:
            connection_string: MongoDB connection string
            database: Database name
            collection: Collection name
        """
        try:
            self.mongo_client = MongoClient(connection_string)
            db = self.mongo_client[database]
            self.collection = db[collection]
            logger.info(f"Connected to MongoDB: {database}.{collection}")
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise
    
    def _find_dataset_directories(self) -> List[Path]:
        """Find all first-level subdirectories (datasets) in root directory."""
        datasets = []
        try:
            for item in self.root_dir.iterdir():
                if item.is_dir() and not item.name.startswith('.'):
                    datasets.append(item)
            logger.info(f"Found {len(datasets)} dataset directories")
            return datasets
        except Exception as e:
            logger.error(f"Error scanning root directory: {e}")
            return []
    
    def _find_test_json_files(self, dataset_dir: Path) -> List[Path]:
        """Find JSON test files in dataset directory (excluding Golden folder)."""
        test_files = []
        try:
            for item in dataset_dir.iterdir():
                if (item.is_file() and 
                    item.suffix.lower() == '.json' and 
                    item.parent.name.lower() != 'golden'):
                    test_files.append(item)
            logger.debug(f"Found {len(test_files)} test files in {dataset_dir.name}")
            return test_files
        except Exception as e:
            logger.error(f"Error scanning dataset {dataset_dir}: {e}")
            return []
    
    def _read_json_file(self, file_path: Path) -> Optional[Dict]:
        """Read and parse JSON file."""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error reading JSON file {file_path}: {e}")
            return None
    
    def _find_golden_file(self, dataset_dir: Path, golden_dialog_value: str) -> Optional[Path]:
        """Find the corresponding golden file based on Golden Dialog value."""
        golden_dir = dataset_dir / "Golden"
        if not golden_dir.exists():
            logger.warning(f"Golden directory not found in {dataset_dir}")
            return None
        
        # Try exact match first
        golden_file = golden_dir / f"{golden_dialog_value}.json"
        if golden_file.exists():
            return golden_file
        
        # Try case-insensitive search
        try:
            for file in golden_dir.iterdir():
                if (file.is_file() and 
                    file.suffix.lower() == '.json' and 
                    file.stem.lower() == golden_dialog_value.lower()):
                    return file
        except Exception as e:
            logger.error(f"Error searching golden directory {golden_dir}: {e}")
        
        logger.warning(f"Golden file not found for value: {golden_dialog_value}")
        return None
    
    def process_phase1(self) -> int:
        """
        Phase 1: Data Discovery and Processing
        
        Returns:
            Number of successfully processed file pairs
        """
        if not self.collection:
            raise ValueError("MongoDB collection not initialized. Call setup_mongodb() first.")
        
        logger.info("Starting Phase 1: Data Discovery and Processing")
        processed_count = 0
        
        # Find all dataset directories
        dataset_dirs = self._find_dataset_directories()
        
        for dataset_dir in dataset_dirs:
            logger.info(f"Processing dataset: {dataset_dir.name}")
            
            # Find test JSON files
            test_files = self._find_test_json_files(dataset_dir)
            
            for test_file in test_files:
                try:
                    # Read test JSON content
                    test_content = self._read_json_file(test_file)
                    if not test_content:
                        continue
                    
                    # Extract Golden Dialog attribute
                    golden_dialog_value = test_content.get('Golden Dialog')
                    if not golden_dialog_value:
                        logger.warning(f"No 'Golden Dialog' field in {test_file}")
                        continue
                    
                    # Find corresponding golden file
                    golden_file = self._find_golden_file(dataset_dir, golden_dialog_value)
                    if not golden_file:
                        continue
                    
                    # Read golden file content
                    golden_content = self._read_json_file(golden_file)
                    if not golden_content:
                        continue
                    
                    # Extract Golden Dialog ID
                    golden_dialog_id = golden_content.get('Golden Dialog ID', '')
                    
                    # Create document for MongoDB
                    document = {
                        'json_file_path': str(test_file.resolve()),
                        'golden_file_path': str(golden_file.resolve()),
                        'json_content': test_content,
                        'golden_content': golden_content,
                        'dataset': dataset_dir.name,
                        'relation': {
                            'goldenDialog': golden_dialog_value,
                            'goldenDialogId': golden_dialog_id
                        },
                        'processed_at': datetime.utcnow()
                    }
                    
                    # Insert into MongoDB
                    result = self.collection.insert_one(document)
                    if result.inserted_id:
                        processed_count += 1
                        logger.debug(f"Processed: {test_file.name} -> {golden_file.name}")
                    
                except Exception as e:
                    logger.error(f"Error processing {test_file}: {e}")
                    continue
        
        logger.info(f"Phase 1 completed. Processed {processed_count} file pairs.")
        return processed_count
    
    def get_file_paths_from_mongodb(self, limit: Optional[int] = None) -> List[Dict[str, str]]:
        """
        Retrieve file paths from MongoDB for Phase 2.
        
        Args:
            limit: Maximum number of records to retrieve
            
        Returns:
            List of dictionaries with json_file_path and golden_file_path
        """
        if not self.collection:
            raise ValueError("MongoDB collection not initialized.")
        
        try:
            query = {}
            cursor = self.collection.find(query, {
                'json_file_path': 1, 
                'golden_file_path': 1,
                '_id': 0
            })
            
            if limit:
                cursor = cursor.limit(limit)
            
            file_paths = list(cursor)
            logger.info(f"Retrieved {len(file_paths)} file path records from MongoDB")
            return file_paths
        
        except Exception as e:
            logger.error(f"Error retrieving file paths from MongoDB: {e}")
            return []
    
    def process_phase2(self, output_root: str, max_files_per_batch: int = 100, 
                      file_paths: Optional[List[Dict[str, str]]] = None) -> int:
        """
        Phase 2: File Reorganization into Batches
        
        Args:
            output_root: Root directory for organized output
            max_files_per_batch: Maximum number of files per batch directory
            file_paths: List of file paths (if None, will fetch from MongoDB)
            
        Returns:
            Number of batches created
        """
        logger.info("Starting Phase 2: File Reorganization")
        
        if file_paths is None:
            file_paths = self.get_file_paths_from_mongodb()
        
        if not file_paths:
            logger.warning("No file paths provided for Phase 2")
            return 0
        
        output_root = Path(output_root)
        output_root.mkdir(parents=True, exist_ok=True)
        
        # Copy config file to output root
        if self.config_path and os.path.exists(self.config_path):
            shutil.copy2(self.config_path, output_root / "config.yaml")
        
        batch_count = 0
        current_batch_size = 0
        current_batch_dir = None
        
        for i, file_pair in enumerate(file_paths):
            try:
                json_path = Path(file_pair['json_file_path'])
                golden_path = Path(file_pair['golden_file_path'])
                
                # Check if source files exist
                if not json_path.exists():
                    logger.warning(f"Test file not found: {json_path}")
                    continue
                if not golden_path.exists():
                    logger.warning(f"Golden file not found: {golden_path}")
                    continue
                
                # Create new batch directory if needed
                if current_batch_size == 0 or current_batch_size >= max_files_per_batch:
                    batch_count += 1
                    batch_name = f"batch_{batch_count:03d}"
                    current_batch_dir = output_root / batch_name
                    current_batch_dir.mkdir(exist_ok=True)
                    (current_batch_dir / "Golden").mkdir(exist_ok=True)
                    current_batch_size = 0
                    logger.info(f"Created batch directory: {batch_name}")
                
                # Copy test file to batch root
                test_dest = current_batch_dir / json_path.name
                shutil.copy2(json_path, test_dest)
                
                # Copy golden file to Golden subdirectory
                golden_dest = current_batch_dir / "Golden" / golden_path.name
                shutil.copy2(golden_path, golden_dest)
                
                current_batch_size += 1
                
                if (i + 1) % 100 == 0:
                    logger.info(f"Processed {i + 1}/{len(file_paths)} file pairs")
                
            except Exception as e:
                logger.error(f"Error processing file pair {i}: {e}")
                continue
        
        logger.info(f"Phase 2 completed. Created {batch_count} batch directories.")
        return batch_count
    
    def cleanup(self):
        """Close MongoDB connection."""
        if self.mongo_client:
            self.mongo_client.close()
            logger.info("MongoDB connection closed")


def main():
    """Main function demonstrating usage of the DataProcessor."""
    
    # Configuration
    ROOT_DIR = "path/to/your/root/directory"  # Update this path
    OUTPUT_DIR = "path/to/output/directory"   # Update this path
    MONGODB_URI = "mongodb://localhost:27017/"
    DATABASE_NAME = "data_processing"
    COLLECTION_NAME = "file_relations"
    MAX_FILES_PER_BATCH = 50  # Configurable batch size
    
    try:
        # Initialize processor
        processor = DataProcessor(ROOT_DIR)
        
        # Setup MongoDB
        processor.setup_mongodb(
            connection_string=MONGODB_URI,
            database=DATABASE_NAME,
            collection=COLLECTION_NAME
        )
        
        # Phase 1: Process and store in MongoDB
        logger.info("=" * 50)
        logger.info("STARTING PHASE 1")
        logger.info("=" * 50)
        processed_count = processor.process_phase1()
        
        if processed_count > 0:
            # Phase 2: Reorganize files into batches
            logger.info("=" * 50)
            logger.info("STARTING PHASE 2")
            logger.info("=" * 50)
            batch_count = processor.process_phase2(
                output_root=OUTPUT_DIR,
                max_files_per_batch=MAX_FILES_PER_BATCH
            )
            
            logger.info("=" * 50)
            logger.info("PROCESSING COMPLETE")
            logger.info(f"Processed {processed_count} file pairs")
            logger.info(f"Created {batch_count} batch directories")
            logger.info("=" * 50)
        else:
            logger.warning("No files were processed in Phase 1. Skipping Phase 2.")
        
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        raise
    finally:
        # Cleanup
        if 'processor' in locals():
            processor.cleanup()


if __name__ == "__main__":
    main()

```


