# BW Advisory Portal — End-to-End Testing Checklist

**Date:** 28 April 2026  
**Version:** Pre-Production Testing  
**Status:** Ready for Testing

---

## Test Environment

- **Local Dev:** http://localhost:8888
- **Internal Dashboard:** http://localhost:8888/internal/ (API key: `local-dev-key`)
- **Diagnostic Forms:** Public, no authentication required
- **Backend:** Netlify Blobs (diagnostics, portal-state stores)

---

## Testing Workflows

### Workflow 1: Diagnostic Submission → Report Generation

**Scenario:** External prospect completes Strategic Diagnostic form

**Steps:**

1. [ ] Navigate to http://localhost:8888/diagnostic.html
2. [ ] Fill out all 10 questions with realistic responses
3. [ ] Enter prospect details:
   - Name: `Test Person`
   - Email: `test@example.com` (use a real email you monitor)
   - Organisation: `Test Org`
   - Role: `Director`
4. [ ] Submit form
5. [ ] Verify success message: "Diagnostic received. Brad will review and send you a report."
6. [ ] **Check email:** Brad receives approval email to `brad@bwadvisorysolutions.com.au`
   - Subject: `[Diagnostic] Test Person — Test Org`
   - Contains: Full answers table, report preview
   - Has: Approve and Reject buttons/links
7. [ ] **Check HubSpot:** Email logged to contact record (BCC: `442934945@bcc.ap1.hubspot.com`)

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 2: Brad's Approval & Prospect Email

**Scenario:** Brad approves diagnostic, prospect receives report link

**Steps:**

1. [ ] In Brad's approval email, click "Approve" button
2. [ ] Verify redirect/confirmation page
3. [ ] **Check prospect's email** (test@example.com):
   - Subject: `Your Diagnostic Assessment — Test Org`
   - Contains: Report link with viewToken
   - Format: `/.netlify/functions/diagnostic-report-viewer?id={reportId}&token={viewToken}`
4. [ ] **Verify link structure:**
   - `reportId` is present
   - `viewToken` is unique and non-empty
   - No inline HTML (email has link only, not embedded report)
5. [ ] **Check HubSpot:** Prospect email logged to contact record

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 3: Report Viewing & Tracking Pixel

**Scenario:** Prospect opens report link, tracking pixel fires

**Steps:**

1. [ ] Click the report link from prospect email
2. [ ] **Verify report renders:**
   - Headline displays
   - Findings section visible
   - Constraints section visible
   - Priority areas visible
   - Service line alignment visible
3. [ ] **Check browser network tab:**
   - Tracking pixel fires: `/.netlify/functions/track-diagnostic-open?id={reportId}`
   - Pixel returns 1x1 GIF (status 200)
4. [ ] **Verify event logged in Blobs:**
   - Open event recorded with metadata (IP, country, browser, device, etc.)
   - Event type: `email_open`
   - Timestamp in ISO 8601 format

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 4: CTA Click Tracking & Redirect

**Scenario:** Prospect clicks "Visit BW Advisory" button, click is tracked and redirect happens

**Steps:**

1. [ ] In report, scroll to bottom
2. [ ] Click "Visit BW Advisory Solutions" CTA button
3. [ ] **Verify redirect:**
   - URL called: `/.netlify/functions/track-diagnostic-cta?id={reportId}&redirect={URL}`
   - Redirect target: `https://bwadvisorysolutions.com.au` (or whitelisted domain)
   - Status: 302 redirect
4. [ ] **Verify event logged:**
   - Click event recorded with metadata
   - Event type: `cta_click`
   - Clicked URL captured
5. [ ] **Check Blobs data:**
   - Report events array now contains both `email_open` and `cta_click` events

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 5: Brad's Internal Dashboard — Pending Approvals

**Scenario:** Brad accesses internal dashboard, sees pending diagnostics

**Steps:**

1. [ ] Navigate to http://localhost:8888/internal/
2. [ ] Login with API key: `local-dev-key`
3. [ ] **Verify main dashboard:**
   - KPI cards display (Revenue YTD, Outstanding, Pending Diagnostics, Active Clients)
   - Pipeline chart shows flow: Intakes → Diagnostics → Clients → Invoices
