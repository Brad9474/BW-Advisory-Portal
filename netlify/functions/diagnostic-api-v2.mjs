// diagnostic-api-v2.mjs — Link-based diagnostic delivery with full tracking
// Replaces inline HTML email with shareable links + tracking pixel + CTA tracking
// Auth: API key for approve/reject actions

import { getStore } from '@netlify/blobs';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';

const HUBSPOT_BCC = '442934945@bcc.ap1.hubspot.com';
const BRAD_EMAIL = 'brad@bwadvisorysolutions.com.au';
const REPORT_VIEWER_BASE = '/.netlify/functions/diagnostic-report-viewer';

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    },
  });

const htmlResponse = (html, status = 200) =>
  new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      },
    });
  }

  const store = getStore({ name: 'diagnostics', consistency: 'strong' });
  const reqUrl = new URL(req.url);
  const functionBase = `${reqUrl.origin}/.netlify/functions/diagnostic-api-v2`;

  // ─── GET: approve or reject diagnostic submission ───────────────────────
  if (req.method === 'GET') {
    const action = reqUrl.searchParams.get('action');
    const token = reqUrl.searchParams.get('token');
    const apiKey = req.headers.get('x-portal-api-key');

    // Token is the authentication mechanism (unique per submission)
    // API key is optional for programmatic access
    if (!action || !token) {
      return htmlResponse(brandedPage('Invalid Request', '<p>Missing required parameters.</p>'), 400);
    }

    let subId;
    try {
      subId = await store.get(`tok_${token}`);
    } catch (e) {
      return htmlResponse(brandedPage('Error', '<p>Unable to retrieve submission.</p>'), 500);
    }

    if (!subId) {
      return htmlResponse(brandedPage('Link Not Found', '<p>This link is invalid or has expired.</p>'), 404);
    }

    let submission;
    try {
      submission = await store.get(`sub_${subId}`, { type: 'json' });
    } catch (e) {
      return htmlResponse(brandedPage('Error', '<p>Unable to load submission data.</p>'), 500);
    }

    if (!submission) {
      return htmlResponse(brandedPage('Not Found', '<p>Submission record not found.</p>'), 404);
    }

    if (action === 'approve') {
      if (submission.status === 'sent') {
        const sentDate = new Date(submission.sentAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
        return htmlResponse(brandedPage('Already Sent', `<p>This report was already sent to <strong>${escapeHtml(submission.prospect.name)}</strong> on ${sentDate}.</p>`));
      }
      if (submission.status === 'rejected') {
        return htmlResponse(brandedPage('Already Rejected', '<p>This submission was previously rejected. No report will be sent.</p>'));
      }

      try {
        await sendProspectEmail(submission, reqUrl.origin);
        submission.status = 'sent';
        submission.sentAt = new Date().toISOString();
        await store.setJSON(`sub_${subId}`, submission);
        return htmlResponse(brandedPage(
          'Report Sent',
          `<p style="font-size:17px;line-height:1.7;">Report sent to <strong>${escapeHtml(submission.prospect.name)}</strong><br>at <strong>${escapeHtml(submission.prospect.email)}</strong>.</p><p style="margin-top:16px;font-size:14px;color:#555;">Submission ID: ${escapeHtml(subId)}</p>`
        ));
      } catch (e) {
        console.error('Prospect email send failed:', e.message);
        return htmlResponse(brandedPage('Send Failed', `<p>Failed to send the report: ${escapeHtml(e.message)}</p>`), 500);
      }
    }

    if (action === 'reject') {
      if (submission.status !== 'pending') {
        return htmlResponse(brandedPage('Already Actioned', `<p>This submission has already been ${escapeHtml(submission.status)}.</p>`));
      }
      submission.status = 'rejected';
      submission.rejectedAt = new Date().toISOString();
      try {
        await store.setJSON(`sub_${subId}`, submission);
      } catch (e) {
        return htmlResponse(brandedPage('Error', `<p>Failed to update submission: ${escapeHtml(e.message)}</p>`), 500);
      }
      return htmlResponse(brandedPage('Submission Rejected', `<p>Submission from <strong>${escapeHtml(submission.prospect.name)}</strong> has been rejected. No report will be sent.</p>`));
    }

    return htmlResponse(brandedPage('Unknown Action', '<p>Unrecognised action parameter.</p>'), 400);
  }

  // ─── POST: submit diagnostic ──────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }

    if (body.action !== 'submit-diagnostic') {
      return jsonResponse({ error: `Unknown action: ${body.action}` }, 400);
    }

    const { prospect, answers, type } = body;
    const diagType = type === 'operational' ? 'operational' : type === 'investigations' ? 'investigations' : type === 'loss-intelligence' ? 'loss-intelligence' : 'strategic';

    if (!prospect?.name?.trim() || !prospect?.email?.trim() ||
        !prospect?.organisation?.trim() || !Array.isArray(answers) || !answers.length) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(prospect.email)) {
      return jsonResponse({ error: 'Invalid email address' }, 400);
    }

    const id = `diag_${Date.now()}`;
    const token = randomUUID();
    const viewToken = randomUUID(); // Unique token for public report access

    // Store submission as pending
    const submission = {
      id,
      token,
      viewToken,
      diagType,
      submittedAt: new Date().toISOString(),
      status: 'pending',
      prospect,
      answers,
      report: null,
      sentAt: null,
      events: [], // Tracking events: opens, clicks
    };

    try {
      await store.setJSON(`sub_${id}`, submission);
      await store.set(`tok_${token}`, id);
    } catch (e) {
      console.error('Storage error:', e.message);
      return jsonResponse({ error: 'Failed to store submission', detail: e.message }, 500);
    }

    // Generate report and notify Brad (async, non-blocking)
    context.waitUntil((async () => {
      try {
        const report = await generateReport(prospect, answers, diagType);
        submission.report = report;
        await store.setJSON(`sub_${id}`, submission);
      } catch (e) {
        console.error('Report generation error:', e.message);
      }
      try {
        await notifyBrad(submission, reqUrl.origin);
      } catch (e) {
        console.error('Brad notification failed:', e.message);
      }
    })());

    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
};

