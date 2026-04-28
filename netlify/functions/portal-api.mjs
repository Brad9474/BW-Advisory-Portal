// portal-api.mjs — Netlify Functions v2
// BW Advisory Portal — main API
// Phase 1: add-intake, get-intakes, get-intake, update-intake-status
// Phase 2: ping, get-diagnostics, approve-diagnostic, reject-diagnostic
// Phase 3: clients, documents, invoices, portal settings

import { getStore } from '@netlify/blobs';
import { randomUUID, randomBytes, pbkdf2Sync } from 'node:crypto';

const HUBSPOT_BCC = '442934945@bcc.ap1.hubspot.com';
const BRAD_EMAIL  = 'brad@bwadvisorysolutions.com.au';
const HUBSPOT_API = 'https://api.hubapi.com';

const HUB_API_URL = process.env.HUB_API_URL || 'https://bwadvisoryhub.netlify.app/.netlify/functions/hub-api';
const HUB_API_KEY = process.env.HUB_API_KEY || '';

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

// ─── Auth ──────────────────────────────────────────────────────────────────────

function requireBradAuth(req) {
  const key      = req.headers.get('x-portal-api-key');
  const expected = process.env.BRAD_API_KEY;
  if (!expected) return { error: 'BRAD_API_KEY not configured on server' };
  if (!key || key !== expected) return { error: 'Unauthorised' };
  return null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

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

  const store   = getStore({ name: 'portal-state', consistency: 'strong' });
  const diagStore = getStore({ name: 'diagnostics',  consistency: 'strong' });
  const url     = new URL(req.url);

  // ── GET ───────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const action = url.searchParams.get('action');

    if (action === 'ping') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      return jsonResponse({ ok: true });
    }

    // ── Intakes ───────────────────────────────────────────────────────────────
    if (action === 'get-intakes') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const intakes = await load(store, 'intakes');
      intakes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse({ ok: true, intakes });
    }

    if (action === 'get-intake') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);
      const intakes = await load(store, 'intakes');
      const intake  = intakes.find(i => i.id === id);
      if (!intake) return jsonResponse({ error: 'Intake not found' }, 404);
      return jsonResponse({ ok: true, intake });
    }

    // ── Diagnostics ───────────────────────────────────────────────────────────
    if (action === 'get-diagnostics') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const submissions = await listDiagnostics(diagStore);
      submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
      return jsonResponse({ ok: true, diagnostics: submissions });
    }

    // ── Clients ───────────────────────────────────────────────────────────────
    if (action === 'get-clients') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const clients = await load(store, 'clients');
      clients.sort((a, b) => a.name.localeCompare(b.name));
      return jsonResponse({ ok: true, clients });
    }

    // ── Documents ─────────────────────────────────────────────────────────────
    if (action === 'get-documents') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const docs = await load(store, 'documents');
      docs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      return jsonResponse({ ok: true, documents: docs });
    }

    if (action === 'get-document-file') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);
      // URL-only docs (HTML) have no blob — return the URL directly
      const allDocs = await load(store, 'documents');
      const doc = allDocs.find(d => d.id === id);
      if (doc?.fileUrl) return jsonResponse({ ok: true, fileName: doc.fileName, fileType: doc.fileType, fileUrl: doc.fileUrl });
      const fileData = await store.get(`docfile_${id}`, { type: 'json' }).catch(() => null);
      if (!fileData) return jsonResponse({ error: 'File not found' }, 404);
      return jsonResponse({ ok: true, fileName: fileData.fileName, fileType: fileData.fileType, fileBase64: fileData.fileBase64 });
    }

    if (action === 'get-document-events') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const events = await load(store, 'doc_events');
      return jsonResponse({ ok: true, events });
    }

    // ── Research briefs ───────────────────────────────────────────────────────
    if (action === 'get-research-brief') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const intakeId = url.searchParams.get('intakeId');
      if (!intakeId) return jsonResponse({ error: 'Missing intakeId' }, 400);
      const data = await store.get(`research_${intakeId}`, { type: 'json' }).catch(() => null);
      if (!data) return jsonResponse({ ok: true, status: 'none' });
      return jsonResponse({ ok: true, ...data });
    }

    // ── Invoices (proxied to Finance Hub) ─────────────────────────────────────
    if (action === 'get-invoices') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const data = await hubCall({ action: 'get-state' });
      if (!data.ok) return jsonResponse({ error: data.error || 'Hub API error' }, 502);
      const invoices = (data.state?.invoices || [])
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse({ ok: true, invoices });
    }

    // ── Settings ──────────────────────────────────────────────────────────────
    if (action === 'get-settings') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const settings = await store.get('portal-settings', { type: 'json' }).catch(() => ({}));
      return jsonResponse({ ok: true, settings: settings || {} });
    }

    // ── Client portal — verify token (public, no Brad auth) ──────────────────
    if (action === 'verify-token') {
      const token = url.searchParams.get('token');
      const td    = await verifyClientToken(store, token);
      if (td.error) return jsonResponse({ error: td.error }, 401);
      const clients    = await load(store, 'clients');
      const clientRec  = clients.find(c => c.id === td.clientId);
      const hasPassword = !!(clientRec?.passwordHash);
      return jsonResponse({ ok: true, hasPassword, client: {
        id:           td.clientId,
        name:         td.clientName,
        email:        td.clientEmail,
        organisation: td.clientOrg || '',
      }});
    }

    if (action === 'verify-client-session') {
      const sessionToken = url.searchParams.get('sessionToken');
      const sd = await verifyClientSession(store, sessionToken);
      if (sd.error) return jsonResponse({ error: sd.error }, 401);
      return jsonResponse({ ok: true, client: {
        id:           sd.clientId,
        name:         sd.clientName,
        email:        sd.clientEmail,
        organisation: sd.clientOrg || '',
      }});
    }

    // ── Client portal — get documents + invoices (token auth) ────────────────
    if (action === 'get-client-data') {
      const td = await resolveClientAuth(store, url);
      if (td.error) return jsonResponse({ error: td.error }, 401);

      const allDocs = await load(store, 'documents');
      const docs    = allDocs
        .filter(d => d.clientId === td.clientId)
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

      let invoices = [];
      try {
        const hubData = await hubCall({ action: 'get-state' });
        if (hubData.ok && hubData.state?.invoices) {
          invoices = hubData.state.invoices
            .filter(inv => inv.clientId === td.clientId || inv.clientEmail === td.clientEmail)
            .map(inv => ({
              num:      inv.num,
              date:     inv.date,
              due:      inv.due,
              total:    inv.total,
              gstAmt:   inv.gstAmt,
              sub:      inv.sub,
              status:   inv.status,
              paidDate: inv.paidDate || null,
            }))
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        }
      } catch {}

      return jsonResponse({ ok: true, documents: docs, invoices });
    }

    // ── Client portal — download document (token auth) ────────────────────────
    if (action === 'get-client-document') {
      const td = await resolveClientAuth(store, url);
      if (td.error) return jsonResponse({ error: td.error }, 401);

      const docId = url.searchParams.get('docId');
      if (!docId) return jsonResponse({ error: 'Missing docId' }, 400);

      const allDocs = await load(store, 'documents');
      const doc     = allDocs.find(d => d.id === docId && d.clientId === td.clientId);
      if (!doc) return jsonResponse({ error: 'Document not found' }, 404);

      // URL-only docs (HTML) have no blob
      if (doc.fileUrl) return jsonResponse({ ok: true, fileName: doc.fileName, fileType: doc.fileType, fileUrl: doc.fileUrl });

      const fileData = await store.get(`docfile_${docId}`, { type: 'json' }).catch(() => null);
      if (!fileData) return jsonResponse({ error: 'File content not found' }, 404);

      return jsonResponse({ ok: true, fileName: fileData.fileName, fileType: fileData.fileType, fileBase64: fileData.fileBase64 });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  }

  // ── POST ──────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }

    const { action } = body;

    // ── add-intake (public) ───────────────────────────────────────────────────
    if (action === 'add-intake' || action === 'submit-intake') {
      const {
        company, contact_name, contact_email, url: website, call_datetime, industry, reason, source,
        organisation, name, email, role, objective, constraint, type, other_details, phone, country_code
      } = body;

      const finalCompany = (company || organisation || '').trim();
      const finalName = (contact_name || name || '').trim();
      const finalEmail = (contact_email || email || '').trim();
      
      let finalReason = reason || '';
      if (!finalReason && objective) {
        finalReason = `Objective: ${objective}\nConstraint: ${constraint}\nFocus: ${type === 'other' && other_details ? other_details : type}\nRole: ${role}`;
        if (phone) finalReason += `\nPhone: ${country_code} ${phone}`;
      }

      if (!finalCompany || !finalName || !finalEmail || !finalReason.trim()) {
        return jsonResponse({ error: 'Missing required fields' }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) {
        return jsonResponse({ error: 'Invalid email address' }, 400);
      }

      const intake = {
        id:            `intake_${Date.now()}_${randomUUID().slice(0, 8)}`,
        company:       finalCompany,
        contact_name:  finalName,
        contact_email: finalEmail,
        url:           website?.trim() || null,
        call_datetime: call_datetime?.trim() || null,
        industry:      industry?.trim() || null,
        reason:        finalReason.trim(),
        source:        source || (action === 'submit-intake' ? 'website-form' : 'manual'),
        status:        'pending',
        createdAt:     new Date().toISOString(),
      };

      try {
        const intakes = await load(store, 'intakes');
        intakes.push(intake);
        await store.setJSON('intakes', intakes);
      } catch (e) {
        return jsonResponse({ error: 'Failed to store intake', detail: e.message }, 500);
      }

      notifyBradIntake(intake).catch(e => console.error('Brad notification failed:', e.message));
      createHubSpotRecord(intake).catch(e => console.error('HubSpot sync failed:', e.message));
      return jsonResponse({ ok: true, id: intake.id });
    }

    // ── update-intake-status (internal) ──────────────────────────────────────
    if (action === 'update-intake-status') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { id, status } = body;
      if (!id || !status) return jsonResponse({ error: 'Missing id or status' }, 400);
      const allowed = ['pending', 'researched', 'called', 'converted', 'dismissed'];
      if (!allowed.includes(status)) return jsonResponse({ error: `Invalid status` }, 400);
      try {
        const intakes = await load(store, 'intakes');
        const idx = intakes.findIndex(i => i.id === id);
        if (idx === -1) return jsonResponse({ error: 'Intake not found' }, 404);
        intakes[idx].status    = status;
        intakes[idx].updatedAt = new Date().toISOString();
        await store.setJSON('intakes', intakes);
        return jsonResponse({ ok: true, intake: intakes[idx] });
      } catch (e) {
        return jsonResponse({ error: 'Failed to update intake', detail: e.message }, 500);
      }
    }

    // ── approve-diagnostic (internal) ─────────────────────────────────────────
    if (action === 'approve-diagnostic') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { id } = body;
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);
      let sub;
      try { sub = await diagStore.get(`sub_${id}`, { type: 'json' }); }
      catch (e) { return jsonResponse({ error: 'Failed to load submission', detail: e.message }, 500); }
      if (!sub) return jsonResponse({ error: 'Submission not found' }, 404);
      if (sub.status === 'sent')     return jsonResponse({ error: 'Already sent', sentAt: sub.sentAt }, 409);
      if (sub.status === 'rejected') return jsonResponse({ error: 'Previously rejected' }, 409);
      try {
        await sendProspectEmail(sub);
        sub.status = 'sent';
        sub.sentAt = new Date().toISOString();
        await diagStore.setJSON(`sub_${id}`, sub);
        return jsonResponse({ ok: true, sentAt: sub.sentAt });
      } catch (e) {
        return jsonResponse({ error: 'Failed to send report email', detail: e.message }, 500);
      }
    }

    // ── archive-diagnostic (internal) ─────────────────────────────────────────
    if (action === 'archive-diagnostic') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { id } = body;
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);
      let sub;
      try { sub = await diagStore.get(`sub_${id}`, { type: 'json' }); }
      catch (e) { return jsonResponse({ error: 'Failed to load submission', detail: e.message }, 500); }
      if (!sub) return jsonResponse({ error: 'Submission not found' }, 404);
      sub.status     = 'archived';
      sub.archivedAt = new Date().toISOString();
      try {
        await diagStore.setJSON(`sub_${id}`, sub);
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: 'Failed to archive submission', detail: e.message }, 500);
      }
    }

    // ── delete-diagnostic (internal) ──────────────────────────────────────────
    if (action === 'delete-diagnostic') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { id } = body;
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);
      try {
        await diagStore.delete(`sub_${id}`);
        // Also remove token mapping if it exists
        const sub = await diagStore.get(`sub_${id}`, { type: 'json' }).catch(() => null);
        if (sub?.token) await diagStore.delete(`tok_${sub.token}`).catch(() => {});
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: 'Failed to delete submission', detail: e.message }, 500);
      }
    }

    // ── reject-diagnostic (internal) ──────────────────────────────────────────
    if (action === 'reject-diagnostic') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { id } = body;
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);
      let sub;
      try { sub = await diagStore.get(`sub_${id}`, { type: 'json' }); }
      catch (e) { return jsonResponse({ error: 'Failed to load submission', detail: e.message }, 500); }
      if (!sub) return jsonResponse({ error: 'Submission not found' }, 404);
      if (sub.status !== 'pending') return jsonResponse({ error: `Already ${sub.status}` }, 409);
      sub.status     = 'rejected';
      sub.rejectedAt = new Date().toISOString();
      try {
        await diagStore.setJSON(`sub_${id}`, sub);
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: 'Failed to update submission', detail: e.message }, 500);
      }
    }

    // ── add-client (internal) ─────────────────────────────────────────────────
    if (action === 'add-client') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { name, email, organisation, sector } = body;
      if (!name?.trim() || !email?.trim()) {
        return jsonResponse({ error: 'name and email are required' }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse({ error: 'Invalid email address' }, 400);
      }
      const client = {
        id:           `client_${Date.now()}_${randomUUID().slice(0, 8)}`,
        name:         name.trim(),
        email:        email.trim(),
        organisation: organisation?.trim() || null,
        sector:       sector?.trim() || null,
        status:       'active',
        createdAt:    new Date().toISOString(),
      };
      try {
        const clients = await load(store, 'clients');
        clients.push(client);
        await store.setJSON('clients', clients);
        return jsonResponse({ ok: true, client });
      } catch (e) {
        return jsonResponse({ error: 'Failed to store client', detail: e.message }, 500);
      }
    }

    // ── update-client (internal) ──────────────────────────────────────────────
    if (action === 'update-client') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { id, status } = body;
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);
      const allowed = ['active', 'inactive', 'archived'];
      if (status && !allowed.includes(status)) return jsonResponse({ error: 'Invalid status' }, 400);
      try {
        const clients = await load(store, 'clients');
        const idx = clients.findIndex(c => c.id === id);
        if (idx === -1) return jsonResponse({ error: 'Client not found' }, 404);
        if (status) clients[idx].status = status;
        clients[idx].updatedAt = new Date().toISOString();
        await store.setJSON('clients', clients);
        return jsonResponse({ ok: true, client: clients[idx] });
      } catch (e) {
        return jsonResponse({ error: 'Failed to update client', detail: e.message }, 500);
      }
    }

    // ── delete-client (internal) ──────────────────────────────────────────────
    if (action === 'delete-client') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { id } = body;
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);
      try {
        const clients = await load(store, 'clients');
        const filtered = clients.filter(c => c.id !== id);
        if (filtered.length === clients.length) return jsonResponse({ error: 'Client not found' }, 404);
        await store.setJSON('clients', filtered);
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: 'Failed to delete client', detail: e.message }, 500);
      }
    }

    // ── delete-document (internal) ────────────────────────────────────────────
    if (action === 'delete-document') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { id } = body;
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);
      const docs = await load(store, 'documents');
      const idx  = docs.findIndex(d => d.id === id);
      if (idx === -1) return jsonResponse({ error: 'Document not found' }, 404);
      docs.splice(idx, 1);
      await store.setJSON('documents', docs);
      await store.delete(`docfile_${id}`).catch(() => {});
      await store.delete(`htmlfile_${id}`).catch(() => {});
      return jsonResponse({ ok: true });
    }

    // ── add-document (internal) ───────────────────────────────────────────────
    if (action === 'add-document') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { clientId, clientName, clientEmail, fileName, fileType, fileBase64, sizeBytes, coverMessage } = body;
      if (!clientId || !fileName || !fileBase64) {
        return jsonResponse({ error: 'clientId, fileName, and fileBase64 are required' }, 400);
      }
      // HTML: store content directly in Blobs, auto-generate a public view URL
      if (fileType === 'text/html' || fileName?.match(/\.html?$/i)) {
        const docId      = `doc_${Date.now()}_${randomUUID().slice(0, 8)}`;
        const htmlContent = Buffer.from(fileBase64, 'base64').toString('utf-8');
        await store.set(`htmlfile_${docId}`, htmlContent);
        const host    = req.headers.get('x-forwarded-host') || 'portal.bwadvisorysolutions.com.au';
        const fileUrl = `https://${host}/.netlify/functions/view-doc?id=${docId}`;
        const doc = {
          id:           docId,
          clientId,
          clientName:   clientName || '',
          clientEmail:  clientEmail || '',
          fileName,
          fileType:     'text/html',
          fileUrl,
          sizeBytes:    sizeBytes || 0,
          coverMessage: coverMessage || '',
          uploadedAt:   new Date().toISOString(),
          sentAt:       null,
          status:       'uploaded',
        };
        const docs = await load(store, 'documents');
        docs.push(doc);
        await store.setJSON('documents', docs);
        return jsonResponse({ ok: true, document: doc });
      }
      // 4MB base64 limit (~3MB file)
      if (fileBase64.length > 5_600_000) {
        return jsonResponse({ error: 'File too large. Maximum size is approximately 4 MB.' }, 413);
      }
      const docId = `doc_${Date.now()}_${randomUUID().slice(0, 8)}`;
      try {
        // Store file content separately
        await store.setJSON(`docfile_${docId}`, { fileName, fileType, fileBase64, sizeBytes });
        // Store metadata in documents array
        const doc = {
          id:           docId,
          clientId,
          clientName:   clientName || '',
          clientEmail:  clientEmail || '',
          fileName,
          fileType,
          sizeBytes:    sizeBytes || 0,
          coverMessage: coverMessage || '',
          uploadedAt:   new Date().toISOString(),
          sentAt:       null,
          status:       'uploaded',
        };
        const docs = await load(store, 'documents');
        docs.push(doc);
        await store.setJSON('documents', docs);
        return jsonResponse({ ok: true, document: doc });
      } catch (e) {
        return jsonResponse({ error: 'Failed to store document', detail: e.message }, 500);
      }
    }

    // ── send-document (internal) ──────────────────────────────────────────────
    if (action === 'send-document') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { id, message: customMessage } = body;
      if (!id) return jsonResponse({ error: 'Missing id' }, 400);

      const docs = await load(store, 'documents');
      const docIdx = docs.findIndex(d => d.id === id);
      if (docIdx === -1) return jsonResponse({ error: 'Document not found' }, 404);
      const doc = docs[docIdx];

      try {
        if (doc.fileUrl) {
          // HTML doc — send a link, no attachment
          await sendDocumentLinkEmail(doc, customMessage);
          // Stamp expiry (30 days) and view cap on the doc record
          docs[docIdx].expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          docs[docIdx].maxViews  = 50;
        } else {
          const fileData = await store.get(`docfile_${id}`, { type: 'json' }).catch(() => null);
          if (!fileData) return jsonResponse({ error: 'File content missing' }, 404);
          await sendDocumentEmail(doc, fileData, customMessage);
        }
        docs[docIdx].status = 'sent';
        docs[docIdx].sentAt = new Date().toISOString();
        await store.setJSON('documents', docs);
        return jsonResponse({ ok: true, sentAt: docs[docIdx].sentAt });
      } catch (e) {
        return jsonResponse({ error: 'Failed to send document', detail: e.message }, 500);
      }
    }

    // ── track-document-event (client portal, token-auth) ─────────────────────
    if (action === 'track-document-event') {
      const { token, sessionToken, docId, type: evtType, sessionId, durationSeconds, userAgent } = body;

      const td = token
        ? await verifyClientToken(store, token)
        : await verifyClientSession(store, sessionToken);
      if (td.error) return jsonResponse({ error: td.error }, 401);

      // Validate required fields
      if (!docId) return jsonResponse({ error: 'Missing docId' }, 400);
      const allowedTypes = ['download', 'preview_open', 'preview_close', 'pay_now', 'scroll_depth', 'link_click', 'email_open'];
      if (!allowedTypes.includes(evtType)) return jsonResponse({ error: 'Invalid event type' }, 400);
      if (!sessionId || !/^ses_[\w]+$/.test(sessionId)) return jsonResponse({ error: 'Invalid sessionId' }, 400);

      // Clamp durationSeconds
      let duration = null;
      if (durationSeconds !== undefined && durationSeconds !== null) {
        const n = Number(durationSeconds);
        if (!isNaN(n) && n >= 0) duration = Math.min(Math.round(n), 86400);
      }

      // Verify document belongs to this client
      const allDocs = await load(store, 'documents');
      const docOwned = allDocs.find(d => d.id === docId && d.clientId === td.clientId);
      if (!docOwned) return jsonResponse({ error: 'Document not found' }, 403);

      const ipAddress  = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
      const country    = req.headers.get('x-country') || null;

      const event = {
        eventId:         `evt_${Date.now()}_${randomUUID().slice(0, 8)}`,
        docId,
        clientId:        td.clientId,
        clientName:      td.clientName,
        clientEmail:     td.clientEmail,
        type:            evtType,
        durationSeconds: duration,
        scrollDepthPct:  body.scrollDepthPct != null ? Math.min(100, Math.max(0, Math.round(Number(body.scrollDepthPct)))) : null,
        linkUrl:         body.linkUrl ? String(body.linkUrl).slice(0, 300) : null,
        timestamp:       new Date().toISOString(),
        sessionId,
        userAgent:       String(userAgent || '').slice(0, 200),
        ipAddress,
        country,
      };

      // Append event — swallow write errors so tracking never blocks the client
      try {
        const events = await load(store, 'doc_events');
        events.push(event);
        await store.setJSON('doc_events', events);
      } catch (e) {
        console.error('doc_events write failed:', e.message);
      }

      return jsonResponse({ ok: true });
    }

    // ── track-public-document-event (public, via view-doc HTML) ───────────────
    if (action === 'track-public-document-event') {
      const { docId, type: evtType, sessionId, durationSeconds, userAgent } = body;
      if (!docId) return jsonResponse({ error: 'Missing docId' }, 400);

      const allowedTypes2 = ['preview_open', 'preview_close', 'download', 'pay_now', 'scroll_depth', 'link_click', 'email_open'];
      if (!allowedTypes2.includes(evtType)) return jsonResponse({ error: 'Invalid event type' }, 400);

      let duration = null;
      if (durationSeconds !== undefined && durationSeconds !== null) {
        const n = Number(durationSeconds);
        if (!isNaN(n) && n >= 0) duration = Math.min(Math.round(n), 86400);
      }

      const allDocs = await load(store, 'documents');
      const doc = allDocs.find(d => d.id === docId);
      if (!doc) return jsonResponse({ error: 'Document not found' }, 403);

      const ipAddress2  = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
      const country2    = req.headers.get('x-country') || null;

      const event2 = {
        eventId:         `evt_${Date.now()}_${randomUUID().slice(0, 8)}`,
        docId,
        clientId:        doc.clientId,
        clientName:      doc.clientName,
        clientEmail:     doc.clientEmail,
        type:            evtType,
        durationSeconds: duration,
        scrollDepthPct:  body.scrollDepthPct != null ? Math.min(100, Math.max(0, Math.round(Number(body.scrollDepthPct)))) : null,
        linkUrl:         body.linkUrl ? String(body.linkUrl).slice(0, 300) : null,
        timestamp:       new Date().toISOString(),
        sessionId:       sessionId || `ses_public_${Date.now()}`,
        userAgent:       String(userAgent || '').slice(0, 200),
        ipAddress:       ipAddress2,
        country:         country2,
      };

      try {
        const events2 = await load(store, 'doc_events');

        // ── First-open alert: email Brad when a document is opened for the first time ──
        if (evtType === 'preview_open') {
          const priorOpens = events2.filter(e => e.docId === docId && e.type === 'preview_open').length;
          if (priorOpens === 0) {
            notifyBradDocOpen(doc).catch(err => console.error('first-open alert failed:', err.message));
          }
        }

        events2.push(event2);
        await store.setJSON('doc_events', events2);
      } catch (e) {
        console.error('doc_events write failed:', e.message);
      }

      return jsonResponse({ ok: true });
    }

    // ── add-invoice (proxied to Finance Hub) ─────────────────────────────────
    if (action === 'add-invoice') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { clientId, clientName, clientEmail, clientAddr, items, gstRate,
              date, due, notes, paymentMode } = body;
      if (!clientName || !items?.length || !date || !due) {
        return jsonResponse({ error: 'Missing required invoice fields' }, 400);
      }

      // Load Hub state for nextInvNum and payment profile
      const stateData = await hubCall({ action: 'get-state' });
      if (!stateData.ok) return jsonResponse({ error: 'Failed to read Hub state' }, 502);
      const hubState = stateData.state || {};
      const nextNum  = typeof hubState.nextInvNum === 'number' ? hubState.nextInvNum : 1;
      const profile  = hubState.profile || {};

      const year   = new Date().getFullYear();
      const num    = `INV-${year}-${String(nextNum).padStart(3, '0')}`;
      const sub    = items.reduce((t, i) => t + (i.qty * i.price), 0);
      const rate   = typeof gstRate === 'number' ? gstRate : 0.1;
      const gstAmt = Math.round(sub * rate * 100) / 100;
      const total  = Math.round((sub + gstAmt) * 100) / 100;

      const invoice = {
        num,
        date,
        due,
        clientId:         clientId || '',
        client:           clientName,
        clientEmail:      clientEmail || '',
        addr:             clientAddr || '',
        items,
        gstRate:          rate,
        sub:              Math.round(sub * 100) / 100,
        gstAmt,
        total,
        paymentMode:      paymentMode || 'both',
        // Payment details — loaded from Hub profile
        bankName:         profile.bankName    || 'BW Advisory Solutions',
        bankBSB:          profile.bankBSB     || '036069',
        bankAccount:      profile.bankAccount || '467404',
        bankPayID:        profile.bankPayID   || '11892244979',
        wiseName:         profile.wiseName    || 'BW Advisory Solutions',
        wiseBank:         profile.wiseBank    || 'Wise Payments Ltd. \u2014 New Zealand Branch',
        wiseAccount:      profile.wiseAccount || '04-2021-0402438-11',
        wiseSwift:        profile.wiseSwift   || 'TRWINZ21XXX',
        wiseRouting:      profile.wiseRouting || '',
        wiseCurrency:     profile.wiseCurrency|| 'NZD',
        fxEnabled:        false,
        onlinePayEnabled: true,
        wisePaymentLink:  'https://wise.com/pay/business/bwadvisorysolutions?utm_source=open_link',
        ccRate:           0.035,
        notes:            notes || '',
        status:           'due',
        createdAt:        new Date().toISOString(),
      };

      const result = await hubCall({ action: 'add-invoice', invoice });
      if (!result.ok) return jsonResponse({ error: result.error || 'Hub API error' }, 502);
      return jsonResponse({ ok: true, invoice, num });
    }

    // ── mark-invoice-paid (proxied to Finance Hub) ────────────────────────────
    if (action === 'mark-invoice-paid') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { num, paymentMode, paidAt } = body;
      if (!num) return jsonResponse({ error: 'Missing num' }, 400);
      const paidDate = paidAt
        ? new Date(paidAt).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      const result = await hubCall({
        action: 'mark-paid',
        num,
        paidDate,
        paymentMethod: paymentMode || '',
      });
      if (!result.ok) return jsonResponse({ error: result.error || 'Hub API error' }, 502);
      return jsonResponse({ ok: true, invoice: result.invoice });
    }

    // ── save-settings (internal) ──────────────────────────────────────────────
    if (action === 'save-settings') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { settings } = body;
      if (!settings || typeof settings !== 'object') {
        return jsonResponse({ error: 'Missing settings object' }, 400);
      }
      try {
        await store.setJSON('portal-settings', settings);
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: 'Failed to save settings', detail: e.message }, 500);
      }
    }

    // ── send-magic-link (internal) ────────────────────────────────────────────
    if (action === 'send-magic-link') {
      const authErr = requireBradAuth(req);
      if (authErr) return jsonResponse(authErr, 401);
      const { clientId } = body;
      if (!clientId) return jsonResponse({ error: 'Missing clientId' }, 400);

      const clients = await load(store, 'clients');
      const client  = clients.find(c => c.id === clientId);
      if (!client) return jsonResponse({ error: 'Client not found' }, 404);

      // 64-char token — two UUIDs concatenated, hyphens stripped
      const token     = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await store.setJSON(`magic_${token}`, {
        clientId:    client.id,
        clientEmail: client.email,
        clientName:  client.name,
        clientOrg:   client.organisation || '',
        expiresAt,
        createdAt:   new Date().toISOString(),
      });

      const origin = process.env.PORTAL_ORIGIN || 'https://portal.bwadvisorysolutions.com.au';
      const link   = `${origin}/client/setup.html?token=${token}`;

      let emailSent = false;
      try {
        const { t, smtpUser } = await makeTransporter();
        await t.sendMail({
          from:    `"BW Advisory Solutions" <${smtpUser}>`,
          to:      client.email,
          bcc:     HUBSPOT_BCC,
          subject: 'Your BW Advisory Client Portal — Secure Access Link',
          html:    magicLinkEmailHtml(client, link, expiresAt),
        });
        emailSent = true;
      } catch (e) {
        console.error('Magic link email failed:', e.message);
      }

      return jsonResponse({ ok: true, link, emailSent });
    }

    // ── setup-client-password (public — magic link token required) ────────────
    if (action === 'setup-client-password') {
      const { token, password } = body;
      if (!token || !password) return jsonResponse({ error: 'Missing token or password' }, 400);
      if (password.length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);

      const td = await verifyClientToken(store, token);
      if (td.error) return jsonResponse({ error: td.error }, 401);

      const clients = await load(store, 'clients');
      const idx     = clients.findIndex(c => c.id === td.clientId);
      if (idx === -1) return jsonResponse({ error: 'Client record not found' }, 404);

      clients[idx].passwordHash = hashPassword(password);
      clients[idx].updatedAt    = new Date().toISOString();
      await store.setJSON('clients', clients);

      const { sessionToken, expiresAt } = await createClientSession(store, td.clientId, td.clientEmail, td.clientName, td.clientOrg);
      return jsonResponse({ ok: true, sessionToken, expiresAt, client: {
        id: td.clientId, name: td.clientName, email: td.clientEmail, organisation: td.clientOrg || '',
      }});
    }

    // ── client-login (public — email + password) ──────────────────────────────
    if (action === 'client-login') {
      const { email, password } = body;
      if (!email || !password) return jsonResponse({ error: 'Missing email or password' }, 400);

      const clients  = await load(store, 'clients');
      const clientRec = clients.find(c => c.email?.toLowerCase() === email.toLowerCase().trim());

      // Constant-time response to prevent email enumeration
      if (!clientRec || !clientRec.passwordHash) {
        pbkdf2Sync(password, 'dummy_salt_bwadvisory', 100000, 64, 'sha512');
        return jsonResponse({ error: 'Invalid email or password' }, 401);
      }
      if (!verifyPassword(password, clientRec.passwordHash)) {
        return jsonResponse({ error: 'Invalid email or password' }, 401);
      }

      const { sessionToken, expiresAt } = await createClientSession(store, clientRec.id, clientRec.email, clientRec.name, clientRec.organisation || '');
      return jsonResponse({ ok: true, sessionToken, expiresAt, client: {
        id: clientRec.id, name: clientRec.name, email: clientRec.email, organisation: clientRec.organisation || '',
      }});
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hubCall(body) {
  const res = await fetch(HUB_API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-api-key': HUB_API_KEY },
    body:    JSON.stringify(body),
  });
  return res.json();
}

