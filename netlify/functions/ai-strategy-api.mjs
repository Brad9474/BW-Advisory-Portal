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
    let summary = 'Strategic Objective: Transition BW Advisory from "Manual Advisory" to "AI-Orchestrated Scaling". The current mandate is to pivot identified wastage (~A$233/yr) into a high-trust "Digital Twin" pilot that handles prospect triage and authority scaling autonomously.';
    
    let timeline = {
      now: {
        title: 'NOW: Tactical Optimization (0-30 Days)',
        actions: [
          'Rationalise meeting intelligence: Drop Granola to Basic (Save A$233/yr).',
          'Standardise Frontier Models: Consolidate all strategic logic on Claude 3.7 Pro.',
          'Execute Diagnostic Audit: Identify the top 3 recurring client data silos for AI porting.'
        ],
        rationale: 'Board Context: Current wastage in overlapping meeting tools is a direct tax on your innovation budget. By standardising on Claude 3.7, you achieve "Maximum Reasoning Density" per dollar spent, creating a solid foundation for the autonomous layer.'
      },
      shortTerm: {
        title: 'SHORT TERM: The Pilot (1-6 Months)',
        actions: [
          'Architect "Digital Bradley 1.0": High-fidelity integration of HeyGen Visuals with Hume AI EQ.',
          'Deploy Triage Automator: AI-led qualification for all new portal intakes.',
          'Context Retrieval: Move historical diagnostic context into a retrieval-augmented (RAG) store.'
        ],
        rationale: 'Strategic Context: Your time is the primary bottleneck for revenue growth. The Digital Twin is a scalable lead-filter. By automating initial triage, you ensure only High-Value (HV) prospects reach your personal calendar, increasing your effective hourly rate by an estimated 30%.'
      },
      longTerm: {
        title: 'LONG TERM: Ecosystem Orchestrator (6+ Months)',
        actions: [
          'Pivot to "AI Architect" Model: Managing a hybrid network of subcontractors and AI agents.',
          'Launch Automated Advisory Hub: A client-facing command center with real-time AI insights.',
          'Monetise IP: Package the "Glass Box" model as a standalone advisory framework for licensing.'
        ],
        rationale: 'Vision Context: The ultimate goal is moving from "Technician" (doing the work) to "Orchestrator" (owning the system). This phase matures the portal from a backend management tool into your primary revenue-generating product.'
      }
    };

    let costingAnalysis = [
      { item: 'HeyGen (Visual)', tier: 'Pro Annual', cost: '$79 USD/mo (~A$120)', rationale: 'Unlocks Avatar IV and LiveAvatar API for real-time interaction.', leverage: '24/7 Authority Scaling without personal fatigue.' },
      { item: 'Hume AI (Vocal)', tier: 'Creator Tier', cost: '$7 USD/mo (~A$11)', rationale: '200 mins of empathic voice processing per month.', leverage: 'Adds necessary EQ to your Digital Twin for prospect trust.' },
      { item: 'Claude 3.7 Pro', tier: 'Professional', cost: '$20 USD/mo (~A$31)', rationale: 'State-of-the-art reasoning for advisory reporting.', leverage: 'Primary logic engine for all strategic automation.' }
    ];

    let savings = [
      { tool: 'Granola', action: 'Switch to Basic', saving: 'A$233/yr', reason: 'Basic tier includes the critical HubSpot sync; premium history is currently redundant given your RAG plans.' }
    ];

    // --- CONTEXT-AWARE INTELLIGENCE LAYER ---
    if (userContext) {
      const lowerContext = userContext.toLowerCase();
      
      // Handle "Not Paying" / "Trial" / "Tour" context
      if (lowerContext.includes('tour') || lowerContext.includes('trial') || lowerContext.includes('not paying')) {
        summary = `Strategic Hub updated: Since you are currently on a zero-cost trial/tour for Granola, our immediate "Financial Pivot" focus shifts from cost-cutting to **Rapid Value Extraction**. Use this window to validate HubSpot sync reliability before any long-term commitment.`;
        
        // Update Roadmap "NOW"
        timeline.now.actions = [
          'Validate Granola Trial: Stress-test HubSpot sync with 10+ distinct meetings.',
          'Consolidate AI Logic: Use Claude Pro for all high-level strategic reporting.'
        ];
        timeline.now.rationale = 'Since you are currently at $0 cost, the goal is "Stress-Testing" for reliability rather than "Cost-Cutting" for efficiency.';
        
        // Remove from savings matrix (it's not a leak if it's free)
        savings = [];
      }

      // Handle "Pricing Plans" context
      if (lowerContext.includes('snipp') || lowerContext.includes('pricing plan')) {
        summary += ` | Snipps Integration Note: Pricing plans provided are being rationalized against the "AI Architect" model to determine build-vs-buy subcontractor margins.`;
        
        // Add to Short Term Roadmap
        timeline.shortTerm.actions.push('Rationalize Snipps Pricing against Subcontractor margin model.');
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
              title: 'New Frontier: Claude 3.7 Reasoning Engine',
              message: 'Initial benchmarks show significant reasoning gains for advisory reporting. Recommended: Consolidate logic here.',
              actionLabel: 'Upgrade Logic',
              actionLink: 'https://claude.ai/'
            }
          ],
          timeline: timeline,
          costingAnalysis: costingAnalysis,
          savings: savings,
          frontier: [
            { category: 'Digital Twin', candidate: 'HeyGen', useCase: 'Interactive Avatar diagnostics.', relevance: 'Critical', status: 'Action Recommended' },
            { category: 'Vocal AI', candidate: 'Hume AI', useCase: 'Empathic voice interaction.', relevance: 'High', status: 'In Research' },
            { category: 'Reasoning', candidate: 'Claude 3.7', useCase: 'Primary advisory reporting logic.', relevance: 'Critical', status: 'Deploying' }
          ],
          advisory: {
            auditChecklist: [
              'Data Silos: Identify knowledge trapped in unstructured spreadsheets/emails (Strategic Risk).',
              'Triage Bottlenecks: Can an AI handle 80% of initial discovery calls? (Scaling Opportunity).',
              'Intelligence Parity: Ensuring your advisory tools outpace client-side internal tools (Competitiveness).',
              'Governance: Establishing a "Board-Approved" AI safety baseline for sensitive client data.'
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
