// track-email-open.mjs — logs when a client opens the email (via tracking pixel)
// Returns a 1×1 transparent GIF — no auth required.

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

// 1×1 transparent GIF (35 bytes)
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export default async (req) => {
  const url = new URL(req.url);
  const id  = url.searchParams.get('id');

  // Always return the pixel immediately — tracking is best-effort
  const pixelResponse = new Response(PIXEL, {
    status: 200,
    headers: {
      'Content-Type':  'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma':        'no-cache',
    },
  });

  if (!id) return pixelResponse;

  // Fire-and-forget: log the event asynchronously
  (async () => {
    try {
      const store = getStore({ name: 'portal-state', consistency: 'strong' });

      // Load doc metadata for client details
      const docs = await store.get('documents', { type: 'json' }).catch(() => []) || [];
      const doc  = docs.find(d => d.id === id);

      const ipAddress = req.headers.get('x-nf-client-connection-ip')
        || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || null;
      const country   = req.headers.get('x-country') || null;
      const userAgent = req.headers.get('user-agent') || null;

      // Suppress known email-client pre-fetchers (they inflate counts)
      const botPatterns = /Googlebot|Bingbot|proxy|prefetch|MailScanner|SpamAssassin|preview/i;
      if (userAgent && botPatterns.test(userAgent)) return;

      const event = {
        eventId:         `evt_${Date.now()}_${randomUUID().slice(0, 8)}`,
        docId:           id,
        clientId:        doc?.clientId   || null,
        clientName:      doc?.clientName || null,
        clientEmail:     doc?.clientEmail || null,
        type:            'email_open',
        durationSeconds: null,
        timestamp:       new Date().toISOString(),
        sessionId:       `ses_email_${Date.now()}`,
        userAgent:       String(userAgent || '').slice(0, 200),
        ipAddress,
        country,
      };

      const events = await store.get('doc_events', { type: 'json' }).catch(() => []) || [];
      events.push(event);
      await store.setJSON('doc_events', events);
    } catch (err) {
      console.error('track-email-open write failed:', err.message);
    }
  })();

  return pixelResponse;
};

export const config = { path: '/.netlify/functions/track-email-open' };
