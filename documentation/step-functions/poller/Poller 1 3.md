Here is the **DynamoDB Global Secondary Index (GSI) Strategy** designed specifically to optimize the Reconciliation Pooler's query patterns.

### 1. The Access Pattern Challenge

We need to efficiently find calls where:

1. **Status is Bad:** `AudioReceived = false` **OR** `ProcessingStatus = 'FAILED' / 'PENDING'`.
    
2. **Time is Recent:** The call happened within the last $X$ days (Lookback Period).
    
3. **Cross-Tenant:** The pooler might need to scan _all_ tenants or specific ones.
    

**Anti-Pattern to Avoid:** Scanning the entire table filtering by `ProcessingStatus`. As the table grows to millions of records, this will become slow and expensive.

---

### 2. GSI Design Recommendation: "Sparse Index Status Pattern"

We will use a **Sparse Index**. This means only items that _require reconciliation_ will appear in this index. Completed calls will not be written to this GSI, keeping it small, fast, and cost-effective.

#### GSI Definition

|**Attribute**|**Role**|**Name Recommendation**|**Value Example**|
|---|---|---|---|
|**Partition Key (PK)**|Grouping|`GSI_Recon_PK`|`STATUS#PENDING`|
|**Sort Key (SK)**|Sorting|`GSI_Recon_SK`|`2023-10-27T08:00:00Z#TENANT-123`|
|**Projection**|Data Visibility|`INCLUDE`|`CallId`, `AudioReceived`, `ProcessingStatus`|

### 3. Implementation Logic

#### A. Constructing the Keys (The "Write" Side)

When writing a record to the main table, your application must calculate the values for these GSI attributes based on the call's state.

**Logic:**

- **IF** (`AudioReceived` == `false` **OR** `ProcessingStatus` != `SUCCESS`):
    
    - Set `GSI_Recon_PK` = `"STATUS#PENDING"` (or a specific status like `"STATUS#FAILED"`).
        
    - Set `GSI_Recon_SK` = `"{CallDateTime}#{TenantId}"`.
        
- **ELSE** (Everything is OK):
    
    - **Do not set** `GSI_Recon_PK` and `GSI_Recon_SK` (leave them `null` or remove them).
        

_Result:_ DynamoDB automatically _excludes_ items with null GSI keys from the index. Your index now contains **only** the 1% of calls that failed, not the 99% that succeeded.

#### B. Querying the Index (The "Read" Side)

The Pooler performs a Query (not a Scan) on this GSI.

- **Query Condition:**
    
    - `KeyConditionExpression`: `GSI_Recon_PK = :status AND GSI_Recon_SK > :lookbackDate`
        
    - `:status` = `"STATUS#PENDING"`
        
    - `:lookbackDate` = `"2023-10-20T00:00:00Z"` (Calculated as Now - 7 days)
        

### 4. Strategy Variations (Sharding)

If you have extremely high volume (e.g., millions of _failed_ calls per day), a single Partition Key (`STATUS#PENDING`) might cause a "Hot Partition".

Optimization: Write Sharding

If scale is a concern, append a random number (0-N) to the PK.

- **PK:** `STATUS#PENDING#0`, `STATUS#PENDING#1`, ... `STATUS#PENDING#9`.
    
- **Pooler Logic:** The Pooler must run parallel queries for each shard (0-9) to get all pending items.
    

### 5. Why this is optimal?

1. **Cost:** You only pay for storage/write capacity for the problematic calls.
    
2. **Speed:** The query is instant because the index is pre-sorted by date.
    
3. **Pagination:** Since the SK starts with the Date, you inherently get the oldest failures first (FIFO) or newest first, depending on `ScanIndexForward`.
    

### 6. Summary for Terraform/CloudFormation

Terraform

```
attribute {
  name = "GSI_Recon_PK"
  type = "S"
}

attribute {
  name = "GSI_Recon_SK"
  type = "S"
}

global_secondary_index {
  name               = "ReconciliationIndex"
  hash_key           = "GSI_Recon_PK"
  range_key          = "GSI_Recon_SK"
  write_capacity     = 5  # Adjust based on failure rate
  read_capacity      = 5
  projection_type    = "INCLUDE"
  non_key_attributes = ["TenantId", "CallId", "AudioReceived"]
}
```

Would you like to move on to the **Pseudocode for the Lambda Function** that ties the GSI Query and the Payload generation together?