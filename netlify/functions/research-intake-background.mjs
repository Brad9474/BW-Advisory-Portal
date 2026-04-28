// research-intake.mjs — Netlify Background Function
// Generates a pre-call research brief for an intake using Claude + web search.
// Returns 202 immediately; runs up to 15 minutes in background.

import { getStore }   from '@netlify/blobs';
import Anthropic       from '@anthropic-ai/sdk';

export const config = { background: true };

const BRAD_EMAIL = 'brad@bwadvisorysolutions.com.au';

export default async (req) => {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const key      = req.headers.get('x-portal-api-key');
  const expected = process.env.BRAD_API_KEY;
  if (!expected || !key || key !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { intakeId } = body;
  if (!intakeId) {
    return new Response(JSON.stringify({ error: 'Missing intakeId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const store = getStore({ name: 'portal-state', consistency: 'strong' });

  // ── Load intake ─────────────────────────────────────────────────────────────
  const intakes = await loadArray(store, 'intakes');
  const intake  = intakes.find(i => i.id === intakeId);
  if (!intake) {
    return new Response(JSON.stringify({ error: 'Intake not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Mark generating + kick off work ────────────────────────────────────────
  await store.setJSON(`research_${intakeId}`, {
    status:    'generating',
    startedAt: new Date().toISOString(),
  }).catch(() => {});

  try {
    await generateBrief(store, intake, intakeId);
  } catch (e) {
    console.error('generateBrief fatal error:', e.message);
    await store.setJSON(`research_${intakeId}`, {
      status:      'error',
      error:       e.message,
      generatedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, status: 'generating' }), {
    status: 202,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
};

// ─── Core research pipeline ───────────────────────────────────────────────────

async function generateBrief(store, intake, intakeId) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const anthropic = new Anthropic({ apiKey });

  const systemPrompt = `You are a senior pre-call intelligence analyst working exclusively for BW Advisory Solutions, a Perth-based strategic advisory practice led by Brad Warburton (Principal).

BW Advisory's four service lines:
1. Systems & Process Optimisation — mapping where workflows break down and redesigning them
2. Technology Integration & Capability Deployment — selecting and embedding technology that actually gets used
3. Organisational Design & Change Management — restructuring teams and embedding change until it sticks
4. Strategic Advisory & Programme Leadership — providing clear strategic direction and leading complex programmes

Your job is to research the prospect organisation and its key contact before a discovery call with Brad. Produce a concise, accurate intelligence brief — no speculation, no padding. Every point earns its place. If you cannot find reliable information on a topic, say so clearly rather than guessing.

You must return a single valid JSON object — no prose, no markdown, no code fences — exactly matching this schema:
{
  "org_overview":      "string — what the organisation does, size, sector, structure",
  "contact_intel":     "string — role, background, likely priorities",
  "recent_dev":        "string — news, announcements, changes in the past 12 months",
  "strategic_context": "string — where they appear to be heading strategically",
  "bw_alignment":      "string — how BW Advisory's service lines map to their situation",
  "opening_questions": ["string", "string", "string"],
  "flags_gaps":        "string — anything unusual, missing, or worth probing before the call"
}

Opening questions must be sharp and specific — grounded in what you found. Not generic discovery questions.`;

  const userPrompt = buildUserPrompt(intake);

  // ── Agentic loop ─────────────────────────────────────────────────────────────
  const messages = [{ role: 'user', content: userPrompt }];
  let   finalText = null;
  const MAX_ITER  = 15;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const response = await anthropic.beta.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
      betas: ['web-search-2025-03-05'],
    });

    // Collect assistant content
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Extract final text block
      finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      break;
    }

    if (response.stop_reason === 'tool_use') {
      // web_search_20250305 is a server-side tool — Anthropic executes the search
      // and puts tool_result blocks directly into response.content. Do NOT add
      // client-side tool_result messages; doing so duplicates/corrupts the results.
      // Just push the assistant turn and call again so Claude can process the output.
      continue;
    }

    // Any other stop reason — treat as done
    finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    break;
  }

  if (!finalText) throw new Error('No text output from Claude after agentic loop');

  // ── Parse JSON ───────────────────────────────────────────────────────────────
  let brief;
  try {
    const firstBrace = finalText.indexOf('{');
    const lastBrace  = finalText.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) throw new Error("No JSON object found in output");
    const jsonStr = finalText.substring(firstBrace, lastBrace + 1);
    brief = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse brief JSON: ${e.message}. Raw output: ${finalText.slice(0, 300)}`);
  }

  // ── Store result ──────────────────────────────────────────────────────────────
  await store.setJSON(`research_${intakeId}`, {
    status:      'complete',
    brief,
    generatedAt: new Date().toISOString(),
    intakeId,
  });

  // ── Update intake status → 'researched' ──────────────────────────────────────
  try {
    const intakes = await loadArray(store, 'intakes');
    const idx     = intakes.findIndex(i => i.id === intakeId);
    if (idx !== -1) {
      intakes[idx].status    = 'researched';
      intakes[idx].updatedAt = new Date().toISOString();
      await store.setJSON('intakes', intakes);
    }
  } catch (e) {
    console.error('Failed to update intake status to researched:', e.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUserPrompt(intake) {
  const lines = [
    `Research the following prospect ahead of a discovery call with Brad Warburton (BW Advisory Solutions).`,
    ``,
    `Organisation: ${intake.company}`,
    `Contact: ${intake.contact_name} (${intake.contact_email})`,
  ];
  if (intake.url)      lines.push(`Website: ${intake.url}`);
  if (intake.industry) lines.push(`Industry: ${intake.industry}`);
  lines.push(``, `What they told us:`, intake.reason);
  lines.push(``, `Use web search to find current, accurate information. Return only the JSON object.`);
  return lines.join('\n');
}

async function loadArray(store, key) {
  try {
    const data = await store.get(key, { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
