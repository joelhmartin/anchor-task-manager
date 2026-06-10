/**
 * One-time script to get a Google Ads refresh token.
 * Run: node server/services/analytics/get-gads-token.mjs
 *
 * Opens a browser for you to log in, then prints the refresh token.
 * Save that refresh token — it doesn't expire.
 */
import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8085';
const SCOPES = ['https://www.googleapis.com/auth/adwords'];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent'
});

// Start a temporary server to receive the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:8085`);
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('No code received');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n✅ Success! Here is your refresh token:\n');
    console.log(tokens.refresh_token);
    console.log('\nSet this as GOOGLE_ADS_REFRESH_TOKEN env var.\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Success!</h1><p>You can close this tab. Check your terminal for the refresh token.</p>');
  } catch (err) {
    console.error('Error exchanging code:', err.message);
    res.writeHead(500);
    res.end('Error: ' + err.message);
  }

  server.close();
});

server.listen(8085, () => {
  console.log('Opening browser for Google Ads authorization...');
  console.log('If it doesn\'t open, go to:\n');
  console.log(authUrl);
  console.log('');

  import('child_process').then(({ exec }) => {
    exec(`open "${authUrl}"`);
  });
});
