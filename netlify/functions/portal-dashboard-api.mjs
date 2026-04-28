import { getStore } from '@netlify/blobs';

const HUBSPOT_API = 'https://api.hubapi.com';
const HUB_API_URL = process.env.HUB_API_URL || 'https://bwadvisoryhub.netlify.app/.netlify/functions/hub-api';
const HUB_API_KEY = process.env.HUB_API_KEY || '';
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || '';

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-portal-api-key',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    },
  });

function requireBradAuth(req) {
  const key = req.headers.get('x-portal-api-key');
  const expected = process.env.BRAD_API_KEY;
  if (!expected) return { error: 'BRAD_API_KEY not configured on server' };
  if (!key || key !== expected) return { error: 'Unauthorised' };
  return null;
}

async function hubCall(action, data = {}) {
  try {
    const res = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-api-key': HUB_API_KEY,
      },
      body: JSON.stringify({ action, ...data }),
    });
    return await res.json();
  } catch (error) {
    console.error('Hub API call failed:', error);
    return { error: error.message };
  }
}

async function listDiagnostics(diagStore) {
  try {
    const submissions = [];
    for await (const { key } of diagStore.list()) {
      if (key.startsWith('sub_')) {
        const sub = await diagStore.get(key, { type: 'json' });
        if (sub) submissions.push(sub);
      }
    }
    return submissions;
  } catch (error) {
    console.error('Error listing diagnostics:', error);
    return [];
  }
}

async function loadStore(store, key) {
  try {
    const data = await store.get(key, { type: 'json' });
    return data || [];
  } catch {
    return [];
  }
}

