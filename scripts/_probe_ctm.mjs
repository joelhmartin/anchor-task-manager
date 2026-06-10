import pg from 'pg';
import axios from 'axios';
import { decrypt } from '../server/services/security/encryption.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const { rows } = await pool.query(
    `SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id=$1`,
    ['d2901330-d9a8-4c0e-84d9-e90e46e0efc3']
  );
  if (!rows.length) {
    console.log('No CTM credentials found for user');
  } else {
    const r = rows[0];
    const acct = r.ctm_account_number;
    const key = decrypt(r.ctm_api_key);
    const sec = decrypt(r.ctm_api_secret);
    const auth = `Basic ${Buffer.from(`${key}:${sec}`).toString('base64')}`;

    const resp = await axios.get(`https://api.calltrackingmetrics.com/api/v1/accounts/${acct}/calls.json`, {
      params: { per_page: 50, page: 1, order: 'desc' },
      headers: { Authorization: auth, Accept: 'application/json' },
      timeout: 30000
    });
    const calls = resp.data?.calls || [];
    const withVisitor = calls.find((c) => c.visitor === true || c.visitor_sid);
    if (!withVisitor) {
      console.log('no visitor=true in last 50');
    } else {
      console.log('id:', withVisitor.id, 'visitor:', withVisitor.visitor, 'has last_location?', 'last_location' in withVisitor, 'has medium?', 'medium' in withVisitor, 'has campaign?', 'campaign' in withVisitor);
      console.log('ga keys:', withVisitor.ga ? Object.keys(withVisitor.ga).join(',') : 'no ga');
      console.log('FULL LIST CALL OBJ for visitor=true:');
      const interesting = {};
      for (const k of Object.keys(withVisitor)) {
        if (/url|landing|referrer|utm|visitor|source|medium|campaign|first|last|page|track|ga|web/i.test(k)) interesting[k] = withVisitor[k];
      }
      console.log(JSON.stringify(interesting, null, 2));
    }
  }
} finally {
  await pool.end();
}