async function load(store, key) {
  try {
    const data = await store.get(key, { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function listDiagnostics(store) {
  try {
    const { blobs } = await store.list({ prefix: 'sub_' });
    const results = await Promise.all(
      blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null))
    );
    return results.filter(Boolean);
  } catch { return []; }
}

function getTransport() {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) throw new Error('SMTP credentials not configured');
  return { smtpUser, smtpPass };
}

async function makeTransporter() {
  const { smtpUser, smtpPass } = getTransport();
  const { default: nodemailer } = await import('nodemailer');
  return {
    t: nodemailer.createTransport({
      host: 'smtp.protonmail.ch', port: 587, secure: false,
      auth: { user: smtpUser, pass: smtpPass },
      tls: { rejectUnauthorized: true },
    }),
    smtpUser,
  };
}

async function sendProspectEmail(submission) {
  const { t, smtpUser } = await makeTransporter();
  await t.sendMail({
    from:    `"BW Advisory Solutions" <${smtpUser}>`,
    to:      submission.prospect.email,
    bcc:     HUBSPOT_BCC,
    subject: `Your Strategic Diagnostic Assessment — ${submission.prospect.organisation}`,
    html:    submission.report.html,
  });
}

async function sendDocumentEmail(doc, fileData, customMessage) {
  const { t, smtpUser } = await makeTransporter();
  const body = customMessage?.trim()
    || `Please find attached a document from BW Advisory Solutions: ${doc.fileName}`;

  const htmlBody = `<!DOCTYPE html>
<html><body style="font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#1a1a2e;max-width:620px;margin:0 auto;padding:24px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#0A1C42;padding:24px 36px;">
    <div style="color:#fff;font-size:15px;font-weight:700;">BW Advisory Solutions</div>
    <div style="color:#EBF3FA;font-size:12px;margin-top:2px;">bwadvisorysolutions.com.au</div>
  </td></tr>
  <tr><td style="padding:32px 36px;">
    <p style="font-size:15px;color:#2c2c3e;line-height:1.7;margin-bottom:20px;">${escHtml(body).replace(/\n/g, '<br>')}</p>
    <div style="background:#f9fbfd;border:1px solid #eef0f5;border-radius:6px;padding:14px 18px;font-size:13px;color:#555;">
      <strong>${escHtml(doc.fileName)}</strong><br>
      ${doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(0)} KB` : ''}
    </div>
  </td></tr>
  <tr><td style="background:#0A1C42;padding:20px 36px;">
    <div style="color:#fff;font-size:13px;font-weight:700;">Brad Warburton</div>
    <div style="color:#EBF3FA;font-size:12px;line-height:1.8;">BW Advisory Solutions<br>
    brad@bwadvisorysolutions.com.au &nbsp;·&nbsp; +61 407 779 474<br>bwadvisorysolutions.com.au</div>
  </td></tr>
</table>
</body></html>`;

  const attachment = {
    filename:    doc.fileName,
    content:     fileData.fileBase64,
    encoding:    'base64',
    contentType: fileData.fileType || 'application/octet-stream',
  };

  await t.sendMail({
    from:        `"BW Advisory Solutions" <${smtpUser}>`,
    to:          doc.clientEmail,
    bcc:         HUBSPOT_BCC,
    subject:     `${doc.fileName} — BW Advisory Solutions`,
    html:        htmlBody,
    attachments: [attachment],
  });
}

async function sendDocumentLinkEmail(doc, customMessage) {
  const { t, smtpUser } = await makeTransporter();
  const body = customMessage?.trim()
    || `Please find your document from BW Advisory Solutions: ${doc.fileName}`;

  const pixelUrl = `https://portal.bwadvisorysolutions.com.au/.netlify/functions/track-email-open?id=${encodeURIComponent(doc.id)}`;

  const htmlBody = `<!DOCTYPE html>
<html><body style="font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#1a1a2e;max-width:620px;margin:0 auto;padding:24px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#0A1C42;padding:24px 36px;">
    <div style="color:#fff;font-size:15px;font-weight:700;">BW Advisory Solutions</div>
    <div style="color:#EBF3FA;font-size:12px;margin-top:2px;">bwadvisorysolutions.com.au</div>
  </td></tr>
  <tr><td style="padding:32px 36px;">
    <p style="font-size:15px;color:#2c2c3e;line-height:1.7;margin-bottom:20px;">${escHtml(body).replace(/\n/g, '<br>')}</p>
    <div style="margin:24px 0;">
      <a href="${doc.fileUrl}" style="display:inline-block;background:#1B6EC2;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:700;">View Document</a>
    </div>
    <div style="font-size:12px;color:#9aaabb;margin-top:8px;">
      Or copy this link: <a href="${doc.fileUrl}" style="color:#1B6EC2;">${doc.fileUrl}</a>
    </div>
  </td></tr>
  <tr><td style="background:#0A1C42;padding:20px 36px;">
    <div style="color:#fff;font-size:13px;font-weight:700;">Brad Warburton</div>
    <div style="color:#EBF3FA;font-size:12px;line-height:1.8;">BW Advisory Solutions<br>
    brad@bwadvisorysolutions.com.au &nbsp;·&nbsp; +61 407 779 474<br>bwadvisorysolutions.com.au</div>
  </td></tr>
</table>
<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;outline:0;" alt="">
</body></html>`;

  await t.sendMail({
    from:    `"BW Advisory Solutions" <${smtpUser}>`,
    to:      doc.clientEmail,
    bcc:     HUBSPOT_BCC,
    subject: `${doc.fileName} — BW Advisory Solutions`,
    html:    htmlBody,
  });
}

