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
      return new Response('Report not yet available', { status: 202 });
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
