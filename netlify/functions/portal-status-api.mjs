import { getStore } from '@netlify/blobs';

const HUB_API_URL = process.env.HUB_API_URL || 'https://bwadvisoryhub.netlify.app/.netlify/functions/hub-api';
const HUB_API_KEY = process.env.HUB_API_KEY || '';

async function hubCall(body) {
  try {
    const res = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-api-key': HUB_API_KEY },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export const handler = async (event, context) => {
  const apiKey = event.headers['x-portal-api-key'];
  if (apiKey !== process.env.BRAD_API_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const store = getStore({ name: 'portal-state', consistency: 'strong' });
    
    // 1. Get Intakes for Pipeline
    const allIntakes = await store.get('intakes', { type: 'json' }).catch(() => []) || [];
    const pendingIntakes = allIntakes.filter(i => i.status === 'pending');
    
    // 2. Get Financials from Hub
    const hubData = await hubCall({ action: 'get-state' });
    const state = hubData.state || {};
    const invoices = state.invoices || [];
    
    // Calculate Outstanding
    const unpaid = invoices.filter(inv => inv.status === 'due' || inv.status === 'overdue');
    const outstandingTotal = unpaid.reduce((sum, inv) => sum + (inv.total || 0), 0);
    
    // Calculate YTD (Assume July 1st start for AU Financial Year)
    const now = new Date();
    const currentYear = now.getFullYear();
    const fyStart = new Date(now.getMonth() >= 6 ? currentYear : currentYear - 1, 6, 1);
    
    const fyInvoices = invoices.filter(inv => new Date(inv.date) >= fyStart);
    const revenueYTD = fyInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
    
    const expenses = state.expenses || [];
    const expensesYTD = expenses
      .filter(exp => new Date(exp.date) >= fyStart)
      .reduce((sum, exp) => sum + (exp.amount || 0), 0);

    const netProfit = revenueYTD - expensesYTD;

    const outstandingItems = unpaid.slice(0, 3).map(inv => {
      const dueDate = new Date(inv.due);
      const diff = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      return {
        client: inv.client || 'Unknown',
        amount: `A$${inv.total.toLocaleString()}`,
        age: diff < 0 ? `${Math.abs(diff)} days overdue` : `Due in ${diff} days`
      };
    });

    const status = {
      ok: true,
      generatedAt: new Date().toISOString(),
      businessHealth: {
        financial: {
          revenueYTD: `A$${Math.round(revenueYTD).toLocaleString()}`,
          expensesYTD: `A$${Math.round(expensesYTD).toLocaleString()}`,
          netProfit: `A$${Math.round(netProfit).toLocaleString()}`,
          outstanding: `A$${Math.round(outstandingTotal).toLocaleString()}`,
          outstandingItems,
          status: outstandingTotal > 5000 ? 'Attention Required' : 'Healthy',
          trend: `Profit margin at ${revenueYTD > 0 ? Math.round((netProfit / revenueYTD) * 100) : 0}%`
        },
        operations: {
          pendingActions: pendingIntakes.length,
          activeProjects: 0, // Placeholder
          focus: pendingIntakes.length > 0 
            ? `You have ${pendingIntakes.length} intake${pendingIntakes.length > 1 ? 's' : ''} waiting for your review.` 
            : 'Operational queue is clear.'
        },
        techStack: {
          creditsRemaining: 'A$142 (Anthropic)',
          identifiedSavings: 'A$0',
          status: 'Optimized'
        },
        strategy: {
          latestAlert: 'Strategic Scout Active',
          action: 'Monitoring tech landscapes for opportunities.'
        }
      },
      bottomLine: outstandingTotal > 0 
        ? `Focus: You have A$${Math.round(outstandingTotal).toLocaleString()} in outstanding invoices. I recommend a quick nudge to these ${unpaid.length} clients.`
        : 'Focus: Financials are healthy. No immediate collection actions required.'
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(status)
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