async function notifyBradIntake(intake) {
  let t, smtpUser;
  try { ({ t, smtpUser } = await makeTransporter()); }
  catch { return; }

  const callDt = intake.call_datetime
    ? (() => { try { return new Date(intake.call_datetime).toLocaleString('en-AU', {
        timeZone: 'Australia/Perth', day: 'numeric', month: 'long',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
      }) + ' AWST'; } catch { return intake.call_datetime; } })()
    : intake.call_datetime;

  const e = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  await t.sendMail({
    from:    `"BW Advisory Portal" <${smtpUser}>`,
    to:      BRAD_EMAIL,
    bcc:     HUBSPOT_BCC,
    subject: `[Intake] ${intake.contact_name} — ${intake.company}`,
    html: `<!DOCTYPE html><html><body style="font-family:Calibri,'Segoe UI',Arial,sans-serif;max-width:660px;margin:0 auto;background:#f5f7fa;padding:24px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:660px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#0A1C42;padding:24px 36px;"><div style="color:#fff;font-size:15px;font-weight:700;">BW Advisory Solutions</div><div style="color:#EBF3FA;font-size:12px;margin-top:2px;">New Discovery Call Request</div></td></tr>
  <tr><td style="background:#EBF3FA;padding:20px 36px;border-left:4px solid #1B6EC2;">
    <div style="font-size:18px;font-weight:700;color:#0A1C42;">${e(intake.contact_name)}</div>
    <div style="font-size:14px;color:#555;margin-top:2px;">${e(intake.company)}${intake.industry ? ' · ' + e(intake.industry) : ''}</div>
    <div style="font-size:13px;color:#1B6EC2;margin-top:2px;">${e(intake.contact_email)}</div>
  </td></tr>
  <tr><td style="padding:28px 36px;">
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f5;border-radius:4px;overflow:hidden;">
      <tr><td style="padding:10px 14px;font-size:12px;font-weight:700;color:#666;text-transform:uppercase;width:38%;border-bottom:1px solid #eef0f5;">Call Time</td><td style="padding:10px 14px;font-size:14px;font-weight:600;border-bottom:1px solid #eef0f5;">${e(callDt)}</td></tr>
      <tr><td style="padding:10px 14px;font-size:12px;font-weight:700;color:#666;text-transform:uppercase;vertical-align:top;">Discussion</td><td style="padding:10px 14px;font-size:14px;line-height:1.6;">${e(intake.reason)}</td></tr>
    </table>
  </td></tr>
</table></body></html>`,
  });
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function notifyBradDocOpen(doc) {
  let t, smtpUser;
  try { ({ t, smtpUser } = await makeTransporter()); }
  catch { return; }

  const e = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  await t.sendMail({
    from:    `"BW Advisory Portal" <${smtpUser}>`,
    to:      BRAD_EMAIL,
    subject: `[Doc Opened] ${doc.fileName} — ${doc.clientName}`,
    html: `<!DOCTYPE html><html><body style="font-family:Calibri,'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f7fa;padding:24px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#0A1C42;padding:20px 32px;">
    <div style="color:#fff;font-size:14px;font-weight:700;">BW Advisory Solutions</div>
    <div style="color:#EBF3FA;font-size:11px;margin-top:2px;">Document Activity Alert</div>
  </td></tr>
  <tr><td style="background:#EBF3FA;padding:16px 32px;border-left:4px solid #1B6EC2;">
    <div style="font-size:16px;font-weight:700;color:#0A1C42;">${e(doc.clientName)} has opened a document</div>
    <div style="font-size:13px;color:#555;margin-top:4px;">${e(doc.clientEmail)}</div>
  </td></tr>
  <tr><td style="padding:24px 32px;">
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f5;border-radius:4px;overflow:hidden;font-size:13px;">
      <tr><td style="padding:10px 14px;font-weight:700;color:#666;text-transform:uppercase;font-size:11px;width:35%;border-bottom:1px solid #eef0f5;">Document</td><td style="padding:10px 14px;border-bottom:1px solid #eef0f5;">${e(doc.fileName)}</td></tr>
      <tr><td style="padding:10px 14px;font-weight:700;color:#666;text-transform:uppercase;font-size:11px;">First Opened</td><td style="padding:10px 14px;">${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Perth', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })} AWST</td></tr>
    </table>
    <p style="font-size:12px;color:#9aaabb;margin-top:16px;">This is the first time this document has been opened. No further alerts will be sent for subsequent views.</p>
  </td></tr>
</table>
</body></html>`,
  });
}

// ── Client portal helpers ─────────────────────────────────────────────────────

async function verifyClientToken(store, token) {
  if (!token) return { error: 'Missing token' };
  let data;
  try { data = await store.get(`magic_${token}`, { type: 'json' }); }
  catch { return { error: 'Invalid or expired link' }; }
  if (!data) return { error: 'Invalid or expired link' };
  if (new Date(data.expiresAt) < new Date()) return { error: 'This link has expired. Please contact brad@bwadvisorysolutions.com.au to request a new one.' };
  return {
    clientId:    data.clientId,
    clientEmail: data.clientEmail,
    clientName:  data.clientName,
    clientOrg:   data.clientOrg || '',
  };
}

async function verifyClientSession(store, sessionToken) {
  if (!sessionToken) return { error: 'Missing session token' };
  let sd;
  try { sd = await store.get(`session_${sessionToken}`, { type: 'json' }); }
  catch { return { error: 'Invalid session' }; }
  if (!sd) return { error: 'Invalid session' };
  if (new Date(sd.expiresAt) < new Date()) return { error: 'Your session has expired. Please sign in again.' };
  return { clientId: sd.clientId, clientEmail: sd.clientEmail, clientName: sd.clientName, clientOrg: sd.clientOrg || '' };
}

async function resolveClientAuth(store, url) {
  const sessionToken = url.searchParams.get('sessionToken');
  if (sessionToken) return verifyClientSession(store, sessionToken);
  return verifyClientToken(store, url.searchParams.get('token'));
}

async function createClientSession(store, clientId, clientEmail, clientName, clientOrg) {
  const sessionToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await store.setJSON(`session_${sessionToken}`, { clientId, clientEmail, clientName, clientOrg: clientOrg || '', expiresAt, createdAt: new Date().toISOString() });
  return { sessionToken, expiresAt };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return attempt === hash;
}

// ── HubSpot integration ───────────────────────────────────────────────────────

async function createHubSpotRecord(intake) {
  const hsKey = process.env.HUBSPOT_API_KEY;
  if (!hsKey) { console.error('HUBSPOT_API_KEY not set'); return; }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${hsKey}`,
  };

  // 1. Search for existing contact by email
  let contactId;
  try {
    const searchRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: 'email', operator: 'EQ', value: intake.contact_email }],
        }],
      }),
    });
    const searchData = await searchRes.json();
    if (searchData.results?.length > 0) {
      contactId = searchData.results[0].id;
    }
  } catch (e) { console.error('HubSpot contact search failed:', e.message); }

  // 2. Create contact if not found
  if (!contactId) {
    try {
      const nameParts = intake.contact_name.trim().split(/\s+/);
      const firstname = nameParts[0] || '';
      const lastname  = nameParts.slice(1).join(' ') || '';
      const createRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            firstname,
            lastname,
            email:           intake.contact_email,
            company:         intake.company,
            website:         intake.url || '',
            industry:        intake.industry || '',
            hs_lead_source: 'OTHER',
          },
        }),
      });
      const createData = await createRes.json();
      if (createData.id) contactId = createData.id;
      else console.error('HubSpot contact create failed:', JSON.stringify(createData));
    } catch (e) { console.error('HubSpot contact create error:', e.message); }
  }

  if (!contactId) return; // can't proceed without a contact

  // 3. Create deal
  let dealId;
  try {
    const dealRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/deals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        properties: {
          dealname:    `${intake.company} — Discovery Call`,
          pipeline:    'default',
          dealstage:   '2734606801',
          description: intake.reason,
        },
      }),
    });
    const dealData = await dealRes.json();
    if (dealData.id) dealId = dealData.id;
    else console.error('HubSpot deal create failed:', JSON.stringify(dealData));
  } catch (e) { console.error('HubSpot deal create error:', e.message); }

  // 4. Associate deal → contact
  if (dealId) {
    try {
      await fetch(`${HUBSPOT_API}/crm/v4/objects/deals/${dealId}/associations/contacts/${contactId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }]),
      });
    } catch (e) { console.error('HubSpot deal-contact association failed:', e.message); }
  }

  // 5. Create intake note on contact (and deal)
  try {
    const noteLines = [
      `Intake form received via BW Advisory Portal`,
      `Company: ${intake.company}`,
      `Contact: ${intake.contact_name} <${intake.contact_email}>`,
      intake.url       ? `Website: ${intake.url}` : null,
      intake.industry  ? `Industry: ${intake.industry}` : null,
      intake.source    ? `Source: ${intake.source}` : null,
      ``,
      `Discussion topic:`,
      intake.reason,
    ].filter(l => l !== null).join('\n');

    const noteRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        properties: {
          hs_note_body:  noteLines,
          hs_timestamp:  new Date().toISOString(),
        },
      }),
    });
    const noteData = await noteRes.json();
    const noteId   = noteData.id;

    if (noteId) {
      // Associate note → contact
      await fetch(`${HUBSPOT_API}/crm/v4/objects/notes/${noteId}/associations/contacts/${contactId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }]),
      }).catch(e => console.error('Note-contact association failed:', e.message));

      // Associate note → deal
      if (dealId) {
        await fetch(`${HUBSPOT_API}/crm/v4/objects/notes/${noteId}/associations/deals/${dealId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }]),
        }).catch(e => console.error('Note-deal association failed:', e.message));
      }
    }
  } catch (e) { console.error('HubSpot note create error:', e.message); }
}

