/**
 * One-time seed script: Loads deduplicated client records from "client seed.csv"
 * into the Cosmos DB `clients` container.
 *
 * Usage:  npx ts-node scripts/seedClients.ts
 *
 * Requires COSMOS_ENDPOINT and COSMOS_KEY env vars (or ../local.settings.json).
 */
import * as fs from 'fs';
import * as path from 'path';
import { CosmosClient } from '@azure/cosmos';

interface CsvRow {
  'Client ID': string;
  'First Name': string;
  'Last Name': string;
  'Exit Date': string;
  'Provider': string;
}

// Simple CSV parser (no external dep)
function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj: any = {};
    headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim(); });
    return obj;
  });
}

async function main() {
  // Load settings
  const settingsPath = path.resolve(__dirname, '../local.settings.json');
  let endpoint = process.env.COSMOS_ENDPOINT;
  let key = process.env.COSMOS_KEY;
  let databaseId = process.env.COSMOS_DATABASE || 'ssvf-services';

  if (!endpoint || !key) {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      endpoint = endpoint || settings.Values?.COSMOS_ENDPOINT;
      key = key || settings.Values?.COSMOS_KEY;
      databaseId = databaseId || settings.Values?.COSMOS_DATABASE || 'ssvf-services';
    }
  }

  if (!endpoint || !key) {
    console.error('Set COSMOS_ENDPOINT and COSMOS_KEY env vars or ensure local.settings.json exists.');
    process.exit(1);
  }

  // Read main CSV
  const csvPath = path.resolve(__dirname, '../../client seed.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found at:', csvPath);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf-8'));
  console.log(`Parsed ${rows.length} rows from main CSV`);

  // Read Arkansas SP seed CSV (SSVF entries only)
  const spCsvPath = path.resolve(__dirname, '../../sp seed 3.csv');
  if (fs.existsSync(spCsvPath)) {
    const spRows = parseCsv(fs.readFileSync(spCsvPath, 'utf-8'));
    const ssvfRows = spRows.filter(r => (r['Provider'] || '').toUpperCase().includes('SSVF'));
    console.log(`Parsed ${spRows.length} rows from SP seed (${ssvfRows.length} SSVF entries)`);
    rows.push(...ssvfRows);
  } else {
    console.warn('SP seed CSV not found, skipping:', spCsvPath);
  }

  // FIRST: Filter to SSVF-related providers only
  const ssvfOnly = rows.filter(r => {
    const p = (r['Provider'] || '').toUpperCase();
    return p.includes('SSVF') || p.includes('VASH');
  });
  console.log(`${ssvfOnly.length} SSVF/VASH rows after provider filter (excluded ${rows.length - ssvfOnly.length} non-SSVF)`);

  // Cut-off: exclude clients whose most recent exit is over 1 year ago
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  // For each Client ID, track the most recent exit date, name, provider, and derived program/region
  const clientMap = new Map<string, { id: string; clientName: string; provider: string; program: string; region: string; latestExit: Date | null }>();

  for (const row of ssvfOnly) {
    const id = row['Client ID']?.trim();
    if (!id) continue;
    const first = row['First Name']?.trim() || '';
    const last = row['Last Name']?.trim() || '';
    const clientName = `${first} ${last}`.trim();
    if (!clientName) continue;
    const provider = row['Provider']?.trim() || '';
    const pUp = provider.toUpperCase();

    // Derive program from provider
    let program = '';
    if (pUp.includes('HOMELESS PREV') || pUp.includes('VASH HP')) {
      program = 'Homeless Prevention';
    } else if (pUp.includes('RAPID RE') || pUp.includes('SHALLOW SUBSID') || pUp.includes('VASH RRH')) {
      program = 'Rapid Rehousing';
    }

    // Derive region — Arkansas clients come from sp seed, identifiable by provider
    let region = '';
    if (pUp.includes('ARKANSAS')) {
      region = 'Arkansas';
    }

    // Parse exit date (M/D/YYYY)
    const exitStr = row['Exit Date']?.trim();
    let exitDate: Date | null = null;
    if (exitStr) {
      exitDate = new Date(exitStr);
      if (isNaN(exitDate.getTime())) exitDate = null;
    }

    const existing = clientMap.get(id);
    if (!existing) {
      clientMap.set(id, { id, clientName, provider, program, region, latestExit: exitDate });
    } else {
      // Keep the most recent exit date (null = still active, always wins)
      if (exitDate === null) {
        existing.latestExit = null; // still active
        existing.provider = provider;
        existing.program = program || existing.program;
        existing.region = region || existing.region;
      } else if (existing.latestExit !== null && exitDate > existing.latestExit) {
        existing.latestExit = exitDate;
        existing.clientName = clientName;
        existing.provider = provider;
        existing.program = program || existing.program;
        existing.region = region || existing.region;
      }
    }
  }

  // Filter: keep clients who are still active (no exit) or exited within the last year
  const seen = new Map<string, { id: string; clientName: string; provider: string; program: string; region: string }>();
  let excludedCount = 0;

  for (const [id, record] of clientMap) {
    if (record.latestExit !== null && record.latestExit < oneYearAgo) {
      excludedCount++;
      continue;
    }
    seen.set(id, { id: record.id, clientName: record.clientName, provider: record.provider, program: record.program, region: record.region });
  }

  console.log(`${clientMap.size} unique client IDs found`);
  console.log(`${excludedCount} excluded (exited over 1 year ago)`);
  console.log(`${seen.size} clients to upsert`);

  // Connect to Cosmos
  const client = new CosmosClient({ endpoint, key });
  const { database } = await client.databases.createIfNotExists({ id: databaseId });
  const { container } = await database.containers.createIfNotExists({
    id: 'clients',
    partitionKey: { paths: ['/id'] },
  });

  // Delete the container and recreate to clear stale records
  console.log('Clearing old client data...');
  try {
    await container.delete();
  } catch { /* may not exist */ }
  const { container: freshContainer } = await database.containers.createIfNotExists({
    id: 'clients',
    partitionKey: { paths: ['/id'] },
  });

  // Batch upsert
  let count = 0;
  const batch: Promise<any>[] = [];

  for (const record of seen.values()) {
    batch.push(
      freshContainer.items.upsert({
        ...record,
        addedBy: 'seed-script',
        addedAt: new Date().toISOString(),
      }).then(() => {
        count++;
        if (count % 100 === 0) console.log(`  ${count}/${seen.size} upserted...`);
      })
    );

    // Throttle to 50 concurrent requests
    if (batch.length >= 50) {
      await Promise.all(batch);
      batch.length = 0;
    }
  }

  if (batch.length > 0) await Promise.all(batch);

  console.log(`Done! ${count} clients seeded into Cosmos DB.`);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
