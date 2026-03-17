import * as path from 'path';
import * as fs from 'fs';

const settingsPath = path.join(__dirname, '..', 'local.settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
for (const [k, v] of Object.entries(settings.Values || {})) {
  process.env[k] = v as string;
}

import { suiteQL } from '../shared/netsuiteClient';

async function main() {
  console.log('Querying recent POs...');
  const { items } = await suiteQL(
    `SELECT TOP 5 id, tranid, entity FROM transaction WHERE type = 'PurchOrd' ORDER BY id DESC`,
    5,
  );
  for (const po of items) {
    console.log(`  id=${po.id}  tranid=${po.tranid}  entity=${po.entity}`);
  }
}

main().catch(console.error);
