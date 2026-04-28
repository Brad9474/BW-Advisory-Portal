import { getStore } from '@netlify/blobs';

// Parse User-Agent to detect device and browser
function parseUserAgent(userAgent) {
  const ua = userAgent.toLowerCase();

  let device = 'desktop';
  let browser = 'other';

  // Detect device
  if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) {
    device = 'mobile';
  } else if (ua.includes('tablet') || ua.includes('ipad')) {
    device = 'tablet';
  }

  // Detect browser
  if (ua.includes('edg')) {
    browser = 'edge';
  } else if (ua.includes('chrome')) {
    browser = 'chrome';
  } else if (ua.includes('safari')) {
    browser = 'safari';
  } else if (ua.includes('firefox')) {
    browser = 'firefox';
  } else if (ua.includes('opera') || ua.includes('opr')) {
    browser = 'opera';
  }

  return { device, browser };
}

// Extract country from IP
async function getCountryFromIP(ipAddress) {
  try {
    const response = await fetch(`http://ip-api.com/json/${ipAddress}`);
    const data = await response.json();
    return data.country || 'unknown';
  } catch (error) {
    console.warn('Could not resolve country from IP:', error);
    return 'unknown';
  }
}

// Extract IP from request
function getClientIP(req) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const cfConnecting = req.headers.get('cf-connecting-ip');
  if (cfConnecting) {
    return cfConnecting;
  }

  return req.headers.get('x-client-ip') || 'unknown';
}

// Validate redirect URL is safe (prevent open redirects)
function isValidRedirectURL(url) {
  try {
    const parsed = new URL(url);

    // Allow HTTPS, HTTP
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // Whitelist domains: bwadvisorysolutions.com only (no subdomains except www)
    const hostname = parsed.hostname.toLowerCase();
    const allowedDomains = [
      'bwadvisorysolutions.com.au',
      'www.bwadvisorysolutions.com.au',
      'bwadvisorysolutions.com',
      'www.bwadvisorysolutions.com'
    ];

    if (!allowedDomains.includes(hostname)) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

export default async (req, context) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response('Not found', { status: 404 });
  }

  try {
    const url = new URL(req.url);
    const reportId = url.searchParams.get('id');
    const redirectURL = url.searchParams.get('redirect');

    // Validate inputs
    if (!redirectURL || !isValidRedirectURL(redirectURL)) {
      return new Response('Invalid redirect URL', { status: 400 });
    }

    // Extract client information
    const userAgent = req.headers.get('user-agent') || 'unknown';
    const ipAddress = getClientIP(req);
    const { device, browser } = parseUserAgent(userAgent);

    // Get country from IP
    let country = 'unknown';
    try {
      country = await getCountryFromIP(ipAddress);
    } catch (e) {
      // Continue even if country lookup fails
    }

    // Create event
    const event = {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'cta_click',
      timestamp: new Date().toISOString(),
      ipAddress,
      country,
      userAgent,
      device,
      browser,
      clickedURL: redirectURL
    };

    // Store event in Blobs if reportId provided
    if (reportId) {
      const store = getStore('diagnostics');
      try {
        const report = await store.get(reportId, { type: 'json' });

        if (report) {
          // Initialize events array if it doesn't exist
          if (!report.events) {
            report.events = [];
          }

          // Add event
          report.events.push(event);

          // Update report in Blobs
          await store.set(reportId, report, { type: 'json' });
        }
      } catch (blobError) {
        console.warn('Could not log CTA click event:', blobError);
        // Continue anyway - we still redirect
      }
    }

    // Redirect to target URL
    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectURL,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (error) {
    console.error('Error logging CTA click:', error);
    // Redirect to homepage on error as fallback
    return new Response(null, {
      status: 302,
      headers: {
        'Location': 'https://bwadvisorysolutions.com.au'
      }
    });
  }
};
