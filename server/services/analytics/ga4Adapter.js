import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'ga4-service-account.json');

const DATA_COLLECTION_ACK =
  'I acknowledge that I have the necessary privacy disclosures and rights from my end users for the collection and processing of their data, including the association of such data with the visitation information Google Analytics collects from my site and/or app property.';

/**
 * Get authenticated GA4 Data API client.
 * @returns {object} analyticsData client
 */
function getAnalyticsDataClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly']
  });
  return google.analyticsdata({ version: 'v1beta', auth });
}

/**
 * Fetch GA4 analytics for a property within a date range.
 * Uses a service account (no OAuth needed).
 * @param {string} propertyId - GA4 property ID (numeric, e.g. '527437284')
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {object} { sessions, users, bounceRate, avgSessionDuration, engagedSessions, engagementRate, topSources, topPages, timeSeries }
 */
export async function fetchGA4Analytics(propertyId, startDate, endDate) {
  const analyticsData = getAnalyticsDataClient();
  const property = `properties/${propertyId}`;

  const [summaryRes, sourcesRes, pagesRes, timeSeriesRes] = await Promise.all([
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'engagedSessions' },
          { name: 'engagementRate' },
          { name: 'conversions' },
          { name: 'activeUsers' },
          { name: 'newUsers' }
        ]
      }
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'engagementRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10
      }
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'engagementRate' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10
      }
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'engagementRate' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }]
      }
    })
  ]);

  const summaryRow = summaryRes.data.rows?.[0]?.metricValues || [];
  return {
    sessions: parseInt(summaryRow[0]?.value) || 0,
    users: parseInt(summaryRow[1]?.value) || 0,
    bounceRate: parseFloat(summaryRow[2]?.value) || 0,
    avgSessionDuration: Math.round(parseFloat(summaryRow[3]?.value)) || 0,
    engagedSessions: parseInt(summaryRow[4]?.value) || 0,
    engagementRate: parseFloat(summaryRow[5]?.value) || 0,
    conversions: parseInt(summaryRow[6]?.value) || 0,
    activeUsers: parseInt(summaryRow[7]?.value) || 0,
    newUsers: parseInt(summaryRow[8]?.value) || 0,
    topSources: (sourcesRes.data.rows || [])
      .filter((row) => row.dimensionValues?.length >= 2 && row.metricValues?.length >= 4)
      .map((row) => ({
        source: row.dimensionValues[0].value,
        medium: row.dimensionValues[1].value,
        sessions: parseInt(row.metricValues[0].value) || 0,
        users: parseInt(row.metricValues[1].value) || 0,
        engagedSessions: parseInt(row.metricValues[2].value) || 0,
        engagementRate: parseFloat(row.metricValues[3].value) || 0
      })),
    topPages: (pagesRes.data.rows || [])
      .filter((row) => row.dimensionValues?.length >= 1 && row.metricValues?.length >= 4)
      .map((row) => ({
        page: row.dimensionValues[0].value,
        sessions: parseInt(row.metricValues[0].value) || 0,
        engagedSessions: parseInt(row.metricValues[1].value) || 0,
        engagementRate: parseFloat(row.metricValues[2].value) || 0,
        bounceRate: parseFloat(row.metricValues[3].value) || 0
      })),
    timeSeries: (timeSeriesRes.data.rows || [])
      .filter((row) => row.dimensionValues?.length >= 1 && row.metricValues?.length >= 4)
      .map((row) => {
        const d = row.dimensionValues[0].value;
        return {
          date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          sessions: parseInt(row.metricValues[0].value),
          users: parseInt(row.metricValues[1].value),
          engagedSessions: parseInt(row.metricValues[2].value),
          engagementRate: parseFloat(row.metricValues[3].value) || 0
        };
      })
  };
}

/**
 * Fetch the 4 KPI summary metrics for the Traffic tab.
 * @param {string} propertyId
 * @param {string} startDate
 * @param {string} endDate
 * @returns {{ activeUsers, newUsers, avgSessionDuration, engagedSessions }}
 */
export async function fetchGA4TrafficSummary(propertyId, startDate, endDate) {
  const analyticsData = getAnalyticsDataClient();
  const property = `properties/${propertyId}`;
  const res = await analyticsData.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'averageSessionDuration' },
        { name: 'engagedSessions' }
      ]
    }
  });
  const row = res.data.rows?.[0]?.metricValues || [];
  return {
    activeUsers: parseInt(row[0]?.value) || 0,
    newUsers: parseInt(row[1]?.value) || 0,
    avgSessionDuration: Math.round(parseFloat(row[2]?.value)) || 0,
    engagedSessions: parseInt(row[3]?.value) || 0
  };
}

/**
 * Fetch GA4 traffic sources with detailed metrics.
 * @param {string} propertyId - GA4 property ID (numeric)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {number} limit - Max rows (default 50)
 * @returns {Array<{source, medium, sessions, users, bounceRate, avgDuration, engagedSessions, engagementRate, conversions}>}
 */