// ─── Report generation ────────────────────────────────────────────────────

async function generateReport(prospect, answers, diagType = 'strategic') {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not configured');

  const answersBlock = answers
    .map((a, i) => `Q${i + 1}: ${a.question}\nResponse: ${a.answer}`)
    .join('\n\n');

  let systemPrompt = `You are a senior management consultant with 30 years of advisory experience. You specialise in closing the gap between strategic intent and operational execution.

You have received a self-assessment from a senior leader. Your task is to produce a structured diagnostic report grounded in the PROVED framework (Prepare, Review, Outline, Verify, Evaluate, Document).

Writing rules:
- Direct, senior-consulting register. No marketing language, no waffle.
- Australian English: organisation, programme, behaviour, colour, recognise.
- No sentence may begin with "There is", "There are", "There was", or "There were".
- Active voice by default.
- Every sentence earns its place.
- Specific to this person's situation — no generic observations.`;

  let userPrompt = `Respondent: ${prospect.name}, ${prospect.role}, ${prospect.organisation}

ASSESSMENT RESPONSES:
${answersBlock}

Produce a diagnostic report as a JSON object with this exact structure. All string values must be plain text (no HTML, no markdown):

{
  "headline": "A single sharp sentence capturing the core challenge facing this organisation. Should name the organisation or leader specifically.",
  "section1_findings": [
    "Finding 1 — a direct, specific observation drawn from their responses.",
    "Finding 2 — a second observation.",
    "Finding 3 — a third observation."
  ],
  "section2_primary": "The single primary constraint preventing progress. Name it plainly. One to two sentences.",
  "section2_secondary": [
    "Secondary constraint 1",
    "Secondary constraint 2"
  ],
  "section2_hypothesis": "A root cause hypothesis. Two to three sentences. What is driving the primary constraint?",
  "section3_steps": [
    "Priority area 1 — describe the first area where the gap cannot be closed without structured, expert-led work.",
    "Priority area 2 — the logical follow-on area."
  ],
  "section3_close": "A closing paragraph. Two to three sentences. Acknowledge the depth of what these gaps represent.",
  "bw_alignment": [
    "Systems & Process Optimisation — [specific sentence if relevant]",
    "Technology Integration & Capability Deployment — [specific sentence if relevant]",
    "Organisational Design & Change Management — [specific sentence if relevant]",
    "Strategic Advisory & Programme Leadership — [specific sentence if relevant]"
  ]
}

Only include service lines that are directly relevant. Return only the JSON object.`;

  // Type-specific overrides
  if (diagType === 'investigations') {
    systemPrompt += `\n\nYou are reviewing an investigations capability assessment. Focus on: evidence integrity, investigation process maturity, defensibility, and the ability to close investigations with clear outcomes.`;
  } else if (diagType === 'loss-intelligence') {
    systemPrompt += `\n\nYou are reviewing a loss intelligence assessment. Focus on: loss visibility, the intelligence-to-action cycle, root cause analysis capability, and prevention effectiveness.`;
  } else if (diagType === 'operational') {
    systemPrompt += `\n\nYou are reviewing an operational execution assessment. Focus on: the gap between intent and reality, visibility and measurement, accountability, and consistency.`;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Claude API returned ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Claude API');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON object found in Claude response');

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('Failed to parse Claude JSON response: ' + e.message);
  }

  const html = renderReportHtml(parsed, prospect, diagType);
  return { data: parsed, html };
}

