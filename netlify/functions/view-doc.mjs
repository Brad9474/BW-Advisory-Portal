// view-doc.mjs — serves hosted HTML documents from Netlify Blobs
// Public endpoint — no auth required (doc ID is a hard-to-guess UUID)
// Security: checks link expiry and per-document view cap before serving.

import { getStore } from '@netlify/blobs';

const PORTAL_BASE = 'https://portal.bwadvisorysolutions.com.au';

function expiredPage(reason) {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link Expired — BW Advisory Solutions</title>
<style>
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #fff; border-radius: 12px; padding: 48px 56px; max-width: 480px; text-align: center; box-shadow: 0 4px 24px rgba(10,28,66,0.10); }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h1 { font-size: 22px; color: #0A1C42; margin-bottom: 12px; }
  p { font-size: 14px; color: #6a7a8a; line-height: 1.7; margin-bottom: 24px; }
  a { color: #1B6EC2; font-size: 13px; }
</style></head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>This link is no longer active</h1>
    <p>${reason}</p>
    <p>If you need access to this document, please contact <a href="mailto:brad@bwadvisorysolutions.com.au">Brad Warburton</a> directly.</p>
  </div>
</body></html>`, {
    status: 410,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const id  = url.searchParams.get('id');
  if (!id) return new Response('Not found', { status: 404 });

  const store = getStore({ name: 'portal-state', consistency: 'strong' });

  // ── Load document metadata ─────────────────────────────────────────────────
  const docs = await store.get('documents', { type: 'json' }).catch(() => []) || [];
  const doc  = docs.find(d => d.id === id);

  if (doc) {
    // ── Expiry check ─────────────────────────────────────────────────────────
    if (doc.expiresAt && new Date() > new Date(doc.expiresAt)) {
      return expiredPage('This document link expired on ' +
        new Date(doc.expiresAt).toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' }) + '.');
    }

    // ── View cap check (count preview_open events for this doc) ───────────────
    const maxViews = doc.maxViews ?? 50;
    const events   = await store.get('doc_events', { type: 'json' }).catch(() => []) || [];
    const viewCount = events.filter(e => e.docId === id && e.type === 'preview_open').length;
    if (viewCount >= maxViews) {
      return expiredPage(`This document has reached its maximum view limit (${maxViews} views).`);
    }
  }

  // ── Load HTML content ──────────────────────────────────────────────────────
  const html = await store.get(`htmlfile_${id}`, { type: 'text' }).catch(() => null);
  if (!html) return new Response('Document not found', { status: 404 });

  // Replace local file:// logo references with the hosted portal asset
  const logoUrl = `${PORTAL_BASE}/assets/BW_Advisory_Solutions_Logo.png`;
  const fixed   = html.replace(/file:\/\/\/[^"']*BW_Advisory_Solutions_Logo[^"']*/gi, logoUrl);

  // ── Email open pixel URL (logged separately, fire-and-forget) ─────────────
  const pixelUrl = `${PORTAL_BASE}/.netlify/functions/track-email-open?id=${encodeURIComponent(id)}`;

  const trackingScript = `
<script>
(function() {
  const docId     = '${id}';
  const sessionId = 'ses_pub_' + Date.now() + '_' + Math.floor(Math.random()*1000);
  const api       = '/.netlify/functions/portal-api';

  // ── Time tracking with idle detection ──────────────────────────────────────
  let openTime  = Date.now();
  let accumSec  = 0;
  let isVisible = !document.hidden;
  let idleTimer = null;
  let isIdle    = false;
  const IDLE_MS = 30000; // 30s idle threshold

  function onActivity() {
    if (isIdle) {
      isIdle   = false;
      openTime = Date.now(); // restart active timer
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (isVisible && openTime !== null) {
        accumSec += Math.round((Date.now() - openTime) / 1000);
        openTime  = null;
      }
      isIdle = true;
    }, IDLE_MS);
  }

  ['mousemove','keydown','scroll','touchstart','click'].forEach(ev =>
    document.addEventListener(ev, onActivity, { passive: true })
  );
  onActivity(); // start idle timer immediately

  function getActiveSec() {
    let total = accumSec;
    if (isVisible && !isIdle && openTime !== null) {
      total += Math.round((Date.now() - openTime) / 1000);
    }
    return total;
  }

  // ── Scroll depth tracking ──────────────────────────────────────────────────
  let maxScrollPct = 0;
  function onScroll() {
    const el      = document.documentElement;
    const scrolled = el.scrollTop || document.body.scrollTop;
    const height   = el.scrollHeight - el.clientHeight;
    if (height <= 0) { maxScrollPct = 100; return; }
    const pct = Math.round((scrolled / height) * 100);
    if (pct > maxScrollPct) maxScrollPct = pct;
  }
  document.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── Track function ──────────────────────────────────────────────────────────
  function track(type, extras = {}) {
    const payload = JSON.stringify({
      action:          'track-public-document-event',
      docId,
      type,
      sessionId,
      durationSeconds: extras.durationSeconds ?? null,
      scrollDepthPct:  extras.scrollDepthPct  ?? null,
      linkUrl:         extras.linkUrl         ?? null,
      userAgent:       navigator.userAgent,
    });
    navigator.sendBeacon(api, new Blob([payload], { type: 'application/json' }));
  }

  // ── Open event ─────────────────────────────────────────────────────────────
  track('preview_open');

  // ── Tab visibility changes ──────────────────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (isVisible && !isIdle && openTime !== null) {
        accumSec += Math.round((Date.now() - openTime) / 1000);
        openTime  = null;
      }
      isVisible = false;
    } else {
      isVisible = true;
      if (!isIdle) openTime = Date.now();
    }
  });

  // ── Close / unload event ───────────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    track('preview_close', {
      durationSeconds: getActiveSec(),
      scrollDepthPct:  maxScrollPct,
    });
  });

  // ── Print event ────────────────────────────────────────────────────────────
  window.addEventListener('beforeprint', () => track('download'));

  // ── Link click tracking ────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link || !link.href) return;

    const txt  = link.textContent.trim().toLowerCase();
    const href = link.href;

    // Pay Now button
    if (txt.includes('pay now') || href.includes('wise.com/pay') || href.includes('stripe.com')) {
      track('pay_now');
      return;
    }

    // All other external links
    try {
      const linkHost = new URL(href).hostname;
      if (linkHost && linkHost !== window.location.hostname) {
        track('link_click', { linkUrl: href.slice(0, 300) });
      }
    } catch {}
  });
})();
</script>
`;

  // Inject pixel img tag for email open tracking (hidden, 1×1)
  const pixelTag = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;outline:0;" alt="" aria-hidden="true">`;

  let injected = fixed;
  // Inject tracking before </body>
  injected = injected.includes('</body>')
    ? injected.replace('</body>', trackingScript + '</body>')
    : injected + trackingScript;
  // Inject pixel before </body> (or at end)
  injected = injected.includes('</body>')
    ? injected.replace('</body>', pixelTag + '</body>')
    : injected + pixelTag;

  return new Response(injected, {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'no-store',
    },
  });
};

export const config = { path: '/.netlify/functions/view-doc' };
