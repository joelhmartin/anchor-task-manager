#!/usr/bin/env node
/**
 * One-shot importer: wp-client-hub.db (SQLite) -> Anchor Postgres.
 *
 * Reads sites + environments + scan_metadata + per-site CLAUDE.md files
 * from /Volumes/G-DRIVE SSD/DEVELOPER/wp-client-hub. Decrypts each cached
 * SSH password with DB_ENCRYPTION_KEY (wp-client-hub's key, concatenated
 * base64 IV+tag+ciphertext format), re-encrypts with ENCRYPTION_KEY
 * (Anchor's colon-delimited format), then EITHER:
 *
 *   - inserts into a Postgres DSN passed via --dsn / DATABASE_URL, or
 *   - emits a portable kinsta-import.sql file (default).
 *
 * Idempotent: UPSERTs on (kinsta_site_id) and (kinsta_environment_id).
 *
 * Required env: DB_ENCRYPTION_KEY (wp-client-hub key), ENCRYPTION_KEY (Anchor key).
 *
 * Usage:
 *   node scripts/import-wp-client-hub.mjs                  # emit data/kinsta-import.sql
 *   node scripts/import-wp-client-hub.mjs --apply          # apply to DATABASE_URL
 *   node scripts/import-wp-client-hub.mjs --dsn=postgres://...
 *   node scripts/import-wp-client-hub.mjs --source=/path/to/wp-client-hub
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const DEFAULT_SOURCE = '/Volumes/G-DRIVE SSD/DEVELOPER/wp-client-hub';
const DEFAULT_OUTPUT = join(REPO_ROOT, 'data', 'kinsta-import.sql');

function parseArgs(argv) {
  const args = { apply: false, source: DEFAULT_SOURCE, output: DEFAULT_OUTPUT, dsn: null, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--source=')) args.source = arg.slice('--source='.length);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg.startsWith('--dsn=')) args.dsn = arg.slice('--dsn='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(
`Usage: node scripts/import-wp-client-hub.mjs [options]

  --apply              Apply directly to Postgres (DATABASE_URL or --dsn).
  --dsn=<url>          Override DATABASE_URL.
  --source=<path>      Path to wp-client-hub repo. Default: ${DEFAULT_SOURCE}.
  --output=<path>      Output SQL file. Default: ${DEFAULT_OUTPUT}.
  --dry-run            Print stats only, no write.
`);
      process.exit(0);
    }
  }
  return args;
}

// ---------- crypto helpers ----------

function decryptWpClientHub(ciphertextB64) {
  const key = process.env.DB_ENCRYPTION_KEY;
  if (!key) throw new Error('DB_ENCRYPTION_KEY not set (wp-client-hub key needed for decrypt)');
  const buf = Buffer.from(ciphertextB64, 'base64');
  const iv = buf.subarray(0, 16);
  const tag = buf.subarray(16, 32);
  const encrypted = buf.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

function getAnchorEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) throw new Error('ENCRYPTION_KEY not set (Anchor key needed for re-encrypt)');
  if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }
  return crypto.scryptSync(envKey, 'anchor-salt', 32);
}

function encryptAnchor(plaintext) {
  const key = getAnchorEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

// ---------- SQL helpers ----------

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(obj) {
  if (!obj) return `'{}'::jsonb`;
  return `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
}

function sqlBool(value) {
  return value ? 'TRUE' : 'FALSE';
}

function sqlInt(value) {
  return value === null || value === undefined ? 'NULL' : String(parseInt(value, 10));
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv);

  const sqlitePath = join(args.source, 'data', 'wp-client-hub.db');
  if (!existsSync(sqlitePath)) {
    console.error(`SQLite source not found: ${sqlitePath}`);
    process.exit(1);
  }

  const workspacesPath = join(args.source, 'data', 'workspaces');
  const sqlite = new Database(sqlitePath, { readonly: true });

  const sites = sqlite.prepare('SELECT * FROM sites ORDER BY site_name').all();
  const environments = sqlite.prepare('SELECT * FROM environments ORDER BY site_id, environment_name').all();
  const scanRows = sqlite.prepare('SELECT * FROM scan_metadata').all();
  sqlite.close();

  const scanBySite = new Map(scanRows.map((row) => [row.site_id, row]));

  const stats = {
    sitesTotal: sites.length,
    envsTotal: environments.length,
    pwdAvailable: 0,
    pwdDecryptFailed: 0,
    pwdMissing: 0,
    workspacesPresent: 0
  };

  const statements = [];
  statements.push('-- Generated by scripts/import-wp-client-hub.mjs');
  statements.push(`-- ${new Date().toISOString()}`);
  statements.push(`-- ${sites.length} sites, ${environments.length} environments`);
  statements.push('BEGIN;');

  for (const site of sites) {
    statements.push(
      `INSERT INTO kinsta_sites (kinsta_site_id, site_name) VALUES (${sqlString(site.id)}, ${sqlString(site.site_name)})\n  ON CONFLICT (kinsta_site_id) DO UPDATE SET site_name = EXCLUDED.site_name, updated_at = NOW();`
    );

    const claudeMdPath = join(workspacesPath, site.id, 'CLAUDE.md');
    let claudeMd = '';
    if (existsSync(claudeMdPath)) {
      try {
        claudeMd = readFileSync(claudeMdPath, 'utf8');
        stats.workspacesPresent += 1;
      } catch (err) {
        console.warn(`[import] failed to read ${claudeMdPath}: ${err.message}`);
      }
    }

    let scanJson = {};
    let lastScanAt = null;
    let lastScanStatus = null;
    let lastScanError = null;
    const scanRow = scanBySite.get(site.id);
    if (scanRow) {
      lastScanAt = scanRow.last_scan_at || null;
      lastScanStatus = scanRow.last_scan_status || null;
      lastScanError = scanRow.last_scan_error || null;
      if (scanRow.scan_data_json) {
        try {
          scanJson = JSON.parse(scanRow.scan_data_json);
        } catch {
          scanJson = { raw: scanRow.scan_data_json };
        }
      }
    }

    statements.push(
      `INSERT INTO kinsta_site_workspaces (site_id, claude_md, scan_json, last_scan_at, last_scan_status, last_scan_error)
  SELECT id, ${sqlString(claudeMd)}, ${sqlJson(scanJson)}, ${lastScanAt ? sqlString(lastScanAt) : 'NULL'}::timestamptz, ${sqlString(lastScanStatus)}, ${sqlString(lastScanError)}
  FROM kinsta_sites WHERE kinsta_site_id = ${sqlString(site.id)}
  ON CONFLICT (site_id) DO UPDATE SET
    claude_md = EXCLUDED.claude_md,
    scan_json = EXCLUDED.scan_json,
    last_scan_at = EXCLUDED.last_scan_at,
    last_scan_status = EXCLUDED.last_scan_status,
    last_scan_error = EXCLUDED.last_scan_error,
    updated_at = NOW();`
    );
  }

  for (const env of environments) {
    let encryptedPassword = null;
    if (env.ssh_password) {
      try {
        const plaintext = decryptWpClientHub(env.ssh_password);
        encryptedPassword = encryptAnchor(plaintext);
        stats.pwdAvailable += 1;
      } catch (err) {
        console.warn(`[import] decrypt failed for env ${env.id}: ${err.message}`);
        stats.pwdDecryptFailed += 1;
      }
    } else {
      stats.pwdMissing += 1;
    }

    statements.push(
      `INSERT INTO kinsta_environments
    (site_id, kinsta_environment_id, environment_name, is_live, primary_domain,
     ssh_host, ssh_ip, ssh_port, ssh_username, ssh_password_encrypted, ssh_password_fetched_at)
  SELECT id, ${sqlString(env.id)}, ${sqlString(env.environment_name)}, ${sqlBool(env.is_live)},
         ${sqlString(env.primary_domain)}, ${sqlString(env.ssh_host)}, ${sqlString(env.ssh_ip)},
         ${sqlInt(env.ssh_port)}, ${sqlString(env.ssh_username)},
         ${encryptedPassword ? sqlString(encryptedPassword) : 'NULL'},
         ${encryptedPassword ? 'NOW()' : 'NULL'}
  FROM kinsta_sites WHERE kinsta_site_id = ${sqlString(env.site_id)}
  ON CONFLICT (kinsta_environment_id) DO UPDATE SET
    environment_name = EXCLUDED.environment_name,
    is_live = EXCLUDED.is_live,
    primary_domain = EXCLUDED.primary_domain,
    ssh_host = EXCLUDED.ssh_host,
    ssh_ip = EXCLUDED.ssh_ip,
    ssh_port = EXCLUDED.ssh_port,
    ssh_username = EXCLUDED.ssh_username,
    ssh_password_encrypted = COALESCE(EXCLUDED.ssh_password_encrypted, kinsta_environments.ssh_password_encrypted),
    ssh_password_fetched_at = COALESCE(EXCLUDED.ssh_password_fetched_at, kinsta_environments.ssh_password_fetched_at),
    updated_at = NOW();`
    );
  }

  statements.push('COMMIT;');
  const sqlBlob = statements.join('\n\n');

  console.log('\n=== Import Plan ===');
  console.log(`Source DB:        ${sqlitePath}`);
  console.log(`Sites:            ${stats.sitesTotal}`);
  console.log(`Environments:     ${stats.envsTotal}`);
  console.log(`Passwords ok:     ${stats.pwdAvailable}`);
  console.log(`Passwords miss:   ${stats.pwdMissing}`);
  console.log(`Decrypt failed:   ${stats.pwdDecryptFailed}`);
  console.log(`Workspaces:       ${stats.workspacesPresent}`);

  if (args.dryRun) {
    console.log('\n[--dry-run] no write. Exiting.');
    return;
  }

  if (args.apply) {
    const dsn = args.dsn || process.env.DATABASE_URL;
    if (!dsn) {
      console.error('No DSN. Set DATABASE_URL or pass --dsn=...');
      process.exit(1);
    }
    const client = new pg.Client({ connectionString: dsn });
    await client.connect();
    try {
      console.log(`\n[apply] running against: ${dsn.replace(/:[^@/]*@/, ':***@')}`);
      await client.query(sqlBlob);
      const counts = await client.query(
        'SELECT (SELECT count(*) FROM kinsta_sites) AS sites, (SELECT count(*) FROM kinsta_environments) AS envs, (SELECT count(*) FROM kinsta_environments WHERE ssh_password_encrypted IS NOT NULL) AS with_pwd'
      );
      console.log('Final DB counts:', counts.rows[0]);
    } finally {
      await client.end();
    }
  } else {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, sqlBlob, 'utf8');
    console.log(`\nWrote ${args.output} (${(sqlBlob.length / 1024).toFixed(1)} KB).`);
    console.log('Apply with:  psql "$DATABASE_URL" -f ' + args.output);
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