// Dashboard Endpoints

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, x-portal-api-key',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      },
    });
  }

  const store = getStore({ name: 'portal-state', consistency: 'strong' });
  const diagStore = getStore({ name: 'diagnostics', consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const action = url.searchParams.get('action');

    // ── get-dashboard-kpis ────────────────────────────────────────────────────
    if (action === 'get-dashboard-kpis') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);

      try {
        // Get financial data from Hub
        const hubData = await hubCall({ action: 'get-state' });
        const invoices = (hubData.state?.invoices || []);

        // Calculate metrics
        const now = new Date();
        const ytdStart = new Date(now.getFullYear(), 0, 1);

        let revenueYTD = 0;
        let outstanding = 0;
        const paidInvoices = [];

        invoices.forEach(inv => {
          const invDate = new Date(inv.date);
          if (invDate >= ytdStart && inv.status === 'paid') {
            revenueYTD += inv.total || 0;
            paidInvoices.push(inv);
          }
          if (inv.status === 'pending' || inv.status === 'overdue') {
            outstanding += inv.total || 0;
          }
        });

        // Get pending diagnostics
        const diagnostics = await listDiagnostics(diagStore);
        const pendingDiags = diagnostics.filter(d => d.status === 'pending').length;

        // Get active clients
        const clients = await loadStore(store, 'clients');
        const activeClients = clients.filter(c => c.status === 'active').length;

        return jsonResponse({
          ok: true,
          kpis: {
            revenueYTD,
            revenueYTDFormatted: `$${revenueYTD.toFixed(0)}k`,
            outstanding,
            outstandingFormatted: `$${(outstanding / 1000).toFixed(1)}k`,
            pendingDiagnostics: pendingDiags,
            activeClients,
            totalInvoices: invoices.length,
            lastUpdated: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error('Error calculating KPIs:', error);
        return jsonResponse({
          ok: true,
          kpis: {
            revenueYTD: 0,
            revenueYTDFormatted: '$0k',
            outstanding: 0,
            outstandingFormatted: '$0k',
            pendingDiagnostics: 0,
            activeClients: 0,
            totalInvoices: 0,
            error: error.message,
          },
        }, 200);
      }
    }

    // ── get-diagnostic-engagement ─────────────────────────────────────────────
    if (action === 'get-diagnostic-engagement') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);

      const reportId = url.searchParams.get('reportId');
      if (!reportId) return jsonResponse({ error: 'Missing reportId' }, 400);

      try {
        const report = await diagStore.get(reportId, { type: 'json' });
        if (!report) return jsonResponse({ error: 'Report not found' }, 404);

        const events = report.events || [];
        const opens = events.filter(e => e.type === 'email_open');
        const clicks = events.filter(e => e.type === 'cta_click');

        // Calculate time-on-page approximation (from first open to last click or most recent event)
        let timeOnPageSeconds = 0;
        if (opens.length > 0 && events.length > 1) {
          const firstTime = new Date(opens[0].timestamp);
          const lastTime = new Date(events[events.length - 1].timestamp);
          timeOnPageSeconds = Math.round((lastTime - firstTime) / 1000);
        }

        // Device breakdown
        const deviceBreakdown = {};
        opens.forEach(e => {
          deviceBreakdown[e.device] = (deviceBreakdown[e.device] || 0) + 1;
        });

        // Browser breakdown
        const browserBreakdown = {};
        opens.forEach(e => {
          browserBreakdown[e.browser] = (browserBreakdown[e.browser] || 0) + 1;
        });

        // Country breakdown
        const countryBreakdown = {};
        opens.forEach(e => {
          countryBreakdown[e.country] = (countryBreakdown[e.country] || 0) + 1;
        });

        return jsonResponse({
          ok: true,
          engagement: {
            reportId,
            diagType: report.diagType,
            prospectName: report.prospect?.name || 'Unknown',
            createdAt: report.createdAt,
            metrics: {
              opens: opens.length,
              clicks: clicks.length,
              timeOnPageSeconds,
              timeOnPageFormatted: timeOnPageSeconds > 0 ? `${Math.round(timeOnPageSeconds / 60)} min` : 'N/A',
              uniqueCountries: Object.keys(countryBreakdown).length,
            },
            devices: deviceBreakdown,
            browsers: browserBreakdown,
            countries: countryBreakdown,
            events: events.slice(-20), // Last 20 events
          },
        });
      } catch (error) {
        console.error('Error retrieving engagement:', error);
        return jsonResponse({ error: error.message }, 500);
      }
    }

    // ── get-aggregated-themes ─────────────────────────────────────────────────
    if (action === 'get-aggregated-themes') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);

      try {
        const diagnostics = await listDiagnostics(diagStore);

        // Extract open-text answers (Q9, Q10 from each diagnostic)
        const textResponses = [];
        diagnostics.forEach(diag => {
          const answers = diag.answers || [];
          // Questions 9 and 10 are typically the open-text fields
          if (answers[8]) textResponses.push(answers[8]); // Q9
          if (answers[9]) textResponses.push(answers[9]); // Q10
        });

        if (textResponses.length === 0) {
          return jsonResponse({
            ok: true,
            themes: {
              topThemes: [],
              lastUpdated: new Date().toISOString(),
              diagnosticCount: 0,
            },
          });
        }

        // Use Claude to synthesize themes (async, with placeholder for now)
        const themes = synthesizeThemes(textResponses);

        return jsonResponse({
          ok: true,
          themes: {
            topThemes: themes,
            diagnosticCount: diagnostics.length,
            lastUpdated: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error('Error aggregating themes:', error);
        return jsonResponse({ error: error.message }, 500);
      }
    }

    // ── get-pipeline-view ─────────────────────────────────────────────────────
    if (action === 'get-pipeline-view') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);

      try {
        const intakes = await loadStore(store, 'intakes');
        const diagnostics = await listDiagnostics(diagStore);
        const clients = await loadStore(store, 'clients');

        const hubData = await hubCall({ action: 'get-state' });
        const invoices = (hubData.state?.invoices || []);

        // Count by stage
        const pipeline = {
          intakeTotal: intakes.length,
          intakePending: intakes.filter(i => i.status === 'pending').length,
          diagnosticsSubmitted: diagnostics.length,
          diagnosticsPending: diagnostics.filter(d => d.status === 'pending').length,
          diagnosticsSent: diagnostics.filter(d => d.status === 'sent').length,
          clientsActive: clients.filter(c => c.status === 'active').length,
          invoicesIssued: invoices.length,
            invoicesPending: invoices.filter(i => i.status === 'pending' || i.status === 'overdue').length,
          invoicesPaid: invoices.filter(i => i.status === 'paid').length,
        };

        // Calculate approximate revenue progression
        const paidInvoices = invoices.filter(i => i.status === 'paid');
        const totalRevenue = paidInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

        return jsonResponse({
          ok: true,
          pipeline: {
            ...pipeline,
            revenueRealized: totalRevenue,
          },
        });
      } catch (error) {
        console.error('Error calculating pipeline:', error);
        return jsonResponse({ error: error.message }, 500);
      }
    }

    // ── get-financial-summary ─────────────────────────────────────────────────
    if (action === 'get-financial-summary') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);

      try {
        const hubData = await hubCall({ action: 'get-state' });
        const invoices = (hubData.state?.invoices || []);

        const now = new Date();
        const ytdStart = new Date(now.getFullYear(), 0, 1);

        let revenueYTD = 0;
        let outstandingAmount = 0;
        let aged30 = 0, aged60 = 0, aged90 = 0;
        const invoicesByMonth = {};

        invoices.forEach(inv => {
          const invDate = new Date(inv.date);
          const daysOverdue = Math.floor((now - new Date(inv.due)) / (1000 * 60 * 60 * 24));

          if (invDate >= ytdStart && inv.status === 'paid') {
            revenueYTD += inv.total || 0;
            const monthKey = invDate.toISOString().slice(0, 7); // YYYY-MM
            invoicesByMonth[monthKey] = (invoicesByMonth[monthKey] || 0) + inv.total;
          }

          if (inv.status === 'pending' || inv.status === 'overdue') {
            outstandingAmount += inv.total || 0;
            if (daysOverdue > 90) aged90 += inv.total || 0;
            else if (daysOverdue > 60) aged60 += inv.total || 0;
            else if (daysOverdue > 30) aged30 += inv.total || 0;
          }
        });

        return jsonResponse({
          ok: true,
          financial: {
            revenueYTD,
            outstandingAmount,
            agedReceivables: {
              aged30,
              aged60,
              aged90,
            },
            invoicesByMonth,
            totalInvoices: invoices.length,
            paidInvoices: invoices.filter(i => i.status === 'paid').length,
            pendingInvoices: invoices.filter(i => i.status === 'pending' || i.status === 'overdue').length,
          },
        });
      } catch (error) {
        console.error('Error calculating financial summary:', error);
        return jsonResponse({ error: error.message }, 500);
      }
    }

    // ── get-client-profile ────────────────────────────────────────────────────
    if (action === 'get-client-profile') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);

      const clientId = url.searchParams.get('clientId');
      if (!clientId) return jsonResponse({ error: 'Missing clientId' }, 400);

      try {
        const clients = await loadStore(store, 'clients');
        const client = clients.find(c => c.id === clientId);
        if (!client) return jsonResponse({ error: 'Client not found' }, 404);

        // Get all diagnostics for this client
        const diagnostics = await listDiagnostics(diagStore);
        const clientDiags = diagnostics.filter(d => d.prospect?.email === client.email || d.prospectId === clientId);

        // Get documents
        const docs = await loadStore(store, 'documents');
        const clientDocs = docs.filter(d => d.clientId === clientId);

        // Get invoices
        const hubData = await hubCall({ action: 'get-state' });
        const invoices = (hubData.state?.invoices || []).filter(
          inv => inv.clientId === clientId || inv.clientEmail === client.email
        );

        // Build timeline
        const timeline = [];
        clientDiags.forEach(diag => {
          timeline.push({
            date: diag.submittedAt,
            type: 'diagnostic_submitted',
            description: `${diag.diagType} diagnostic`,
          });
        });
        clientDocs.forEach(doc => {
          timeline.push({
            date: doc.uploadedAt,
            type: 'document_sent',
            description: doc.fileName,
          });
        });
        invoices.forEach(inv => {
          timeline.push({
            date: inv.date,
            type: 'invoice_issued',
            description: `Invoice ${inv.num} — $${inv.total}`,
          });
        });
        timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

        return jsonResponse({
          ok: true,
          client: {
            ...client,
            diagnosticsCount: clientDiags.length,
            documentsCount: clientDocs.length,
            invoicesCount: invoices.length,
            invoicesTotal: invoices.reduce((sum, inv) => sum + (inv.total || 0), 0),
            invoicesPaid: invoices.filter(i => i.status === 'paid').length,
            timeline: timeline.slice(0, 20), // Last 20 events
          },
        });
      } catch (error) {
        console.error('Error retrieving client profile:', error);
        return jsonResponse({ error: error.message }, 500);
      }
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
};

// Utility: Simple theme synthesis
// In production, this would use Claude API for more sophisticated analysis
function synthesizeThemes(textResponses) {
  const commonWords = [
    'accountability', 'communication', 'resource', 'clarity', 'execution',
    'change', 'leadership', 'capability', 'process', 'technology',
    'culture', 'alignment', 'measurement', 'feedback', 'bottleneck',
  ];

  const themeCounts = {};
  textResponses.forEach(response => {
    const text = (response || '').toLowerCase();
    commonWords.forEach(word => {
      if (text.includes(word)) {
        themeCounts[word] = (themeCounts[word] || 0) + 1;
      }
    });
  });

  // Return top 5 themes by frequency
  return Object.entries(themeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme, count]) => ({
      theme: theme.charAt(0).toUpperCase() + theme.slice(1),
      mentions: count,
    }));
}
