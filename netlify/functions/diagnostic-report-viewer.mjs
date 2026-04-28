import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const reportId = url.searchParams.get('id');
    const viewToken = url.searchParams.get('token');

    // Validate required parameters
    if (!reportId || !viewToken) {
      return new Response('Missing report ID or token', { status: 400 });
    }

    // Retrieve submission from Blobs (key format is sub_${id})
    const store = getStore('diagnostics');
    const submission = await store.get(`sub_${reportId}`, { type: 'json' });

    if (!submission) {
      return new Response('Report not found', { status: 404 });
    }

    // Validate token matches
    if (submission.viewToken !== viewToken) {
      return new Response('Invalid token', { status: 403 });
    }

    // Extract report HTML from submission.report.html
    if (!submission.report || !submission.report.html) {
      const waitingPage = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="refresh" content="3">
<title>Report Loading — BW Advisory Solutions</title>
<style>
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; background: #f5f4f0; margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #fff; max-width: 480px; padding: 48px; border-radius: 10px; text-align: center; box-shadow: 0 4px 24px rgba(15,23,42,0.1); }
  .header { color: #0F172A; font-size: 24px; font-weight: 700; margin-bottom: 12px; }
  .spinner { margin: 24px 0; }
  .dot { width: 8px; height: 8px; background: #C9A84C; border-radius: 50%; display: inline-block; margin: 0 4px; animation: pulse 1.5s infinite; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
  .message { color: #666; font-size: 15px; line-height: 1.6; }
</style>
</head>
<body>
<div class="card">
  <div class="header">Report Loading</div>
  <div class="spinner"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
  <div class="message">Your diagnostic report is being generated. This page will refresh automatically.</div>
</div>
</body>
</html>`;
      return new Response(waitingPage, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    // Inject tracking pixel into report HTML
    const trackingPixelUrl = `/.netlify/functions/track-diagnostic-open?id=${reportId}`;
    const trackingPixel = `<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;">`;

    // Insert pixel before closing body tag
    let htmlWithPixel = submission.report.html.replace(
      '</body>',
      `${trackingPixel}\n</body>`
    );

    // Also inject tracking into CTA links
    // Replace href="/visit-bw" with tracked version
    htmlWithPixel = htmlWithPixel.replace(
      /href="(https?:\/\/[^"]+)"/g,
      (match, url) => {
        // Don't track internal links
        if (url.includes('bwadvisorysolutions.com') || url.includes('localhost')) {
          const trackingUrl = `/.netlify/functions/track-diagnostic-cta?id=${reportId}&redirect=${encodeURIComponent(url)}`;
          return `href="${trackingUrl}"`;
        }
        return match;
      }
    );

    return new Response(htmlWithPixel, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      }
    });
  } catch (error) {
    console.error('Error retrieving report:', error);
    return new Response('Error retrieving report', { status: 500 });
  }
};
