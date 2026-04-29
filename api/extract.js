// api/extract.js
// Vercel Edge Function — proxies Anthropic API calls
// Front-end builds Anthropic-format messages (with PDFs/images as base64 documents
// or images) and sends them directly. This function just adds the API key and forwards.

export const config = {
  runtime: 'edge',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }

  // Parse the body the front-end is sending
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonError(400, 'Invalid JSON: ' + e.message);
  }

  if (!body || !Array.isArray(body.messages)) {
    return jsonError(400, 'Missing messages array');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonError(500, 'ANTHROPIC_API_KEY not configured on server');
  }

  // Forward to Anthropic
  // Use the model the front-end requested, with sensible defaults
  const anthropicBody = {
    model: body.model || 'claude-sonnet-4-20250514',
    max_tokens: body.max_tokens || 4000,
    messages: body.messages,
  };

  let anthropicResp;
  try {
    anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (e) {
    return jsonError(502, 'Failed to reach Anthropic API: ' + e.message);
  }

  // Pass Anthropic's response through directly — including errors
  // The front-end already knows how to handle Anthropic's response shape
  const responseText = await anthropicResp.text();

  return new Response(responseText, {
    status: anthropicResp.status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
