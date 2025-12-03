# How to Check if AI Search is Working

## Quick Check Methods

### 1. **Check Server Console Logs** (Easiest)

When you start your backend server, you'll see:

**✅ AI Enabled:**
```
✅ [AI Search] AI-Powered Search is ENABLED
   OpenAI API Key: sk-xxxx...
```

**❌ AI Disabled:**
```
⚠️  [AI Search] AI-Powered Search is DISABLED
   Reason: OPENAI_API_KEY not set
   System will use rule-based search fallback
```

### 2. **Check During Search** (Real-time)

When you perform a search, watch the console for:

**AI Working:**
```
[AI Search] 🤖 Expanding keywords for: "phone cover"
[AI Search] ✅ Expanded "phone cover" to 8 terms: ["phone case", "mobile case", ...]
[AI Search] 🤖 Classifying intent for: "phone cover"
[AI Search] ✅ Intent classified: { intent: 'product', confidence: 0.9, ... }
[AI Search] 🤖 Enhancing query: "phone cover"
[AI Search] ✅ Enhanced "phone cover" → "phone case"
```

**AI Not Working:**
```
[AI Search] ❌ AI disabled or invalid query, using fallback
```

### 3. **Check API Response** (Programmatic)

All search endpoints now return AI status in the response:

#### Search Suggestions Endpoint
```bash
GET /api/v1/search/suggestions/phone
```

**Response with AI:**
```json
{
  "success": true,
  "data": [...],
  "aiEnabled": true,
  "aiSuggestionsCount": 3,
  "query": "phone case"
}
```

**Response without AI:**
```json
{
  "success": true,
  "data": [...],
  "aiEnabled": false,
  "aiSuggestionsCount": 0,
  "query": "phone"
}
```

#### Search Results Endpoint
```bash
GET /api/v1/search/results?q=phone+cover
```

**Response with AI:**
```json
{
  "success": true,
  "results": 10,
  "totalProducts": 50,
  "data": [...],
  "aiEnabled": true,
  "queryIntent": {
    "intent": "product",
    "confidence": 0.9,
    "category": "Electronics",
    "brand": null
  },
  "enhancedQuery": "phone case"
}
```

**Response without AI:**
```json
{
  "success": true,
  "results": 10,
  "totalProducts": 50,
  "data": [...],
  "aiEnabled": false,
  "queryIntent": null,
  "enhancedQuery": null
}
```

### 4. **Test with Browser DevTools**

1. Open browser DevTools (F12)
2. Go to Network tab
3. Perform a search
4. Click on the search request
5. Check the Response tab
6. Look for `aiEnabled: true` in the JSON response

### 5. **Test with cURL**

```bash
# Test search suggestions
curl http://localhost:4000/api/v1/search/suggestions/phone

# Check response for "aiEnabled": true
```

## Visual Indicators

### In Console Logs:
- ✅ = AI working successfully
- ❌ = AI failed/disabled, using fallback
- 🤖 = AI processing
- ⚠️ = Warning (AI disabled)

### In API Responses:
- `aiEnabled: true` = AI is active
- `aiEnabled: false` = AI is disabled
- `aiSuggestionsCount > 0` = AI generated suggestions
- `queryIntent` object = AI classified the query
- `enhancedQuery` = AI optimized the query

## Common Scenarios

### Scenario 1: AI is Working
```
Console: ✅ [AI Search] AI-Powered Search is ENABLED
Response: { "aiEnabled": true, "queryIntent": {...} }
Logs: [AI Search] 🤖 Expanding keywords...
```

### Scenario 2: AI is Disabled
```
Console: ⚠️  [AI Search] AI-Powered Search is DISABLED
Response: { "aiEnabled": false, "queryIntent": null }
Logs: [AI Search] ❌ AI disabled, using fallback
```

### Scenario 3: AI API Error
```
Console: ✅ [AI Search] AI-Powered Search is ENABLED
Response: { "aiEnabled": true, "queryIntent": null }
Logs: [AI Search] ❌ Error expanding keywords: Request timeout
```
*(System falls back to rule-based search)*

## Troubleshooting

### If `aiEnabled: false`:
1. Check `.env` file has `OPENAI_API_KEY=sk-...`
2. Check `.env` file has `AI_SEARCH_ENABLED=true`
3. Restart backend server
4. Check console for startup message

### If `aiEnabled: true` but no AI features:
1. Check OpenAI API key is valid
2. Check OpenAI account has credits
3. Check network connectivity
4. Look for error logs: `[AI Search] ❌`

### If you see errors:
- Check OpenAI API key format (should start with `sk-`)
- Check OpenAI account status
- Check network/firewall settings
- Review console logs for specific error messages

## Quick Test Script

Create a test file `test-ai-search.js`:

```javascript
const axios = require('axios');

async function testAISearch() {
  try {
    const response = await axios.get('http://localhost:4000/api/v1/search/suggestions/phone');
    console.log('AI Enabled:', response.data.aiEnabled);
    console.log('AI Suggestions:', response.data.aiSuggestionsCount);
    console.log('Query:', response.data.query);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testAISearch();
```

Run: `node test-ai-search.js`

