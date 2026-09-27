# MongoDB Atlas Vector Search Setup Guide

To enable semantic search for Decision Logger, you need to create a **Vector Search Index** in MongoDB Atlas.

## Prerequisites

- MongoDB Atlas cluster (M10+ recommended for production)
- Decisions collection in your database

## Setup Steps

### Option 1: MongoDB Atlas UI (Recommended)

1. **Go to MongoDB Atlas** → https://cloud.mongodb.com
2. **Navigate to your cluster** → Click "Browse Collections"
3. **Select Database Search** tab (next to "Collections")
4. **Click "Create Search Index"**
5. **Select "Atlas Vector Search"**
6. **Configure the index:**

   ```json
   {
     "fields": [
       {
         "type": "vector",
         "path": "embedding",
         "numDimensions": 1536,
         "similarity": "cosine"
       },
       {
         "type": "filter",
         "path": "workspace_id"
       },
       {
         "type": "filter",
         "path": "type"
       },
       {
         "type": "filter",
         "path": "timestamp"
       }
     ]
   }
   ```

7. **Set the following values:**
   - **Database Name**: `decision-logger`
   - **Collection Name**: `decisions`
   - **Index Name**: `vector_search_index`

8. **Click "Create Search Index"**

The index will take a few minutes to build. You'll see a status indicator.

### Option 2: MongoDB Atlas CLI

If you have the Atlas CLI installed:

```bash
atlas clusters search indexes create \
  --clusterName YOUR_CLUSTER_NAME \
  --file vector-search-index.json
```

Where `vector-search-index.json` contains:

```json
{
  "name": "vector_search_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 1536,
        "similarity": "cosine"
      },
      {
        "type": "filter",
        "path": "workspace_id"
      },
      {
        "type": "filter",
        "path": "type"
      },
      {
        "type": "filter",
        "path": "timestamp"
      }
    ]
  }
}
```

## Verification

After creating the index, verify it's active:

1. Go to Atlas → Database Search tab
2. You should see `vector_search_index` with status "Active"
3. The index should show the decisions collection

## Testing

Once the index is created, test semantic search:

```bash
# In your application, run:
node scripts/test-vector-search.js
```

This will:
1. Generate test embeddings
2. Perform a sample vector search query
3. Display results with relevance scores

## Index Configuration Explained

- **vector field (`embedding`)**: 1536-dimensional vectors from OpenAI's text-embedding-3-small model
- **similarity: cosine**: Measures semantic similarity between query and decisions
- **filter fields**: Allow pre-filtering by workspace, type, or date before vector search
  - `workspace_id`: Essential for multi-tenancy
  - `type`: Filter by decision type (product/ux/technical)
  - `timestamp`: Filter by date ranges

## Troubleshooting

### "Index not found" error

**Cause**: Vector search index not created or not yet active.

**Fix**: Create the index in Atlas UI (see Option 1 above).

### "Embedding field missing" error

**Cause**: Existing decisions don't have embeddings yet.

**Fix**: Run the migration script:

```bash
node scripts/migrate-embeddings.js
```

This will generate embeddings for all existing decisions.

### Performance Issues

**Recommendations**:
- Use M10+ Atlas cluster for production (M0/M2/M5 have limitations)
- Monitor index build time (larger datasets take longer)
- Consider batch embedding generation for large datasets (1000+ decisions)

## Next Steps

After setting up the vector search index:

1. ✅ Add `OPENAI_API_KEY` to your environment variables
2. ✅ Run migration script to embed existing decisions
3. ✅ Test semantic search in the dashboard
4. ✅ Enjoy the Wow factor! 🚀
