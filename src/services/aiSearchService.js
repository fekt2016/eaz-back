const axios = require('axios');
const logger = require('../utils/logger');

/**
 * AI-Powered Search Service
 * Uses OpenAI API to enhance search with:
 * - Intelligent keyword expansion
 * - Query intent classification
 * - Natural language understanding
 * - Semantic search suggestions
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const AI_ENABLED = process.env.AI_SEARCH_ENABLED === 'true' && !!OPENAI_API_KEY;

// Log AI status on module load
if (AI_ENABLED) {
  logger.info('✅ [AI Search] AI-Powered Search is ENABLED');
  logger.info(`   OpenAI API Key: ${OPENAI_API_KEY ? OPENAI_API_KEY.substring(0, 7) + '...' : 'NOT SET'}`);
} else {
  logger.info('⚠️  [AI Search] AI-Powered Search is DISABLED');
  if (!process.env.OPENAI_API_KEY) {
    logger.info('   Reason: OPENAI_API_KEY not set');
  } else if (process.env.AI_SEARCH_ENABLED !== 'true') {
    logger.info('   Reason: AI_SEARCH_ENABLED is not "true"');
  }
  logger.info('   System will use rule-based search fallback');
}

/**
 * Expand search keywords using AI
 * Generates related search terms, synonyms, and variations
 * @param {string} query - Original search query
 * @returns {Promise<string[]>} - Array of expanded search terms
 */
async function expandKeywordsWithAI(query) {
  if (!AI_ENABLED || !query || query.length < 2) {
    return [query]; // Return original if AI disabled or invalid query
  }

  logger.info(`[AI Search] 🤖 Expanding keywords for: "${query}"`);
  try {
    const prompt = `You are a search assistant for an e-commerce platform. Given a search query, generate 5-8 related search terms, synonyms, and variations that users might use to find similar products. Focus on product-related terms.

Query: "${query}"

Return ONLY a JSON array of search terms (no explanations, no markdown, just the array). Example: ["phone case", "phone cover", "mobile case", "smartphone protector", "phone screen protector"]

Search terms:`;

    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful e-commerce search assistant. Always return valid JSON arrays.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000, // 5 second timeout
      }
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) {
      return [query];
    }

    // Parse JSON array from response
    let expandedTerms = [];
    try {
      // Remove markdown code blocks if present
      const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      expandedTerms = JSON.parse(cleanedContent);
      
      // Ensure it's an array
      if (!Array.isArray(expandedTerms)) {
        expandedTerms = [query];
      }
      
      // Add original query if not present
      if (!expandedTerms.includes(query.toLowerCase())) {
        expandedTerms.unshift(query);
      }
      
      // Limit to 8 terms max
      const result = expandedTerms.slice(0, 8);
      logger.info(`[AI Search] ✅ Expanded "${query}" to:`, result);
      return result;
    } catch (parseError) {
      logger.error('[AI Search] Failed to parse AI response:', parseError.message);
      return [query];
    }
  } catch (error) {
    // Graceful fallback - return original query
    logger.error('[AI Search] Error expanding keywords:', error.message);
    return [query];
  }
}

/**
 * Classify search query intent
 * Determines what the user is looking for (product, category, brand, etc.)
 * @param {string} query - Search query
 * @returns {Promise<Object>} - Intent classification with confidence
 */