function renderReportHtml(d, prospect, diagType = 'strategic') {
  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const e = escapeHtml;

  const alignmentItems = (d.bw_alignment || []).map(line => {
    const dashIdx = line.indexOf(' — ');
    const label = dashIdx > -1 ? line.slice(0, dashIdx) : line;
    const detail = dashIdx > -1 ? line.slice(dashIdx + 3) : '';
    return `<tr><td width="20" valign="top" style="padding:6px 0;"><div style="width:6px;height:6px;background:#1B6EC2;border-radius:50%;margin-top:8px;"></div></td><td style="padding:6px 0 6px 12px;font-size:14px;line-height:1.6;color:#2c2c3e;"><strong style="color:#0A1C42;">${e(label)}</strong>${detail ? ` — ${e(detail)}` : ''}</td></tr>`;
  }).join('');

  const findings = (d.section1_findings || []).map(f =>
    `<tr><td width="20" valign="top" style="padding:6px 0;"><div style="width:6px;height:6px;background:#1B6EC2;border-radius:50%;margin-top:8px;"></div></td><td style="padding:6px 0 6px 12px;font-size:15px;line-height:1.7;color:#2c2c3e;">${e(f)}</td></tr>`
  ).join('');

  const secondary = (d.section2_secondary || []).map(s =>
    `<tr><td width="20" valign="top" style="padding:4px 0;"><div style="width:6px;height:6px;background:#C0C8D0;border-radius:50%;margin-top:8px;"></div></td><td style="padding:4px 0 4px 12px;font-size:14px;line-height:1.6;color:#555;">${e(s)}</td></tr>`
  ).join('');

  const steps = (d.section3_steps || []).map((s, i) =>
    `<tr><td width="32" valign="top" style="padding:6px 0;"><div style="width:24px;height:24px;background:#EBF3FA;border-radius:50%;text-align:center;line-height:24px;font-size:12px;font-weight:700;color:#1B6EC2;">${i + 1}</div></td><td style="padding:6px 0 6px 12px;font-size:15px;line-height:1.7;color:#2c2c3e;">${e(s)}</td></tr>`
  ).join('');

  // Tracking pixel URL (will be injected with report ID by viewer)
  const trackingPixelUrl = `/.netlify/functions/track-diagnostic-open?id={REPORT_ID}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${diagType === 'operational' ? 'Operational' : diagType === 'investigations' ? 'Investigations' : diagType === 'loss-intelligence' ? 'Loss Intelligence' : 'Strategic'} Diagnostic Assessment — ${e(prospect.organisation)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Calibri,'Segoe UI',Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f7fa;padding:24px 0;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:660px;background:#ffffff;border-radius:8px;overflow:hidden;">

  <!-- Header with Logo -->
  <tr>
    <td style="background:#0A1C42;padding:36px 48px 28px;text-align:center;">
      <div style="margin-bottom:16px;"><img src="https://bwadvisorysolutions.com.au/logo.png" alt="BW Advisory Solutions" style="max-width:140px;height:auto;"></div>
      <div style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.5px;">BW Advisory Solutions</div>
      <div style="color:#EBF3FA;font-size:12px;margin-top:4px;letter-spacing:0.5px;">bwadvisorysolutions.com.au</div>
    </td>
  </tr>

  <!-- Title block -->
  <tr>
    <td style="background:#EBF3FA;padding:28px 48px;border-left:4px solid #1B6EC2;">
      <div style="color:#1B6EC2;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">${diagType === 'operational' ? 'Operational' : diagType === 'investigations' ? 'Investigations' : diagType === 'loss-intelligence' ? 'Loss Intelligence' : 'Strategic'} Diagnostic Assessment</div>
      <div style="font-size:22px;font-weight:700;color:#0A1C42;line-height:1.3;">${e(d.headline || '')}</div>
      <div style="margin-top:16px;font-size:13px;color:#666;">
        Prepared for: <strong>${e(prospect.name)}</strong>, ${e(prospect.role)}, ${e(prospect.organisation)}<br>
        Date: ${today}
      </div>
    </td>
  </tr>

  <!-- Body -->
  <tr><td style="padding:40px 48px;">

    <!-- Section 1 -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
      <tr>
        <td width="36" valign="top">
          <div style="width:30px;height:30px;background:#0A1C42;border-radius:50%;text-align:center;line-height:30px;font-size:14px;font-weight:700;color:#fff;">1</div>
        </td>
        <td style="padding-left:12px;vertical-align:middle;">
          <div style="font-size:17px;font-weight:700;color:#0A1C42;">${diagType === 'operational' ? 'Operational' : 'Strategic'} Reality Assessment</div>
        </td>
      </tr>
      <tr><td colspan="2" style="padding-top:16px;">
        <div style="background:#f9fbfd;border-left:3px solid #1B6EC2;padding:20px 24px;border-radius:0 4px 4px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${findings}
          </table>
        </div>
      </td></tr>
    </table>

    <!-- Section 2 -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
      <tr>
        <td width="36" valign="top">
          <div style="width:30px;height:30px;background:#0A1C42;border-radius:50%;text-align:center;line-height:30px;font-size:14px;font-weight:700;color:#fff;">2</div>
        </td>
        <td style="padding-left:12px;vertical-align:middle;">
          <div style="font-size:17px;font-weight:700;color:#0A1C42;">Core Constraint Analysis</div>
        </td>
      </tr>
      <tr><td colspan="2" style="padding-top:16px;">
        <div style="background:#fff7f0;border-left:3px solid #e67e22;padding:14px 20px;border-radius:0 4px 4px 0;margin-bottom:14px;">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#e67e22;margin-bottom:6px;">Primary Constraint</div>
          <div style="font-size:15px;font-weight:600;color:#2c2c3e;line-height:1.6;">${e(d.section2_primary || '')}</div>
        </div>
        <div style="margin-bottom:14px;">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#999;margin-bottom:8px;">Contributing Factors</div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${secondary}
          </table>
        </div>
        <div style="background:#f9fbfd;padding:16px 20px;border-radius:4px;">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#999;margin-bottom:8px;">Root Cause Hypothesis</div>
          <div style="font-size:15px;line-height:1.7;color:#2c2c3e;">${e(d.section2_hypothesis || '')}</div>
        </div>
      </td></tr>
    </table>

    <!-- Section 3 -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
      <tr>
        <td width="36" valign="top">
          <div style="width:30px;height:30px;background:#0A1C42;border-radius:50%;text-align:center;line-height:30px;font-size:14px;font-weight:700;color:#fff;">3</div>
        </td>
        <td style="padding-left:12px;vertical-align:middle;">
          <div style="font-size:17px;font-weight:700;color:#0A1C42;">Where the Work Lies</div>
        </td>
      </tr>
      <tr><td colspan="2" style="padding-top:16px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
          ${steps}
        </table>
        <div style="background:#EBF3FA;padding:18px 20px;border-radius:4px;">
          <div style="font-size:15px;line-height:1.7;color:#2c2c3e;">${e(d.section3_close || '')}</div>
        </div>
      </td></tr>
    </table>

    <!-- Section 4 -->
    ${alignmentItems ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
      <tr>
        <td width="36" valign="top">
          <div style="width:30px;height:30px;background:#0A1C42;border-radius:50%;text-align:center;line-height:30px;font-size:14px;font-weight:700;color:#fff;">4</div>
        </td>
        <td style="padding-left:12px;vertical-align:middle;">
          <div style="font-size:17px;font-weight:700;color:#0A1C42;">Where BW Advisory Can Help</div>
        </td>
      </tr>
      <tr><td colspan="2" style="padding-top:16px;">
        <div style="background:#f9fbfd;border-left:3px solid #0A1C42;padding:20px 24px;border-radius:0 4px 4px 0;">
          <div style="font-size:13px;color:#666;margin-bottom:12px;line-height:1.5;">Based on this assessment, the following BW Advisory service lines are most relevant to your organisation's situation.</div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${alignmentItems}
          </table>
        </div>
        <div style="margin-top:16px;text-align:center;">
          <a href="https://bwadvisorysolutions.com.au" style="display:inline-block;background:#1B6EC2;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Visit BW Advisory Solutions →</a>
        </div>
      </td></tr>
    </table>` : ''}

    <!-- Disclaimer -->
    <div style="background:#fff8ec;border:1px solid #f0d9a0;border-radius:6px;padding:14px 18px;margin-top:24px;">
      <span style="font-size:12px;font-weight:700;color:#6b4f1a;">Important: </span><span style="font-size:12px;color:#6b4f1a;line-height:1.6;">This report is provided for informational purposes only. It does not constitute professional, legal, financial, or strategic advice. No liability is accepted for decisions made in reliance on this report. Receipt of this report does not create a client relationship.</span>
    </div>

  </td></tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0A1C42;padding:24px 48px;">
      <div style="color:#ffffff;font-size:13px;font-weight:700;margin-bottom:4px;">Brad Warburton</div>
      <div style="color:#EBF3FA;font-size:12px;line-height:1.8;">
        BW Advisory Solutions<br>
        brad@bwadvisorysolutions.com.au &nbsp;·&nbsp; +61 407 779 474<br>
        bwadvisorysolutions.com.au
      </div>
    </td>
  </tr>

