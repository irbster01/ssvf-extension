import * as path from 'path';
import * as fs from 'fs';
const settingsPath = path.join(__dirname, '..', 'local.settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
for (const [k, v] of Object.entries(settings.Values || {})) process.env[k] = v as string;

import { suiteQL } from '../shared/netsuiteClient';

async function main() {
  const { items } = await suiteQL(
    `SELECT id, name, parent FROM mediaitemfolder WHERE name LIKE '%Attach%' OR name LIKE '%File%' OR name LIKE '%TFA%' OR parent IS NULL ORDER BY name`,
    50,
  );
  for (const f of items) {
    console.log(`id=${f.id}  parent=${f.parent || 'ROOT'}  name="${f.name}"`);
  }
}
main().catch(console.error);