4. [ ] **Check Pending Approvals section:**
   - Diagnostic appears in list
   - Shows prospect name, organisation, time submitted
   - Has Approve/Reject buttons
5. [ ] Click on pending diagnostic
6. [ ] **Verify detail view:**
   - Full answer table displays
   - Report preview renders
   - Approve/Reject buttons functional

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 6: Brad's Diagnostics Dashboard — Engagement Metrics

**Scenario:** Brad sees engagement metrics for sent diagnostic

**Steps:**

1. [ ] Navigate to http://localhost:8888/internal/diagnostics.html
2. [ ] **Check Sent Diagnostics section:**
   - Shows the approved diagnostic
   - Displays: prospect name, organisation, date sent
3. [ ] Click on the diagnostic
4. [ ] **Verify engagement metrics:**
   - Opens count: `1` (from your report view)
   - Clicks count: `1` (from CTA click)
   - Time-on-page calculated (from first open to last event)
   - Device breakdown: Shows device type (desktop, tablet, mobile)
   - Browser breakdown: Shows browser name (Chrome, Safari, Firefox, Edge, Opera)
   - Country breakdown: Shows country from IP geolocation
   - Events list: Last 20 events with timestamps
5. [ ] **Verify data accuracy:**
   - All metrics match what you did (1 open, 1 click)
   - Device/browser detected correctly
   - Country matches your location

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 7: Aggregated Themes

**Scenario:** Brad sees emerging themes from diagnostic Q9/Q10 responses

**Steps:**

1. [ ] In internal dashboard or API, call: `GET /.netlify/functions/portal-dashboard-api?action=get-aggregated-themes` with API key header
2. [ ] **Verify response:**
   - Returns JSON with `themes.topThemes` array
   - Each theme has `theme` name and `mentions` count
   - Top 5 themes by mention frequency displayed
