import { getStore } from '@netlify/blobs';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Basic Auth Check (same as other internal APIs)
  const apiKey = event.headers['x-portal-api-key'];
  if (apiKey !== process.env.BRAD_API_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const systems = [];

    // 1. Fetch HubSpot Real-Time Limits
    let hubspotUsed = 0;
    let hubspotLimit = 500000; // Free tier default
    let hubspotStatus = 'active';
    let hubspotDetails = 'API call volume limit.';
    
    if (process.env.HUBSPOT_API_KEY) {
      try {
        const hsRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
          headers: { 'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}` }
        });
        
        if (hsRes.ok) {
          const limitStr = hsRes.headers.get('x-hubspot-ratelimit-daily');
          const remainingStr = hsRes.headers.get('x-hubspot-ratelimit-daily-remaining');
          
          if (limitStr && remainingStr) {
            hubspotLimit = parseInt(limitStr, 10);
            const remaining = parseInt(remainingStr, 10);
            hubspotUsed = hubspotLimit - remaining;
            
            const percentUsed = (hubspotUsed / hubspotLimit) * 100;
            if (percentUsed > 90) hubspotStatus = 'critical';
            else if (percentUsed > 75) hubspotStatus = 'warning';
            
            hubspotDetails = 'Real-time API volume limit from HubSpot headers.';
          }
        }
      } catch (e) {
        console.error('HubSpot Limit Fetch Error:', e);
        hubspotDetails = 'Failed to fetch real-time limits. Using estimates.';
      }
    } else {
      hubspotDetails = 'HubSpot API Key not found in environment.';
      hubspotStatus = 'warning';
    }

    systems.push({
      id: 'hubspot',
      name: 'HubSpot',
      type: 'limit',
      used: hubspotUsed,
      limit: hubspotLimit,
      resetDate: new Date(new Date().setUTCHours(24,0,0,0)).toISOString(), // Resets at midnight UTC
      status: hubspotStatus,
      lastUpdated: new Date().toISOString(),
      details: hubspotDetails
    });

    // 2. Anthropic API — Claude Pro Subscription
    systems.push({
      id: 'anthropic',
      name: 'Anthropic Claude Pro',
      type: 'subscription',
      plan: 'Pro',
      cost: 309.09,
      currency: 'AUD',
      billingCycle: 'annual',
      purchaseDate: '2026-04-11',
      expiryDate: '2027-04-11',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Plan: Claude Pro (Annual) · A$309.09 · Purchased: 11/Apr/2026 · Expires: 11/Apr/2027',
      actionLink: 'https://claude.ai/'
    });

    // 3. Wise (Financial Hub)
    systems.push({
      id: 'wise',
      name: 'Wise',
      type: 'service',
      cost: 65.00,
      currency: 'AUD',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'A$65.00 one-time business debit card setup · Free ongoing transfers · Used in Financial Hub for borderless payments',
      actionLink: 'https://wise.com/user/account/'
    });

    // 4. Grammarly
    systems.push({
      id: 'grammarly',
      name: 'Grammarly',
      type: 'subscription',
      plan: 'Pro',
      cost: 128.84,
      costUSD: 86.40,
      currency: 'AUD',
      billingCycle: 'annual',
      purchaseDate: '2026-04-11',
      expiryDate: '2027-04-11',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Plan: Pro (Annual) · A$128.84 (USD $86.40) · Purchased: 11/Apr/2026 · Expires: 11/Apr/2027',
      actionLink: 'https://app.grammarly.com/'
    });

    // 5. Netlify — Personal Plan ($9 USD/month, 1,000 credits/month + add-on credits)
    systems.push({
      id: 'netlify',
      name: 'Netlify',
      type: 'limit',
      used: 0,              // Production deploys: 0 used this period (30 Apr 2026)
      limit: 1000,          // Monthly plan credits
      addonCredits: 422.8,  // Add-on credits purchased separately (remaining)
      costPerMonthUSD: 9.00,
      costPerMonthAUD: 12.51,
      billingModel: 'monthly',
      billingEffective: '2026-03-30',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Personal plan · USD $9.00/mo (≈ A$12.51) · 1,000 plan credits + 422.8 add-on credits · Effective 30/Mar/2026 · 0 production deploys this period',
      actionLink: 'https://app.netlify.com/teams/bradleywarburton/billing'
    });

    // 6. Calendly — Free Plan
    systems.push({
      id: 'calendly',
      name: 'Calendly',
      type: 'free',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Free plan · 1 event type · Used for client booking via portal intake flow',
      actionLink: 'https://calendly.com/event_types/user/me'
    });

    // 10. GoDaddy — Domain Registration
    const godaddyExpiry = new Date('2029-02-20');
    const godaddyDaysLeft = Math.ceil((godaddyExpiry - new Date()) / (1000 * 60 * 60 * 24));
    systems.push({
      id: 'godaddy',
      name: 'GoDaddy',
      type: 'subscription',
      plan: 'Domain Registration (3yr)',
      cost: 47.91,
      currency: 'AUD',
      billingCycle: '3-year',
      purchaseDate: '2026-02-20',
      expiryDate: '2029-02-20',
      daysLeft: godaddyDaysLeft,
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: `bwadvisorysolutions.com.au · 3-year plan · A$47.91 · Purchased: 20/Feb/2026 · Renews: 20/Feb/2029 · ${Math.floor(godaddyDaysLeft / 365)} years remaining`,
      actionLink: 'https://account.godaddy.com/products'
    });

    // 7. Microsoft 365 Family Classic
    const m365Expiry = new Date('2026-10-15');
    const m365DaysLeft = Math.ceil((m365Expiry - new Date()) / (1000 * 60 * 60 * 24));
    const m365Status = m365DaysLeft < 30 ? 'warning' : 'active';
    systems.push({
      id: 'microsoft365',
      name: 'Microsoft 365 Family',
      type: 'subscription',
      plan: 'Family Classic',
      cost: 139.00,
      currency: 'AUD',
      billingCycle: 'annual',
      purchaseDate: '2025-10-15',
      expiryDate: '2026-10-15',
      daysLeft: m365DaysLeft,
      status: m365Status,
      lastUpdated: new Date().toISOString(),
      details: `Family Classic (Annual) · A$139.00 · Purchased: 15/Oct/2025 · Renews: 15/Oct/2026 · ${m365DaysLeft} days remaining`,
      actionLink: 'https://account.microsoft.com/services/'
    });

    // 8. ChatGPT — Free Plan
    systems.push({
      id: 'chatgpt',
      name: 'ChatGPT',
      type: 'free',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Free plan · GPT-4o (limited) · Used for general AI assistance & research',
      actionLink: 'https://chatgpt.com/'
    });

    // 11. Wispr Flow — Active Trial (15-day trial, 8 days used)
    const wisprTrialDaysLeft = 7; // 15-day trial, 8 days used
    systems.push({
      id: 'wispr',
      name: 'Wispr Flow',
      type: 'trial',
      trialTotal: 15,
      trialUsed: 8,
      trialDaysLeft: wisprTrialDaysLeft,
      status: wisprTrialDaysLeft <= 2 ? 'critical' : 'warning',
      lastUpdated: new Date().toISOString(),
      details: `Pro trial · ${wisprTrialDaysLeft} days remaining · AI voice dictation · Liking it ✓`,
      actionLink: 'https://wisprflow.ai/',
      modalContent: `
        <div style="font-size:14px; color:#475569; line-height:1.7;">
          <div style="background:#fef3c7; padding:14px; border-radius:8px; border:1px solid #fbbf24; margin-bottom:18px;">
            <strong style="color:#92400e;">⏱ ${wisprTrialDaysLeft} days left on Pro trial</strong><br>
            <span style="font-size:13px;">You've used 8 of 15 trial days and are finding it useful.</span>
          </div>
          <h4 style="color:#0F172A; margin-bottom:12px;">Wispr Flow Pricing (AUD)</h4>
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <tr style="background:#f8fafc;">
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Plan</td>
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Monthly (AUD)</td>
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Annual (AUD)</td>
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Annual total</td>
            </tr>
            <tr>
              <td style="padding:8px; border:1px solid #e2e8f0;">Basic</td>
              <td style="padding:8px; border:1px solid #e2e8f0; color:#166534;">Free</td>
              <td style="padding:8px; border:1px solid #e2e8f0; color:#166534;">Free</td>
              <td style="padding:8px; border:1px solid #e2e8f0; color:#166534;">$0 · 2,000 words/wk desktop</td>
            </tr>
            <tr style="background:#f0fdf4;">
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Pro ⭐ (-20%)</td>
              <td style="padding:8px; border:1px solid #e2e8f0;">A$20/mo</td>
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">A$16/mo</td>
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600; color:#166534;">A$192/yr · Unlimited words</td>
            </tr>
            <tr>
              <td style="padding:8px; border:1px solid #e2e8f0;">Enterprise</td>
              <td style="padding:8px; border:1px solid #e2e8f0;">A$32/user</td>
              <td style="padding:8px; border:1px solid #e2e8f0;">A$32/user</td>
              <td style="padding:8px; border:1px solid #e2e8f0;">SOC II, SSO, zero data retention</td>
            </tr>
          </table>
          <div style="background:#f0f9ff; padding:12px; border-radius:8px; border:1px solid #bae6fd; margin-top:16px;">
            <strong style="color:#0369a1; font-size:13px;">🤖 Researcher Note</strong><br>
            <span style="font-size:12px; color:#0c4a6e;">Basic gives 2,000 words/week on desktop — sufficient for light use. Pro at <strong>A$192/yr</strong> is strong value if you dictate daily (reports, emails, briefs). Also note: Basic includes HIPAA-ready &amp; zero data retention — good for client confidentiality.</span>
          </div>
        </div>
      `
    });

    // 12. Granola — Active Trial (1 day left — expires 1 May 2026)
    const granolaTrialDaysLeft = 1;
    systems.push({
      id: 'granola',
      name: 'Granola',
      type: 'trial',
      trialTotal: 7, // approx
      trialUsed: 5,
      trialDaysLeft: granolaTrialDaysLeft,
      status: 'critical',
      lastUpdated: new Date().toISOString(),
      details: `Business trial · ${granolaTrialDaysLeft} days remaining · AI meeting notes · Decision needed by 1/May/2026`,
      actionLink: 'https://granola.ai/',
      modalContent: `
        <div style="font-size:14px; color:#475569; line-height:1.7;">
          <div style="background:#fee2e2; padding:14px; border-radius:8px; border:1px solid #f87171; margin-bottom:18px;">
            <strong style="color:#991b1b;">🚨 ${granolaTrialDaysLeft} days left — decision needed by 1 May 2026</strong><br>
            <span style="font-size:13px;">Trial expires imminently. Choose a plan or you'll drop to Basic automatically.</span>
          </div>
          <h4 style="color:#0F172A; margin-bottom:12px;">Granola Pricing (all USD)</h4>
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <tr style="background:#f8fafc;">
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Plan</td>
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Cost</td>
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Key limits</td>
            </tr>
            <tr>
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Basic (Free)</td>
              <td style="padding:8px; border:1px solid #e2e8f0; color:#166534; font-weight:600;">$0</td>
              <td style="padding:8px; border:1px solid #e2e8f0;">30-day note history only · Includes HubSpot integration ✓</td>
            </tr>
            <tr style="background:#f0fdf4;">
              <td style="padding:8px; border:1px solid #e2e8f0; font-weight:600;">Business ⭐</td>
              <td style="padding:8px; border:1px solid #e2e8f0;">$14/user/mo<br><span style="color:#64748b; font-size:12px;">≈ A$233/yr</span></td>
              <td style="padding:8px; border:1px solid #e2e8f0;">Unlimited history · Notion, Slack, HubSpot, Zapier integrations · Advanced AI models</td>
            </tr>
            <tr>
              <td style="padding:8px; border:1px solid #e2e8f0;">Enterprise</td>
              <td style="padding:8px; border:1px solid #e2e8f0;">$35/user/mo</td>
              <td style="padding:8px; border:1px solid #e2e8f0;">SSO, advanced admin — overkill for solo advisory</td>
            </tr>
          </table>
          <div style="background:#f0f9ff; padding:12px; border-radius:8px; border:1px solid #bae6fd; margin-top:16px;">
            <strong style="color:#0369a1; font-size:13px;">🤖 Researcher Recommendation Pending</strong><br>
            <span style="font-size:12px; color:#0c4a6e;"><strong>Start on Basic (free)</strong> — HubSpot integration is included and 30-day history is fine for current usage. Upgrade to Business only if you need unlimited searchable history across client meetings or Notion/Slack sync. This saves A$233/yr immediately.</span>
          </div>
        </div>
      `
    });

    // 9. ProtonMail Mail Plus — critical email infrastructure
    const protonExpiry = new Date('2026-09-16');
    const protonDaysLeft = Math.ceil((protonExpiry - new Date()) / (1000 * 60 * 60 * 24));
    const protonStatus = protonDaysLeft < 30 ? 'warning' : 'active';
    systems.push({
      id: 'protonmail',
      name: 'Proton Mail Plus',
      type: 'subscription',
      plan: 'Mail Plus',
      cost: 77.88,
      currency: 'AUD',
      billingCycle: 'annual',
      purchaseDate: '2025-09-16',
      expiryDate: '2026-09-16',
      daysLeft: protonDaysLeft,
      status: protonStatus,
      lastUpdated: new Date().toISOString(),
      details: 'Mail Plus (Annual) · A$77.88 · Purchased: 16/Sep/2025 · Renews: 16/Sep/2026 · Critical: email infrastructure for Portal, Hub &amp; client comms',
      actionLink: 'https://account.proton.me/mail/subscription'
    });

    // 4. Google One AI Pro — Free Trial (expires 27 May 2026, then paid)
    const googleTrialExpiry = new Date('2026-05-27');
    const googleTrialDaysLeft = Math.ceil((googleTrialExpiry - new Date()) / (1000 * 60 * 60 * 24));
    const googleStatus = googleTrialDaysLeft <= 0 ? 'critical' : googleTrialDaysLeft < 14 ? 'critical' : 'warning';
    systems.push({
      id: 'gcp',
      name: 'Google One AI Pro',
      type: 'subscription',
      limit: 1000,
      isTrial: true,
      trialDaysLeft: googleTrialDaysLeft,
      status: googleStatus,
      lastUpdated: new Date().toISOString(),
      details: `⚠️ Free trial · ${googleTrialDaysLeft} days remaining · Paid plan required from 27/May/2026<br>Includes: Gemini Advanced · 2TB Drive · 1,000 AI credits/month<br>Account: bradley.warburton@gmail.com`,
      actionLink: 'https://gemini.google.com/',
      actionLink2: 'https://one.google.com/about/plans'
    });

    // 5. Google Cloud Platform (Free Trial)
    systems.push({
      id: 'gcp-trial',
      name: 'Google Cloud Platform',
      type: 'credit',
      balance: 422.79,
      currency: 'AUD',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Developer Free Trial Credit.<br>Expires: 02/Jun/2026',
      modalContent: `
        <div style="font-size:14px; color:#475569; line-height:1.6;">
          <div style="background:#f0f9ff; padding:16px; border-radius:8px; border:1px solid #bae6fd; margin-bottom:20px;">
            <strong style="color:#0369a1; font-size:15px; display:block; margin-bottom:4px;">A$422.79 Free GCP Credit</strong>
            <p style="color:#0c4a6e; font-size:13px;">Available in billing account <code>0139CD-98113E-F97FE7</code>. Expires June 2, 2026.</p>
          </div>
          
          <h4 style="color:#0F172A; font-size:16px; margin-bottom:12px;">High-Value Use Cases for BW Advisory:</h4>
          
          <div style="margin-bottom:16px;">
            <strong style="color:#1e293b;">📍 Advanced Maps & Location Intelligence</strong>
            <p style="font-size:13px; margin-top:4px;">Use Google Maps Platform APIs to build dynamic crime heat-maps or location-based risk dashboards directly into your Portal.</p>
          </div>
          
          <div style="margin-bottom:16px;">
            <strong style="color:#1e293b;">📄 Enterprise Document AI</strong>
            <p style="font-size:13px; margin-top:4px;">A dedicated service trained by enterprises to extract structured data from complex legal/financial contracts and invoices. (An alternative to Claude).</p>
          </div>
          
          <div style="margin-bottom:16px;">
            <strong style="color:#1e293b;">🎙️ Vertex AI (Gemini APIs)</strong>
            <p style="font-size:13px; margin-top:4px;">Plug Gemini Pro into your portal, or use Google's incredible Speech-to-Text capabilities to automatically transcribe audio recordings from client meetings and investigations.</p>
          </div>
          
          <div>
            <strong style="color:#1e293b;">📊 BigQuery Data Analytics</strong>
            <p style="font-size:13px; margin-top:4px;">Store and analyze massive amounts of retail loss metrics and survey data to build predictive risk models in an enterprise data warehouse.</p>
          </div>
        </div>
      `
    });

    // Google Apps — Gmail, Meet, Calendar (bundled under Google account)
    systems.push({
      id: 'google-apps',
      name: 'Google Apps',
      type: 'free',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Gmail · Google Meet · Google Calendar · Free via Google account (bradley.warburton@gmail.com)',
      actionLink: 'https://mail.google.com/'
    });

    // Microsoft Teams — Free Plan
    systems.push({
      id: 'teams',
      name: 'Microsoft Teams',
      type: 'free',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Free plan · Chat, video calls, file sharing · Included with Microsoft 365 Family',
      actionLink: 'https://teams.microsoft.com/'
    });

    // Zoom — Free Plan
    systems.push({
      id: 'zoom',
      name: 'Zoom',
      type: 'free',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Free plan · 40-min group meetings · Used for client video calls',
      actionLink: 'https://zoom.us/'
    });

    // Microsoft Clarity — Free Website Analytics
    systems.push({
      id: 'clarity',
      name: 'Microsoft Clarity',
      type: 'free',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Free · Heatmaps, session recordings & visitor analytics · Used on bwadvisorysolutions.com.au · Portal has built-in engagement tracking (Engagement tab)',
      actionLink: 'https://clarity.microsoft.com/'
    });

    // LinkedIn Premium Career — 12-month via MyPCKey
    const linkedinExpiry = new Date('2027-02-26');
    const linkedinDaysLeft = Math.ceil((linkedinExpiry - new Date()) / (1000 * 60 * 60 * 24));
    const linkedinStatus = linkedinDaysLeft < 30 ? 'warning' : 'active';
    systems.push({
      id: 'linkedin',
      name: 'LinkedIn Premium',
      type: 'subscription',
      plan: 'Premium Career',
      cost: 58.96,
      currency: 'AUD',
      billingCycle: 'annual',
      purchaseDate: '2026-02-26',
      expiryDate: '2027-02-26',
      daysLeft: linkedinDaysLeft,
      status: linkedinStatus,
      lastUpdated: new Date().toISOString(),
      details: `Premium Career (Annual) · A$58.96 · Via MyPCKey · Purchased: 26/Feb/2026 · Renews: 26/Feb/2027 · ${linkedinDaysLeft} days remaining`,
      actionLink: 'https://www.linkedin.com/premium/products/'
    });

    // Grok — Free access via X account (not actively used)
    systems.push({
      id: 'grok',
      name: 'Grok (xAI)',
      type: 'free',
      status: 'active',
      lastUpdated: new Date().toISOString(),
      details: 'Free access via X account · Not actively used · Researcher to evaluate vs Claude/Gemini/ChatGPT for BW Advisory use cases',
      actionLink: 'https://grok.com/'
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, systems })
    };

  } catch (error) {
    console.error('Credits API Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Failed to fetch credits data.' })
    };
  }
};
