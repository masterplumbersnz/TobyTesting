const fetch = require('node-fetch');

const ALLOWED_ORIGIN = 'https://masterplumbers.org.nz';
const corsHeader = { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN };

exports.handler = async (event) => {

  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  // ── NZ geo-restriction ──────────────────────────────────────────────────────
  // x-country is set by Netlify's CDN on every request.
  // Note: this is bypassed if someone calls the function URL directly without
  // going through the CDN (e.g. via curl). For a public-facing bot this is
  // an acceptable limitation — it blocks all ordinary browser-based access
  // from outside NZ.
  const country = event.headers['x-country'];
  if (country && country !== 'NZ') {
    return {
      statusCode: 403,
      headers: corsHeader,
      body: JSON.stringify({ error: 'This service is only available within New Zealand.' }),
    };
  }

  try {
    const { message, previous_response_id } = JSON.parse(event.body || '{}');

    const apiKey        = process.env.OPENAI_API_KEY;
    const model         = 'gpt-4.1-mini';
    const instructions  = process.env.OPENAI_INSTRUCTIONS;
    const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

    if (!message || !apiKey) {
      return {
        statusCode: 400,
        headers: corsHeader,
        body: JSON.stringify({ error: 'Missing message or API key.' }),
      };
    }

    if (!instructions) {
      console.warn('OPENAI_INSTRUCTIONS env var is not set — bot will have no system prompt.');
    }

    if (!vectorStoreId) {
      console.warn('OPENAI_VECTOR_STORE_ID is not set — file search will be disabled.');
    }

    // ── Build request body ────────────────────────────────────────────────────
    const requestBody = {
      model,
      instructions: instructions || 'You are Toby, a helpful plumbing assistant.',
      input: message,
    };

    // Carry conversation history forward — this replaces thread_id
    if (previous_response_id) {
      requestBody.previous_response_id = previous_response_id;
    }

    // File search via vector store
    if (vectorStoreId) {
      requestBody.tools = [
        {
          type: 'file_search',
          vector_store_ids: [vectorStoreId],
        },
      ];
    }

    // ── Call the Responses API ────────────────────────────────────────────────
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI Responses API error: ${text}`);
    }

    const data = await response.json();

    // ── Extract reply ─────────────────────────────────────────────────────────
    // Structure: data.output[] → { type: "message", content: [{ type: "output_text", text }] }
    const reply = data.output
      ?.find(block => block.type === 'message')
      ?.content
      ?.find(part => part.type === 'output_text')
      ?.text || '(No reply)';

    return {
      statusCode: 200,
      headers: {
        ...corsHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reply,
        response_id: data.id, // frontend stores this to maintain conversation history
      }),
    };

  } catch (error) {
    console.error('chat error:', error);
    return {
      statusCode: 500,
      headers: corsHeader,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