3. [ ] **In Thought Leadership Hub** (http://localhost:8888/internal/thought-leadership.html):
   - Navigate to "Emerging Themes" tab
   - Verify themes listed match API response
4. [ ] Click on a theme
5. [ ] **Verify theme interaction:**
   - Can create draft post from theme
   - Draft editor opens
   - Can add title, content, etc.

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 8: Financial Integration (Hub API)

**Scenario:** Dashboard KPIs pull invoice data from Hub Finance API

**Steps:**

1. [ ] In BW Advisory Hub (https://bwadvisoryhub.netlify.app):
   - Create a test invoice for a test client
   - Amount: AUD $5,000
   - Status: `paid`
   - Date: Today's date (within YTD)
2. [ ] Wait 2-3 seconds for sync
3. [ ] In internal dashboard, click "Refresh" button
4. [ ] **Verify KPI updates:**
   - Revenue YTD now shows $5,000 or higher
   - If invoice status is `pending` instead, Outstanding shows $5,000
5. [ ] **Check pipeline view:**
   - Invoice count updates
   - Revenue realized updates

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 9: Multiple Diagnostics & Rejection

**Scenario:** Test form submission rejection and multiple submissions

**Steps:**

1. [ ] Submit a second diagnostic (use different diagnostic type)
   - Form: http://localhost:8888/operational-diagnostic.html
   - Prospect email: `test2@example.com`
   - Name: `Test Person 2`
2. [ ] Brad receives approval email
3. [ ] **Click Reject button**
4. [ ] **Verify outcome:**
   - Prospect does NOT receive report email
   - Diagnostic status marked as `rejected` in Blobs
   - Dashboard shows diagnostic as rejected
5. [ ] **Check dashboard:**
   - Now shows multiple diagnostics in sent list
   - Can compare metrics between diagnostics

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 10: HubSpot Integration Verification

**Scenario:** All emails properly logged to HubSpot contacts

**Steps:**

1. [ ] In HubSpot, search for contact `test@example.com`
2. [ ] **Verify contact record exists with:**
   - Name populated
   - Email correct
   - Activities/timeline shows emails:
     - Brad's approval email (outbound)
     - Prospect's report email (outbound)
3. [ ] Search for contact `test2@example.com`
4. [ ] **Verify:**
   - Brad's approval email logged (even though rejected)
   - No prospect email (because rejected)
5. [ ] **Check if deals created:**
   - Note: Currently no automatic deal creation, but integration point is ready

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

### Workflow 11: Client Portal Access (Future)

**Scenario:** Existing client logs into portal (placeholder test)

**Steps:**

1. [ ] Navigate to http://localhost:8888/internal/
2. [ ] Verify login gate requires API key
3. [ ] Invalid key returns error
4. [ ] Valid key (`local-dev-key`) grants access

**Pass/Fail:** [ ] Pass [ ] Fail  
**Notes:**

---

## API Endpoint Testing

Test each endpoint directly to verify data structure:

### Endpoint: `get-dashboard-kpis`

```bash
curl -X GET "http://localhost:8888/.netlify/functions/portal-dashboard-api?action=get-dashboard-kpis" \
  -H "x-portal-api-key: local-dev-key"
```

**Expected Response:**
- `revenueYTD` (number)
- `outstanding` (number)
- `pendingDiagnostics` (number)
- `activeClients` (number)

**Pass/Fail:** [ ] Pass [ ] Fail

---

### Endpoint: `get-diagnostic-engagement`

```bash
curl -X GET "http://localhost:8888/.netlify/functions/portal-dashboard-api?action=get-diagnostic-engagement&reportId={reportId}" \
  -H "x-portal-api-key: local-dev-key"
```

**Expected Response:**
- `engagement.opens` (number)
- `engagement.clicks` (number)
- `engagement.timeOnPageSeconds` (number)
- `engagement.devices` (object)
- `engagement.browsers` (object)
- `engagement.countries` (object)
- `engagement.events` (array, last 20)

**Pass/Fail:** [ ] Pass [ ] Fail

---

### Endpoint: `get-aggregated-themes`

```bash
curl -X GET "http://localhost:8888/.netlify/functions/portal-dashboard-api?action=get-aggregated-themes" \
  -H "x-portal-api-key: local-dev-key"
```

**Expected Response:**
- `themes.topThemes` (array of objects with `theme` and `mentions`)
- `themes.diagnosticCount` (number)

**Pass/Fail:** [ ] Pass [ ] Fail

---

### Endpoint: `get-pipeline-view`

```bash
curl -X GET "http://localhost:8888/.netlify/functions/portal-dashboard-api?action=get-pipeline-view" \
  -H "x-portal-api-key: local-dev-key"
```

**Expected Response:**
- `pipeline.intakeTotal`, `intakePending`
- `pipeline.diagnosticsSubmitted`, `diagnosticsPending`, `diagnosticsSent`
- `pipeline.clientsActive`
- `pipeline.invoicesIssued`, `invoicesPending`, `invoicesPaid`
- `pipeline.revenueRealized`

**Pass/Fail:** [ ] Pass [ ] Fail

---

## Security Testing

### Test 1: Invalid API Key

```bash
curl -X GET "http://localhost:8888/internal/" \
  -H "x-portal-api-key: invalid-key"
```

**Expected:** 401 Unauthorized or login gate rejects key

**Pass/Fail:** [ ] Pass [ ] Fail

---

### Test 2: Missing viewToken on Report

```bash
curl -X GET "http://localhost:8888/.netlify/functions/diagnostic-report-viewer?id={reportId}"
```

**Expected:** 400/401 error (token required)

**Pass/Fail:** [ ] Pass [ ] Fail

---

### Test 3: Invalid Redirect URL

Navigate to:
```
http://localhost:8888/.netlify/functions/track-diagnostic-cta?id={reportId}&redirect=https://malicious.com
```

**Expected:** Redirect fails or goes to homepage (whitelist enforcement)

**Pass/Fail:** [ ] Pass [ ] Fail

---

## Known Issues & Notes

- [ ] Port 3999 conflict resolved (process 30336 killed)
- [ ] index.html deleted (old landing page removed)
- [ ] HubSpot BCC added to Brad's approval email
- [ ] Tracking pixel endpoint has no rate limiting (TODO: add Netlify rate limit)
- [ ] Session timeout not yet configured (TODO: add to /internal/)

---

## Sign-Off

| Role | Name | Date | Status |
|---|---|---|---|
| Tester | Brad Warburton | | [ ] Pass All |
| Developer | Claude | 28 April 2026 | Checklist Created |

---

**Next Steps:**
1. Run through all workflows above
2. Document any failures or unexpected behavior
3. Security architecture review
4. Integration testing with production domains
5. Deploy to production
