export const handler = async (event, context) => {
  const apiKey = event.headers['x-portal-api-key'];
  if (apiKey !== process.env.BRAD_API_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // In a production environment, this would fetch from HubSpot, Wise, and Netlify Blobs
    // For the MVP, we aggregate the known state of the portal
    
    const status = {
      ok: true,
      generatedAt: new Date().toISOString(),
      businessHealth: {
        financial: {
          revenueYTD: 'A$142,500',
          expensesYTD: 'A$42,120',
          netProfit: 'A$100,380',
          outstanding: 'A$3,120',
          outstandingItems: [
            { client: 'Lynley R.', amount: 'A$1,200', age: '3 days overdue' },
            { client: 'TechFlow Inc.', amount: 'A$1,920', age: 'Due today' }
          ],
          status: 'Healthy',
          trend: 'Profit margin strong at 70%'
        },
        operations: {
          pendingActions: 2,
          activeProjects: 4,
          focus: '2 Diagnostics are ready for your final review and signature.'
        },
        techStack: {
          creditsRemaining: 'A$142 (Anthropic)',
          identifiedSavings: 'A$0 (Granola Trial)',
          status: 'Optimized'
        },
        strategy: {
          latestAlert: 'Claude 3.7 Released',
          action: 'Start trial for higher accuracy advisory reports.'
        }
      },
      bottomLine: 'Focus: You have A$3,120 in outstanding invoices. I recommend a quick nudge to these 2 clients before you dive into the 2 pending diagnostics.'
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
