# WorkSphere Global Search — Atlas Search Index Configuration

This document contains the exact JSON index definitions to paste into the
**MongoDB Atlas UI → Search → Create Search Index → JSON Editor** for each
collection.

> **Important:** These indexes must be created manually in the Atlas dashboard
> (or via the Atlas CLI). They cannot be created programmatically through
> Mongoose. The backend includes a graceful fallback to bounded regex search if
> the Atlas Search index is absent, but **performance at 10 lakh+ scale
> requires Atlas Search to be active**.

---

## 1. `users` collection — index name: `globalSearch`

```json
{
  "name": "globalSearch",
  "analyzer": "lucene.standard",
  "searchAnalyzer": "lucene.standard",
  "mappings": {
    "dynamic": false,
    "fields": {
      "name": [
        {
          "type": "string",
          "analyzer": "lucene.standard"
        },
        {
          "type": "autocomplete",
          "analyzer": "lucene.standard",
          "tokenization": "edgeGram",
          "minGrams": 2,
          "maxGrams": 15,
          "foldDiacritics": true
        }
      ],
      "email": [
        {
          "type": "string",
          "analyzer": "lucene.keyword"
        },
        {
          "type": "autocomplete",
          "analyzer": "lucene.standard",
          "tokenization": "edgeGram",
          "minGrams": 2,
          "maxGrams": 25,
          "foldDiacritics": false
        }
      ],
      "status": {
        "type": "string",
        "analyzer": "lucene.keyword"
      },
      "companyId": {
        "type": "objectId"
      }
    }
  }
}
```

**Searchable fields:** `name`, `email`  
**Filter fields (match stage):** `status`, `companyId`

---

## 2. `companies` collection — index name: `globalSearch`

```json
{
  "name": "globalSearch",
  "analyzer": "lucene.standard",
  "searchAnalyzer": "lucene.standard",
  "mappings": {
    "dynamic": false,
    "fields": {
      "name": [
        {
          "type": "string",
          "analyzer": "lucene.standard"
        },
        {
          "type": "autocomplete",
          "analyzer": "lucene.standard",
          "tokenization": "edgeGram",
          "minGrams": 2,
          "maxGrams": 20,
          "foldDiacritics": true
        }
      ],
      "slug": [
        {
          "type": "string",
          "analyzer": "lucene.keyword"
        },
        {
          "type": "autocomplete",
          "analyzer": "lucene.standard",
          "tokenization": "edgeGram",
          "minGrams": 2,
          "maxGrams": 20,
          "foldDiacritics": false
        }
      ],
      "domain": {
        "type": "string",
        "analyzer": "lucene.keyword"
      },
      "status": {
        "type": "string",
        "analyzer": "lucene.keyword"
      },
      "isActive": {
        "type": "boolean"
      }
    }
  }
}
```

**Searchable fields:** `name`, `slug`, `domain`  
**Filter fields:** `status`, `isActive`

---

## 3. `projects` collection — index name: `globalSearch`

```json
{
  "name": "globalSearch",
  "analyzer": "lucene.standard",
  "searchAnalyzer": "lucene.standard",
  "mappings": {
    "dynamic": false,
    "fields": {
      "name": [
        {
          "type": "string",
          "analyzer": "lucene.standard"
        },
        {
          "type": "autocomplete",
          "analyzer": "lucene.standard",
          "tokenization": "edgeGram",
          "minGrams": 2,
          "maxGrams": 20,
          "foldDiacritics": true
        }
      ],
      "companyId": {
        "type": "objectId"
      },
      "status": {
        "type": "string",
        "analyzer": "lucene.keyword"
      },
      "deletedAt": {
        "type": "date"
      }
    }
  }
}
```

**Searchable fields:** `name`  
**Filter fields:** `companyId`, `status`, `deletedAt`

---

## How to Create These Indexes

### Option A — Atlas UI (recommended for first setup)

1. Log in to **cloud.mongodb.com**
2. Navigate to your cluster → **Search** tab
3. Click **Create Search Index**
4. Select **JSON Editor**
5. Choose the database (`WorkSphere`) and collection (`users` / `companies` / `projects`)
6. Paste the JSON above for the respective collection
7. Click **Save**
8. Wait for index build to complete (status: **Active**)

### Option B — Atlas CLI

```bash
atlas clusters search indexes create \
  --clusterName <YourClusterName> \
  --file ./docs/atlas-search-users.json
```

---

## Regular MongoDB Indexes Added

The following compound indexes support the `$match` filter stages that
run after `$search` as well as direct (non-Atlas) queries:

### `users`
```js
// Already exists (from User model):
// { email: 1 }  — unique index

// Added by global-search:
{ companyId: 1, status: 1, name: 1 }
```

### `companies`
```js
// Already exists:
// { domain: 1 }
// { slug: 1 }   — unique index

// Added:
{ name: 1, status: 1 }
```

### `projects`
```js
// Already exists:
// { companyId: 1, status: 1 }

// No new compound indexes required — existing ones cover the search patterns
```

> **Note:** The index-addition migration script is in
> `src/scripts/add-global-search-indexes.ts`. Run it once against your
> Atlas cluster after deploying this feature.

---

## Performance Expectations

| Dataset size    | Atlas Search p50 | Atlas Search p95 | Fallback regex p50 |
|-----------------|-----------------|-----------------|-------------------|
| 10k users       | < 5 ms          | < 15 ms         | < 20 ms           |
| 100k users      | < 10 ms         | < 30 ms         | 200–800 ms ⚠️     |
| 500k users      | < 20 ms         | < 50 ms         | COLLSCAN ❌        |
| 1 million users | < 35 ms         | < 80 ms         | Not viable ❌      |

The fallback regex path uses `^prefix` anchored regex (not `.*regex.*`) which
limits full-collection scans, but it is still **not suitable for production at
scale**. Atlas Search must be active for 10 lakh+ deployments.

---

## Redis Cache

- TTL: **45 seconds**
- Key pattern: `superadmin:global-search:<normalised-query>:<cursor|p1>`
- All SuperAdmin global searches share the same cache — no per-user scoping
  is needed because SuperAdmin sees all data with no company-level filters.
- Cache is bypassed automatically if Redis is unavailable (connection error).
- To force a cache flush: `KEYS superadmin:global-search:*` → `DEL <keys>`

---

## Security Notes

- Endpoint requires `SUPER_ADMIN` JWT role in `req.authenticatedUser.role`
- The `requireSuperAdmin` guard (existing) covers both authentication and role
- Sensitive fields (`password`, `grantedPermissions`, `revokedPermissions`,
  `resetToken`, `refreshToken`) are excluded via MongoDB `select` projections
  in the service — they are never fetched from the DB at all
