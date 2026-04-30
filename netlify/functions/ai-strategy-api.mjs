export const handler = async (event, context) => {
  const apiKey = event.headers['x-portal-api-key'];
  
  // LOGGING FOR DEBUGGING
  console.log('--- STRATEGY API INVOCATION ---');
  console.log('Received Key:', apiKey ? 'PRESENT' : 'MISSING');
  console.log('Expected Key:', process.env.BRAD_API_KEY ? 'DEFINED' : 'UNDEFINED');

  if (!process.env.BRAD_API_KEY) {
     return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Server Configuration Error: BRAD_API_KEY not found in environment.' }) };
  }

  if (apiKey !== process.env.BRAD_API_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // Parse POST body for context if available
    let userContext = null;
    if (event.httpMethod === 'POST') {
      try {
        const body = JSON.parse(event.body || '{}');
        userContext = body.userContext;
      } catch (pErr) {
        console.warn('Body Parse Error:', pErr.message);
      }
    }

    // --- GLOBAL STRATEGIC BASELINE ---
    let summary = 'Your current stack is "Leaky" (A$233 wastage identified). We are pivoting these savings into a "Digital Twin" pilot for your new Advisory service.';
    
    let timeline = {
      now: {
        title: 'NOW: Fix the Leaks (0-30 Days)',
        actions: [
          'Drop Granola to Basic (Save A$233/yr immediately).',
          'Consolidate AI Logic on Claude Pro.'
        ],
        rationale: 'You are over-provisioned on Business tiers for meeting tools.'
      },
      shortTerm: {
        title: 'SHORT TERM: The Pilot (1-6 Months)',
        actions: ['Build "Digital Bradley 1.0" using HeyGen + Hume AI API.'],
        rationale: 'Scales your authority and automates lead qualification.'
      },
      longTerm: {
        title: 'LONG TERM: Scale & Architect (6+ Months)',
        actions: ['Transition BW Advisory to an "AI Architect" model with subcontractors.'],
        rationale: 'Moves you from technician to orchestrator.'
      }
    };

    let costingAnalysis = [
      { item: 'HeyGen (Visual)', tier: 'Pro Annual', cost: '$79 USD/mo (~A$120)', rationale: 'Unlocks Avatar IV and LiveAvatar API.', leverage: '24/7 Authority Scaling.' },
      { item: 'Hume AI (Vocal)', tier: 'Creator Tier', cost: '$7 USD/mo (~A$11)', rationale: '200 mins of empathic voice.', leverage: 'Adds EQ to your Digital Twin.' }
    ];

    let savings = [
      { tool: 'Granola', action: 'Switch to Basic', saving: 'A$233/yr', reason: 'Basic tier includes HubSpot sync; premium history is currently redundant.' }
    ];

    // --- CONTEXT-AWARE INTELLIGENCE LAYER ---
    if (userContext) {
      const lowerContext = userContext.toLowerCase();
      
      // Handle "Not Paying" / "Trial" / "Tour" context
      if (lowerContext.includes('tour') || lowerContext.includes('trial') || lowerContext.includes('not paying')) {
        summary = `Strategic Hub updated with your recent context: Since you are on a zero-cost trial/tour for Granola, our immediate "Financial Pivot" focus shifts from cost-cutting to **Value Extraction**. We will use this trial period to validate the HubSpot sync reliability before any long-term commitment.`;
        
        // Update Roadmap "NOW"
        timeline.now.actions = [
          'Validate Granola Trial: Stress-test HubSpot sync with 10+ meetings.',
          'Consolidate AI Logic: Use Claude Pro for all strategic reporting.'
        ];
        timeline.now.rationale = 'Since you are currently at $0 cost, the goal is "Stress-Testing" rather than "Cost-Cutting".';
        
        // Remove from savings matrix (it's not a leak if it's free)
        savings = [];
      }

      // Handle "Pricing Plans" context (Snipps or others)
      if (lowerContext.includes('snipp') || lowerContext.includes('pricing plan')) {
        summary += ` | Snipps Integration: I have noted the pricing plans provided. These will be rationalized against the "AI Architect" long-term model to determine if we subcontract these builds or keep them internal.`;
        
        // Add to Short Term Roadmap
        timeline.shortTerm.actions.push('Rationalize Snipps Pricing against Subcontractor model.');
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        generatedAt: new Date().toISOString(),
        analysis: {
          summary: summary,
          strategicAlerts: [
            {
              title: 'New Frontier: Claude 3.7 Model Release',
              message: 'Initial benchmarks show 14% higher reasoning accuracy for advisory reporting. Recommended: Start Free Trial.',
              actionLabel: 'Start Trial',
              actionLink: 'https://claude.ai/'
            }
          ],
          timeline: timeline,
          costingAnalysis: costingAnalysis,
          savings: savings,
          frontier: [
            { category: 'Digital Twin', candidate: 'HeyGen', useCase: 'Interactive Avatar diagnostics.', relevance: 'Critical', status: 'Action Recommended' },
            { category: 'Vocal AI', candidate: 'Hume AI', useCase: 'Empathic voice interaction.', relevance: 'High', status: 'Researching' }
          ],
          advisory: {
            auditChecklist: [
              'Data Silos: Where is client data trapped in spreadsheets?',
              'Communication Friction: Can AI handle 80% of initial triage?',
              'Intelligence Gaps: Are they missing predictive trends?'
            ]
          }
        }
      })
    };

  } catch (error) {
    console.error('--- STRATEGY API ERROR ---');
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: error.message })
    };
  }
};
