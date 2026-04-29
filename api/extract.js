// api/extract.js
// Vercel Edge Function for AI lease extraction
// Edge Functions: no 4.5MB body size limit, faster cold starts, streaming-friendly

export const config = {
  runtime: 'edge',
};

// CORS headers — needed because the browser fetches this from the same origin
// but we keep them anyway for robustness
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── Field schema we want extracted ────────────────────────────────────────
// Matches the SEED_DATA structure in App.jsx so extracted leases slot in cleanly
const EXTRACTION_PROMPT = `You are a commercial real estate lease abstraction expert. You will be given the text of a lease document. Extract structured data from it and return ONLY a single valid JSON object — no markdown, no commentary, no code fences.

The JSON object must have exactly these keys (use null when a value is not stated in the document):

{
  "tenantName": "string - full legal name of tenant",
  "tenantTrade": "string or null - trading name if different from legal name",
  "tenantParent": "string or null - parent company / guarantor",
  "tenantIndustry": "string or null - e.g. 3PL, E-commerce, Retail Distribution",
  "companyNum": "string or null - company registration number",

  "address": "string - full property address",
  "city": "string",
  "country": "string",
  "useType": "string - Warehouse / Logistics / Distribution / Light Industrial / etc",
  "areaSqm": "number - total lettable area in square metres, null if only sqft given",
  "warehouseSqm": "number or null",
  "officeSqm": "number or null",
  "mezzanineSqm": "number or null",

  "currency": "string - e.g. GBP, EUR, USD",
  "passingPA": "number - current annual rent",
  "contractedPA": "number or null - contracted rent if different from passing",

  "leaseStart": "string in YYYY-MM-DD format",
  "leaseExpiry": "string in YYYY-MM-DD format, or null if open-ended",
  "openEnded": "0 or 1",

  "break1Date": "string YYYY-MM-DD or null - first break option date",
  "break1Notice": "number or null - notice period in MONTHS",
  "break1Holder": "string or null - Tenant / Landlord / Mutual",
  "break1Penalty": "number or null - break penalty amount",
  "break2Date": "string YYYY-MM-DD or null",
  "break2Notice": "number or null",

  "reviewType": "string or null - OMV / RPI / CPI / Indexation",
  "reviewFreq": "number or null - review frequency in MONTHS (60 for 5-yearly)",
  "lastReview": "string YYYY-MM-DD or null",
  "nextReview": "string YYYY-MM-DD or null",
  "upwardsOnly": "0 or 1",

  "hasIndex": "0 or 1",
  "indexName": "string or null - HICP / RPI / CPI / NL CPI / ISTAT / ILC / Fixed",
  "lastIndexDate": "string YYYY-MM-DD or null",
  "lastIndexRate": "number or null - percent",
  "nextIndexDate": "string YYYY-MM-DD or null",
  "indexCap": "number or null - cap percent",
  "indexFloor": "number or null - floor percent",

  "rentFreeMonths": "number or null",
  "capContrib": "number or null - capital contribution from landlord",
  "rentDeposit": "number or null",
  "bankGuarantee": "number or null",
  "parentGuarantee": "0 or 1",

  "_sourceClauses": {
    "rent": "verbatim text of the rent clause - up to 300 chars",
    "term": "verbatim text of the term/expiry clause",
    "break": "verbatim text of any break clause, or null",
    "review": "verbatim text of any review clause, or null",
    "indexation": "verbatim text of any indexation clause, or null"
  },

  "_confidence": {
    "rent": "high / medium / low",
    "term": "high / medium / low",
    "break": "high / medium / low / not_present",
    "review": "high / medium / low / not_present",
    "indexation": "high / medium / low / not_present"
  }
}

Rules:
- Convert all areas to square metres (1 sqft = 0.0929 sqm).
- Convert all rents to annual amounts in the contract currency.
- Dates strictly in YYYY-MM-DD format.
- Numbers as plain numbers, no thousands separators, no currency symbols.
- If a value is genuinely not in the document, use null. Do not guess.
- Return ONLY the JSON object. No markdown fences. No commentary.`;

export default async function handler(req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed. Use POST.');
  }

  // Parse request body
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonError(400, 'Invalid JSON in request body');
  }

  const { documentText, fileName } = body || {};

  if (!documentText || typeof documentText !== 'string') {
    return jsonError(400, 'Missing or invalid "documentText" field — expected string');
  }

  // Sanity check on size — Claude has very large context but very long docs cost more
  if (documentText.length > 500000) {
    return jsonError(413, 'Document too long (>500k chars). Please split.');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonError(500, 'Server misconfigured: ANTHROPIC_API_KEY not set');
  }

  // Call Anthropic API
  let anthropicResp;
  try {
    anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${EXTRACTION_PROMPT}\n\n---\n\nDocument: ${fileName || 'lease.pdf'}\n\n${documentText}`,
          },
        ],
      }),
    });
  } catch (e) {
    return jsonError(502, `Failed to reach Anthropic API: ${e.message}`);
  }

  if (!anthropicResp.ok) {
    const errText = await anthropicResp.text();
    return jsonError(anthropicResp.status, `Anthropic API error: ${errText.slice(0, 500)}`);
  }

  const result = await anthropicResp.json();
  const content = result?.content?.[0]?.text;

  if (!content) {
    return jsonError(502, 'Anthropic returned no content');
  }

  // Try to parse the JSON the model returned
  let extracted;
  try {
    // Strip any markdown fences the model might have added despite instructions
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
    extracted = JSON.parse(cleaned);
  } catch (e) {
    // Return the raw text so the front-end can show it as a debug aid
    return new Response(JSON.stringify({
      ok: false,
      error: 'Could not parse model output as JSON',
      raw: content,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    extracted,
    model: 'claude-sonnet-4-20250514',
    fileName: fileName || null,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
