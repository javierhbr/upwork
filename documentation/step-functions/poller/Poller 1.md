
Here is the **English translation**, keeping a **technical, clear, and documentation-ready tone**:

---

## **Reconciliation Pooler Logic**

  

### **Overview**

  

Below is the reconciliation pooler logic rewritten in a clear, structured format and ready for technical documentation.

---

## **Objective**

  

The reconciliation pooler aims to identify calls whose voice recording files have not yet been received or successfully processed, group them into manageable time windows, and trigger their reprocessing through the OCP export service.

---

## **Data Source**

- **Database:** DynamoDB
    
- **Contents:**
    
    - Status flags for each call
        
    - Indicators showing whether the audio file was:
        
        - Received
            
        - Successfully processed
            
        
    

---

## **Step 1: Query Pending Calls**

  

The pooler executes a query against DynamoDB to retrieve:

- Calls that do not have the recording file received or processed
    
- Applying:
    
    - A maximum number of calls per execution
        
    - A configurable time range (optional)
        
    

  

The result is a list of calls pending reconciliation.

---

## **Step 2: Result Ordering**

  

The retrieved calls are sorted by:

1. **Group** (for example: account, tenant, customer, or another logical identifier)
    
2. **Call date**
    

  

This ordering is required because the OCP export service expects the following input parameters:

- fromDate
    
- toDate
    

---

## **Step 3: Time Window Grouping**

  

Since OCP processes calls based on date ranges, calls are grouped into small time windows.

  

Examples of configurable windows:

- 1 minute
    
- 5 minutes
    
- 10 minutes
    

  

The window duration is dynamically defined based on:

- The total number of resulting calls
    
- System configuration
    
- Operational limits of the export service
    

  

The output of this step is a collection of groups, where each group contains:

- A fromDate
    
- A toDate
    
- The list of calls belonging to that window
    

---

## **Step 4: Reconciliation Payload Construction**

  

For each group of calls:

- A payload is constructed that includes:
    
    - Time window (fromDate, toDate)
        
    - Identifiers of the calls to be reconciled
        
    - Required metadata for processing
        
    

---

## **Step 5: Reconciliation Process Execution**

  

The payload is sent to the reconciliation process, which:

1. Consumes the time window
    
2. Executes the OCP export
    
3. Retrieves the voice recording files
    
4. Processes the received audio files
    
5. Updates the corresponding flags in DynamoDB
    

---

## **Key Considerations**

- The pooler can run:
    
    - Periodically (cron / scheduler)
        
    - On demand
        
    
- All parameters are configurable:
    
    - Window size
        
    - Maximum number of calls
        
    - Time range
        
    
- The design allows the system to scale while avoiding overload of the OCP service
    

---

## **Optional Next Steps**

  

If needed, I can:

- Convert this into a flow diagram
    
- Adapt it into ADR / RFC-style documentation
    
- Write pseudocode or a Lambda implementation
    
- Adapt it to a fully serverless AWS architecture
    

---

If you want, I can also **polish this for an external-facing design doc or internal architecture review**.