function magicLinkEmailHtml(client, link, expiresAt) {
  const e   = escHtml;
  const exp = new Date(expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const greeting = client.organisation ? `${e(client.name)} at ${e(client.organisation)}` : e(client.name);
  return `<!DOCTYPE html>
<html><body style="font-family:Calibri,'Segoe UI',Arial,sans-serif;background:#f5f7fa;padding:24px;margin:0;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(10,28,66,0.08);">
  <tr><td style="background:#0A1C42;padding:28px 40px;">
    <div style="color:#fff;font-size:16px;font-weight:700;letter-spacing:-0.2px;">BW Advisory Solutions</div>
    <div style="color:#7aaee8;font-size:12px;margin-top:3px;letter-spacing:0.5px;">CLIENT PORTAL</div>
  </td></tr>
  <tr><td style="padding:36px 40px;">
    <p style="font-size:15px;color:#0A1C42;font-weight:600;margin:0 0 8px;">Hello ${greeting},</p>
    <p style="font-size:14px;color:#444;line-height:1.75;margin:0 0 28px;">Your secure access link for the BW Advisory client portal is ready. Click the button below to view your documents and invoices.</p>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
      <tr><td style="background:#1B6EC2;border-radius:7px;padding:0;">
        <a href="${e(link)}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;font-family:Calibri,'Segoe UI',Arial,sans-serif;">Access Client Portal →</a>
      </td></tr>
    </table>
    <p style="font-size:12px;color:#888;line-height:1.7;margin:0 0 6px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="font-size:11px;color:#1B6EC2;word-break:break-all;margin:0 0 24px;">${e(link)}</p>
    <div style="background:#f5f7fa;border-radius:6px;padding:14px 18px;font-size:12px;color:#666;line-height:1.7;">
      <strong>Security notice:</strong> This link is unique to you and expires on <strong>${exp}</strong>. Do not share it. If you did not expect this email, contact <a href="mailto:brad@bwadvisorysolutions.com.au" style="color:#1B6EC2;">brad@bwadvisorysolutions.com.au</a>.
    </div>
  </td></tr>
  <tr><td style="background:#0A1C42;padding:20px 40px;">
    <div style="color:#fff;font-size:13px;font-weight:700;">Brad Warburton</div>
    <div style="color:#a8c0d8;font-size:12px;line-height:1.8;margin-top:2px;">BW Advisory Solutions &nbsp;·&nbsp; ABN 11 892 244 979<br>
    brad@bwadvisorysolutions.com.au &nbsp;·&nbsp; +61 407 779 474<br>bwadvisorysolutions.com.au</div>
  </td></tr>
</table>
</body></html>`;
}
