# AI-Powered Search Setup Guide

## Overview

The EazShop search system now includes AI-powered features using OpenAI's GPT-3.5-turbo model to enhance search capabilities:

- **Intelligent Keyword Expansion**: Generates related search terms, synonyms, and variations
- **Query Intent Classification**: Understands what users are looking for (product, category, brand, etc.)
- **Natural Language Understanding**: Optimizes queries by understanding context
- **AI-Generated Suggestions**: Creates contextual search suggestions

## Features

### 1. AI Keyword Expansion
Automatically expands search queries with related terms:
- Input: "phone cover"
- AI Output: ["phone case", "mobile case", "smartphone protector", "phone screen protector", etc.]

### 2. Query Intent Classification
Classifies user intent to improve search results:
- Detects if user is searching for a product, category, brand, or asking a question
- Suggests relevant categories and brands automatically
- Confidence scoring (0-1) for intent accuracy

### 3. Query Enhancement
Optimizes search queries:
- Removes unnecessary words
- Fixes common typos
- Focuses on product-related keywords

### 4. AI Search Suggestions
Generates intelligent search suggestions based on user input

## Setup Instructions

### 1. Get OpenAI API Key

1. Sign up at [OpenAI Platform](https://platform.openai.com/)
2. Navigate to API Keys section
3. Create a new API key
4. Copy the key (starts with `sk-`)

### 2. Configure Environment Variables

Add the following to your `.env` file:

```env
# AI Search Configuration
OPENAI_API_KEY=sk-your-api-key-here
AI_SEARCH_ENABLED=true
```

**Note**: If `AI_SEARCH_ENABLED` is `false` or `OPENAI_API_KEY` is not set, the system will gracefully fall back to rule-based search (no AI features).

### 3. Enable/Disable AI Search

The AI search features are **optional** and have graceful fallbacks:

- **AI Enabled**: Full AI-powered search with all features
- **AI Disabled**: Traditional rule-based search (existing functionality)

To disable AI search:
```env
AI_SEARCH_ENABLED=false
```

Or simply don't set `OPENAI_API_KEY`.

## How It Works

### Graceful Fallback

The system is designed to work with or without AI:

1. **With AI**: Uses OpenAI GPT-3.5-turbo for intelligent search enhancement
2. **Without AI**: Falls back to rule-based keyword expansion and traditional search

### Performance

- AI calls have a 5-second timeout
- Failed AI calls don't break search - system falls back automatically
- AI is used asynchronously and doesn't block search results

### Cost Considerations

OpenAI API usage:
- Model: `gpt-3.5-turbo` (cost-effective)
- Max tokens: 50-150 per request
- Estimated cost: ~$0.001-0.002 per search query

**Tip**: Monitor your OpenAI usage dashboard to track costs.

## API Endpoints

All existing search endpoints automatically use AI if enabled:

- `GET /api/v1/search/suggestions/:query` - AI-enhanced suggestions
- `GET /api/v1/search/query/:query` - AI-enhanced typeahead
- `GET /api/v1/search/results` - AI-enhanced search results

## Testing

### Test AI Features

1. Enable AI in `.env`:
   ```env
   OPENAI_API_KEY=sk-your-key
   AI_SEARCH_ENABLED=true
   ```

2. Restart your backend server

3. Try searching for:
   - "phone cover" (should expand to related terms)
   - "I need a laptop bag" (should understand intent)
   - "best running shoes" (should optimize query)

### Test Fallback

1. Disable AI:
   ```env
   AI_SEARCH_ENABLED=false
   ```

2. Search should still work with rule-based expansion

## Troubleshooting

### AI Not Working

1. **Check API Key**: Ensure `OPENAI_API_KEY` is set correctly
2. **Check Enable Flag**: Ensure `AI_SEARCH_ENABLED=true`
3. **Check Logs**: Look for `[AI Search]` messages in console
4. **Check OpenAI Account**: Ensure your OpenAI account has credits

### High Costs

- AI is only used for search queries (not every request)
- Consider rate limiting AI calls if needed
- Monitor OpenAI dashboard for usage

### Slow Search

- AI calls have 5-second timeout
- System falls back if AI is slow
- Consider caching AI results for common queries

## Future Enhancements

Potential improvements:
- Vector embeddings for semantic search
- User-specific search personalization
- Search result ranking with AI
- Multi-language support
- Search analytics with AI insights

## Support

For issues or questions:
1. Check backend logs for `[AI Search]` messages
2. Verify OpenAI API key is valid
3. Ensure network connectivity to OpenAI API
4. Check OpenAI account status and credits

