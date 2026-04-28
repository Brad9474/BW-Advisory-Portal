import { getStore } from '@netlify/blobs';

// 1x1 transparent GIF (tracking pixel)
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

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
    // Using ip-api.com free tier (45 requests/min limit)
    // Returns: country, city, latitude, longitude, org (ISP/organization), etc.
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
  // Check headers in order of preference
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const cfConnecting = req.headers.get('cf-connecting-ip');
  if (cfConnecting) {
    return cfConnecting;
  }

  // For localhost/testing
  return req.headers.get('x-client-ip') || 'unknown';
}

export default async (req, context) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response('Not found', { status: 404 });
  }

  try {
    const url = new URL(req.url);
    const reportId = url.searchParams.get('id');

    if (!reportId) {
      // Still return pixel even without ID to avoid breaking tracking
      return new Response(PIXEL_GIF, {
        status: 200,
        headers: {
          'Content-Type': 'image/gif',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
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
      type: 'email_open',
      timestamp: new Date().toISOString(),
      ipAddress,
      country: geo.country,
      city: geo.city,
      lat: geo.lat,
      lon: geo.lon,
      org: geo.org,
      userAgent,
      device,
      browser
    };

    // Store event in submission (key format is sub_${id})
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
      console.warn('Could not log open event:', blobError);
      // Continue anyway - we still return the pixel
    }

    // Return tracking pixel
    return new Response(PIXEL_GIF, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error('Error logging open:', error);
    // Return pixel even on error
    return new Response(PIXEL_GIF, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
};