async function classifyQueryIntent(query) {
  if (!AI_ENABLED || !query || query.length < 2) {
    return {
      intent: 'product',
      confidence: 0.5,
      category: null,
      brand: null,
    };
  }

  logger.info(`[AI Search] 🎯 Classifying intent for: "${query}"`);
  try {
    const prompt = `Analyze this e-commerce search query and classify the user's intent. Return a JSON object with:
- "intent": one of ["product", "category", "brand", "question", "comparison"]
- "confidence": number between 0 and 1
- "category": suggested category name if applicable (or null)
- "brand": suggested brand name if applicable (or null)

Query: "${query}"

Return ONLY valid JSON (no markdown, no explanations). Example: {"intent": "product", "confidence": 0.9, "category": "Electronics", "brand": null}`;

    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a search intent classifier. Always return valid JSON objects.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 100,
        temperature: 0.3,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) {
      return {
        intent: 'product',
        confidence: 0.5,
        category: null,
        brand: null,
      };
    }

    try {
      const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const intent = JSON.parse(cleanedContent);
      
      // Validate structure
      if (!intent.intent || !intent.confidence) {
        return {
          intent: 'product',
          confidence: 0.5,
          category: intent.category || null,
          brand: intent.brand || null,
        };
      }
      
      logger.info(`[AI Search] ✅ Intent classified:`, intent);
      return intent;
    } catch (parseError) {
      logger.error('[AI Search] ❌ Failed to parse intent:', parseError.message);
      return {
        intent: 'product',
        confidence: 0.5,
        category: null,
        brand: null,
      };
    }
  } catch (error) {
    logger.error('[AI Search] ❌ Error classifying intent:', error.message);
    return {
      intent: 'product',
      confidence: 0.5,
      category: null,
      brand: null,
    };
  }
}

/**
 * Generate intelligent search suggestions using AI
 * Creates contextual suggestions based on user query
 * @param {string} query - Search query
 * @param {number} limit - Maximum number of suggestions
 * @returns {Promise<string[]>} - Array of AI-generated suggestions
 */
async function generateSearchSuggestions(query, limit = 5) {
  if (!AI_ENABLED || !query || query.length < 2) {
    return [];
  }

  logger.info(`[AI Search] 💡 Generating suggestions for: "${query}"`);
  try {
    const prompt = `Generate ${limit} intelligent search suggestions for an e-commerce platform based on this query. Include:
1. The exact query (if relevant)
2. Related product searches
3. Popular variations
4. Common misspellings or alternatives

Query: "${query}"

Return ONLY a JSON array of ${limit} search suggestions (no explanations, no markdown). Example: ["phone case", "phone cover", "mobile phone case", "smartphone protector", "phone screen protector"]`;

    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a search suggestion generator. Always return valid JSON arrays.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 100,
        temperature: 0.8,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) {
      return [];
    }

    try {
      const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const suggestions = JSON.parse(cleanedContent);
      
      if (!Array.isArray(suggestions)) {
        return [];
      }
      
      const result = suggestions.slice(0, limit);
      logger.info(`[AI Search] ✅ Generated ${result.length} suggestions:`, result);
      return result;
    } catch (parseError) {
      logger.error('[AI Search] ❌ Failed to parse suggestions:', parseError.message);
      return [];
    }
  } catch (error) {
    logger.error('[AI Search] ❌ Error generating suggestions:', error.message);
    return [];
  }
}

/**
 * Enhance search query with natural language understanding
 * Improves query by understanding context and intent
 * @param {string} query - Original search query
 * @returns {Promise<string>} - Enhanced/optimized query
 */
async function enhanceQuery(query) {
  if (!AI_ENABLED || !query || query.length < 2) {
    return query;
  }

  logger.info(`[AI Search] ✨ Enhancing query: "${query}"`);
  try {
    const prompt = `Optimize this e-commerce search query for better product discovery. Remove unnecessary words, fix common typos, and focus on product-related keywords. Return ONLY the optimized query (no explanations, no JSON, just the query text).

Original query: "${query}"

Optimized query:`;

    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a search query optimizer. Return only the optimized query text.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 50,
        temperature: 0.3,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );

    const enhanced = response.data.choices[0]?.message?.content?.trim();
    const result = enhanced || query;
    if (result !== query) {
      logger.info(`[AI Search] ✅ Enhanced "${query}" → "${result}"`);
    } else {
      logger.info(`[AI Search] ⚠️ Query unchanged: "${query}"`);
    }
    return result;
  } catch (error) {
    logger.error('[AI Search] ❌ Error enhancing query:', error.message);
    return query; // Fallback to original
  }
}

/**
 * Check if AI search is enabled
 * @returns {boolean}
 */
function isAIEnabled() {
  return AI_ENABLED;
}

module.exports = {
  expandKeywordsWithAI,
  classifyQueryIntent,
  generateSearchSuggestions,
  enhanceQuery,
  isAIEnabled,
};