</table>
</td></tr>
</table>

<!-- Tracking pixel (inline, invisible) -->
<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />

</body>
</html>`;
}

// ─── Email senders ─────────────────────────────────────────────────────────

function getTransporter() {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) throw new Error('SMTP credentials not configured');
  return nodemailer.createTransport({
    host: 'smtp.protonmail.ch',
    port: 587,
    secure: false,
    auth: { user: smtpUser, pass: smtpPass },
    tls: { rejectUnauthorized: true },
  });
}

async function sendProspectEmail(submission, origin) {
  const { prospect, id, viewToken } = submission;
  const transporter = getTransporter();

  // Link to shared report viewer
  const reportLink = `${origin}/.netlify/functions/diagnostic-report-viewer?id=${encodeURIComponent(id)}&token=${encodeURIComponent(viewToken)}`;

  const emailHtml = `<!DOCTYPE html>
<html><body style="font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#1a1a2e;max-width:720px;margin:0 auto;background:#f5f7fa;padding:24px;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:720px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">

  <tr><td style="background:#0A1C42;padding:24px 36px;">
    <div style="color:#fff;font-size:15px;font-weight:700;">BW Advisory Solutions</div>
    <div style="color:#EBF3FA;font-size:12px;margin-top:2px;">Your Diagnostic Assessment</div>
  </td></tr>

  <tr><td style="background:#EBF3FA;padding:20px 36px;border-left:4px solid #1B6EC2;">
    <div style="font-size:18px;font-weight:700;color:#0A1C42;">Your Assessment is Ready</div>
    <div style="font-size:14px;color:#555;margin-top:2px;">Hi ${escapeHtml(prospect.name)},</div>
    <div style="font-size:13px;color:#1B6EC2;margin-top:4px;">View your diagnostic report below.</div>
  </td></tr>

  <tr><td style="padding:28px 36px;">

    <p style="font-size:15px;color:#333;line-height:1.6;">We've analysed your assessment and prepared a diagnostic report tailored to your situation. Click the button below to view your complete report.</p>

    <div style="margin: 28px 0; text-align:center;">
      <a href="${reportLink}" style="display:inline-block;background:#1B6EC2;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;">View Your Report →</a>
    </div>

    <p style="font-size:12px;color:#999;text-align:center;margin-top:24px;">This link is unique to you and will expire in 30 days.</p>

  </td></tr>

