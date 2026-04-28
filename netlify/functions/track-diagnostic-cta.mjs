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

// Extract geolocation from IP using ip-api.com service
// Returns country, city, lat, lon, and organization
async function getGeolocationFromIP(ipAddress) {
  try {
    const response = await fetch(`http://ip-api.com/json/${ipAddress}`);
    const data = await response.json();
    return {
      country: data.country || 'unknown',
      city: data.city || 'unknown',
      lat: data.lat || null,
      lon: data.lon || null,
      org: data.org || 'unknown'  // ISP/Organization name
    };
  } catch (error) {
    console.warn('Could not resolve geolocation from IP:', error);
    return {
      country: 'unknown',
      city: 'unknown',
      lat: null,
      lon: null,
      org: 'unknown'
    };
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

    // Get geolocation from IP
    let geo = { country: 'unknown', city: 'unknown', lat: null, lon: null };
    try {
      geo = await getGeolocationFromIP(ipAddress);
    } catch (e) {
      // Continue even if geolocation lookup fails
    }

    // Create event with geolocation data
    const event = {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'cta_click',
      timestamp: new Date().toISOString(),
      ipAddress,
      country: geo.country,
      city: geo.city,
      lat: geo.lat,
      lon: geo.lon,
      org: geo.org,
      userAgent,
      device,
      browser,
      clickedURL: redirectURL
    };

    // Store event in submission (key format is sub_${id})
    if (reportId) {
      const store = getStore('diagnostics');
      try {
        const submission = await store.get(`sub_${reportId}`, { type: 'json' });

        if (submission) {
          // Initialize events array if it doesn't exist
          if (!submission.events) {
            submission.events = [];
          }

          // Add event
          submission.events.push(event);

          // Update submission in Blobs
          await store.setJSON(`sub_${reportId}`, submission);
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