export async function fetchGA4Sources(propertyId, startDate, endDate, limit = 50) {
  const analyticsData = getAnalyticsDataClient();
  const property = `properties/${propertyId}`;

  const res = await analyticsData.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'conversions' }
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit
    }
  });

  return (res.data.rows || [])
    .filter((row) => row.dimensionValues?.length >= 2 && row.metricValues?.length >= 7)
    .map((row) => ({
      source: row.dimensionValues[0].value,
      medium: row.dimensionValues[1].value,
      sessions: parseInt(row.metricValues[0].value) || 0,
      users: parseInt(row.metricValues[1].value) || 0,
      bounceRate: parseFloat(row.metricValues[2].value) || 0,
      avgDuration: Math.round(parseFloat(row.metricValues[3].value)) || 0,
      engagedSessions: parseInt(row.metricValues[4].value) || 0,
      engagementRate: parseFloat(row.metricValues[5].value) || 0,
      conversions: parseInt(row.metricValues[6].value) || 0
    }));
}

/**
 * Fetch GA4 landing pages with detailed metrics.
 * @param {string} propertyId - GA4 property ID (numeric)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {number} limit - Max rows (default 50)
 * @returns {Array<{page, sessions, users, bounceRate, avgDuration, engagedSessions, engagementRate, conversions}>}
 */
export async function fetchGA4LandingPages(propertyId, startDate, endDate, limit = 50) {
  const analyticsData = getAnalyticsDataClient();
  const property = `properties/${propertyId}`;

  const res = await analyticsData.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'conversions' }
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit
    }
  });

  return (res.data.rows || [])
    .filter((row) => row.dimensionValues?.length >= 1 && row.metricValues?.length >= 7)
    .map((row) => ({
      page: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value) || 0,
      users: parseInt(row.metricValues[1].value) || 0,
      bounceRate: parseFloat(row.metricValues[2].value) || 0,
      avgDuration: Math.round(parseFloat(row.metricValues[3].value)) || 0,
      engagedSessions: parseInt(row.metricValues[4].value) || 0,
      engagementRate: parseFloat(row.metricValues[5].value) || 0,
      conversions: parseInt(row.metricValues[6].value) || 0
    }));
}

/**
 * Fetch GA4 device category breakdown.
 * @param {string} propertyId - GA4 property ID (numeric)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array<{device, sessions, users}>}
 */
export async function fetchGA4DeviceBreakdown(propertyId, startDate, endDate) {
  const analyticsData = getAnalyticsDataClient();
  const property = `properties/${propertyId}`;

  const res = await analyticsData.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
    }
  });

  return (res.data.rows || [])
    .filter((row) => row.dimensionValues?.length >= 1 && row.metricValues?.length >= 2)
    .map((row) => ({
      device: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value) || 0,
      users: parseInt(row.metricValues[1].value) || 0
    }));
}

/**
 * List all GA4 properties accessible by the service account, with measurement IDs.
 * @returns {Array<{propertyId: string, measurementId: string, propertyName: string, accountName: string}>}
 */
export async function listGA4Properties() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly']
  });

  const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth });

  let allSummaries = [];
  let pageToken;
  do {
    const res = await analyticsAdmin.accountSummaries.list({ pageSize: 200, pageToken });
    allSummaries.push(...(res.data.accountSummaries || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  const properties = [];
  for (const acct of allSummaries) {
    for (const prop of acct.propertySummaries || []) {
      const propertyId = prop.property?.replace('properties/', '');
      if (!propertyId) continue;

      let measurementId = null;
      try {
        const streamsRes = await analyticsAdmin.properties.dataStreams.list({
          parent: prop.property
        });
        const webStream = (streamsRes.data.dataStreams || []).find((s) => s.type === 'WEB_DATA_STREAM');
        measurementId = webStream?.webStreamData?.measurementId || null;
      } catch {
        // Property may not have a web stream
      }

      properties.push({
        propertyId,
        measurementId,
        propertyName: prop.displayName || '',
        accountName: acct.displayName || ''
      });
    }
  }

  return properties;
}

/**
 * Create a Measurement Protocol API secret for a GA4 property.
 * Acknowledges data collection if needed, then creates or returns existing secret.
 * @param {string} propertyId - GA4 property ID (numeric)
 * @returns {{ secretValue: string, measurementId: string }}
 */
export async function createMPSecret(propertyId) {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/analytics.edit']
  });

  const admin = google.analyticsadmin({ version: 'v1alpha', auth });
  const property = `properties/${propertyId}`;

  const streamsRes = await admin.properties.dataStreams.list({ parent: property });
  const webStream = (streamsRes.data.dataStreams || []).find((s) => s.type === 'WEB_DATA_STREAM');
  if (!webStream) throw new Error('No web data stream found for property ' + propertyId);

  const measurementId = webStream.webStreamData?.measurementId;

  const existingRes = await admin.properties.dataStreams.measurementProtocolSecrets.list({
    parent: webStream.name
  });
  const existing = (existingRes.data.measurementProtocolSecrets || []).find((s) => s.displayName === 'Anchor Dashboard Relay');
  if (existing) {
    return { secretValue: existing.secretValue, measurementId };
  }

  try {
    await admin.properties.acknowledgeUserDataCollection({
      property,
      requestBody: { acknowledgement: DATA_COLLECTION_ACK }
    });
  } catch {
    // May already be acknowledged
  }

  const createRes = await admin.properties.dataStreams.measurementProtocolSecrets.create({
    parent: webStream.name,
    requestBody: { displayName: 'Anchor Dashboard Relay' }
  });

  return { secretValue: createRes.data.secretValue, measurementId };
}
