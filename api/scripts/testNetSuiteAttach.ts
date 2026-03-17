/**
 * Test: SOAP-based file upload and attach to NetSuite PO.
 * Usage: npx ts-node scripts/testNetSuiteAttach.ts [poInternalId]
 *
 * Requires: NETSUITE_* env vars (loaded from local.settings.json)
 */
import * as path from 'path';
import * as fs from 'fs';

// Load env vars from local.settings.json
const settingsPath = path.join(__dirname, '..', 'local.settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
for (const [k, v] of Object.entries(settings.Values || {})) {
  process.env[k] = v as string;
}

import {
  ensureTFAFolder,
  uploadFileToNetSuite,
  attachFileToPO,
  suiteQL,
} from '../shared/netsuiteClient';

async function main() {
  const poInternalId = process.argv[2];

  console.log('=== NetSuite SOAP Attachment Test ===\n');

  // Step 1: Use an existing File Cabinet folder (skip folder creation)
  // "Attachments Received" (id -10) is the built-in NetSuite folder
  console.log('[Step 1] Using existing "Attachments Received" folder (id=-10)...');
  const folderId = '-10';
  console.log(`  ✓ Folder ID: ${folderId}`);

  // Step 2: Upload a test file via SOAP
  console.log('\n[Step 2] Uploading test file via SOAP...');
  const testContent = Buffer.from(
    `SSVF TFA Attachment Test\nTimestamp: ${new Date().toISOString()}\nThis file was uploaded via SOAP API.`,
  ).toString('base64');
  const testFileName = `TEST_SOAP_${Date.now()}.txt`;

  let fileId: string;
  try {
    fileId = await uploadFileToNetSuite(testFileName, testContent, folderId, 'Test attachment from SSVF TFA app');
    console.log(`  ✓ File uploaded, ID: ${fileId}`);
  } catch (err: any) {
    console.error(`  ✗ Upload failed: ${err.message}`);
    return;
  }

  // Step 3: Attach to PO if provided
  if (!poInternalId) {
    console.log('\n[Skip] No PO internal ID provided — skipping attach step.');
    console.log(`  File ${fileId} is in the File Cabinet under folder ${folderId}.`);
    console.log('  Run again with a PO ID to test attach:');
    console.log(`  npx ts-node scripts/testNetSuiteAttach.ts <poInternalId>`);

    // Find a recent PO for convenience
    try {
      const { items } = await suiteQL(
        `SELECT TOP 3 id, tranid FROM transaction WHERE type = 'PurchOrd' ORDER BY id DESC`,
        3,
      );
      if (items.length > 0) {
        console.log('\n  Recent POs:');
        for (const po of items) {
          console.log(`    id=${po.id}  tranid=${po.tranid}`);
        }
      }
    } catch {}
    return;
  }

  console.log(`\n[Step 3] Attaching file ${fileId} to PO ${poInternalId} via SOAP...`);
  try {
    await attachFileToPO(fileId, poInternalId);
    console.log(`  ✓ File attached to PO ${poInternalId}!`);
    console.log('  → Check NetSuite: Communications tab → Files subtab');
  } catch (err: any) {
    console.error(`  ✗ Attach failed: ${err.message}`);
  }

  console.log('\n=== Test Complete ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