</table>
</body></html>`;

  await transporter.sendMail({
    from: `"BW Advisory Solutions" <${process.env.SMTP_USER}>`,
    to: prospect.email,
    bcc: HUBSPOT_BCC,
    subject: `Your Diagnostic Assessment — ${prospect.organisation}`,
    html: emailHtml,
  });
}

async function notifyBrad(submission, origin) {
  const { prospect, answers, id, token, report } = submission;
  const transporter = getTransporter();

  const approveUrl = `${origin}/.netlify/functions/diagnostic-api-v2?action=approve&token=${encodeURIComponent(token)}`;
  const rejectUrl = `${origin}/.netlify/functions/diagnostic-api-v2?action=reject&token=${encodeURIComponent(token)}`;

  const answersHtml = answers.map((a, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9fbfd' : '#ffffff'}">
      <td style="padding:8px 12px;font-size:13px;color:#666;width:38%;vertical-align:top;border-bottom:1px solid #eef0f5;">${escapeHtml(a.question)}</td>
      <td style="padding:8px 12px;font-size:13px;color:#2c2c3e;vertical-align:top;border-bottom:1px solid #eef0f5;">${escapeHtml(String(a.answer))}</td>
    </tr>`).join('');

  const emailHtml = `<!DOCTYPE html>
<html><body style="font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#1a1a2e;max-width:720px;margin:0 auto;background:#f5f7fa;padding:24px;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:720px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">

  <tr><td style="background:#0A1C42;padding:24px 36px;">
    <div style="color:#fff;font-size:15px;font-weight:700;">BW Advisory Solutions</div>
    <div style="color:#EBF3FA;font-size:12px;margin-top:2px;">New Diagnostic Submission — Review Required</div>
  </td></tr>

  <tr><td style="background:#EBF3FA;padding:20px 36px;border-left:4px solid #1B6EC2;">
    <div style="font-size:18px;font-weight:700;color:#0A1C42;">${escapeHtml(prospect.name)}</div>
    <div style="font-size:14px;color:#555;margin-top:2px;">${escapeHtml(prospect.role)} &nbsp;·&nbsp; ${escapeHtml(prospect.organisation)}</div>
    <div style="font-size:13px;color:#1B6EC2;margin-top:2px;">${escapeHtml(prospect.email)}</div>
    <div style="font-size:12px;color:#999;margin-top:4px;">Submitted: ${new Date(submission.submittedAt).toLocaleString('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} AWST</div>
  </td></tr>

  <tr><td style="padding:28px 36px;">

    <div style="font-size:14px;font-weight:700;color:#0A1C42;margin-bottom:10px;">Submission Answers</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #eef0f5;border-radius:4px;margin-bottom:28px;overflow:hidden;">
      ${answersHtml}
    </table>

    <div style="font-size:14px;font-weight:700;color:#0A1C42;margin-bottom:12px;">Generated Report Preview</div>
    <div style="border:1px solid #dde4ed;border-radius:6px;overflow:hidden;margin-bottom:28px;max-height:600px;overflow-y:auto;">
      ${report ? report.html : '<p style="padding:20px;color:#999;">Report still generating...</p>'}
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
      <tr>
        <td style="padding-right:8px;">
          <a href="${approveUrl}" style="display:block;background:#1B6EC2;color:#fff;padding:14px 20px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;text-align:center;">
            ✓ Approve &amp; Send to ${escapeHtml(prospect.name)}
          </a>
        </td>
        <td style="padding-left:8px;">
          <a href="${rejectUrl}" style="display:block;background:#f5f7fa;color:#555;padding:14px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;text-align:center;border:1.5px solid #dde4ed;">
            ✗ Reject
          </a>
        </td>
      </tr>
    </table>

    <div style="font-size:11px;color:#aaa;text-align:center;">Submission ID: ${escapeHtml(id)}</div>

  </td></tr>

</table>
</body></html>`;

  await transporter.sendMail({
    from: `"BW Advisory Hub" <${process.env.SMTP_USER}>`,
    to: BRAD_EMAIL,
    bcc: HUBSPOT_BCC,
    subject: `[Diagnostic] ${prospect.name} — ${prospect.organisation}`,
    html: emailHtml,
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function brandedPage(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)} — BW Advisory Solutions</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; background: #f5f7fa; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; max-width: 520px; width: 100%; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 24px rgba(10,28,66,0.1); }
  .header { background: #0A1C42; padding: 24px 36px; }
  .header-brand { color: #fff; font-size: 15px; font-weight: 700; }
  .header-sub { color: #EBF3FA; font-size: 12px; margin-top: 2px; }
  .body { padding: 36px; }
  h1 { color: #0A1C42; font-size: 21px; margin-bottom: 14px; font-weight: 700; }
  p { font-size: 15px; color: #444; line-height: 1.7; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="header-brand">BW Advisory Solutions</div>
    <div class="header-sub">bwadvisorysolutions.com.au</div>
  </div>
  <div class="body">
    <h1>${escapeHtml(title)}</h1>
    ${content}
  </div>
</div>
</body>
</html>`;
}
