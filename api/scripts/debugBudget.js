const { suiteQL } = require('../dist/shared/netsuiteClient');

(async () => {
  // Check the period hierarchy
  const fy = await suiteQL(
    `SELECT id, periodname, isyear, isquarter, parent FROM AccountingPeriod WHERE isyear='T' AND startdate <= SYSDATE AND enddate >= SYSDATE`,
    1
  );
  console.log('Current FY:', JSON.stringify(fy.items[0]));
  const fyId = fy.items[0].id;

  // What has parent = fyId?
  const children = await suiteQL(
    `SELECT id, periodname, isyear, isquarter, parent FROM AccountingPeriod WHERE parent = '${fyId}' ORDER BY id`
  );
  console.log('\nDirect children of FY (' + children.items.length + '):');
  children.items.forEach(c => console.log(`  ${c.id} ${c.periodname} isquarter=${c.isquarter}`));

  // Check monthly periods (grandchildren)
  if (children.items.length > 0 && children.items[0].isquarter === 'T') {
    const qIds = children.items.map(c => c.id).join(',');
    const months = await suiteQL(
      `SELECT id, periodname, parent FROM AccountingPeriod WHERE parent IN (${qIds}) ORDER BY id`
    );
    console.log('\nMonthly periods (grandchildren of FY):', months.items.length);
    months.items.forEach(m => console.log(`  ${m.id} ${m.periodname} parent=${m.parent}`));

    // Now try actuals query with monthly period IDs
    const monthIds = months.items.map(m => m.id).join(',');
    const actuals = await suiteQL(
      `SELECT a.acctnumber, d.name as dept, SUM(tl.amount) as spent, COUNT(*) as cnt
       FROM transaction t
       JOIN transactionline tl ON t.id = tl.transaction
       JOIN account a ON tl.account = a.id
       JOIN department d ON tl.department = d.id
       WHERE a.acctnumber LIKE '88%'
         AND d.id IN (7, 617, 618)
         AND t.postingperiod IN (${monthIds})
       GROUP BY a.acctnumber, d.name
       ORDER BY a.acctnumber`
    );
    console.log('\nActuals with monthly period IDs:', actuals.items.length, 'rows');
    actuals.items.forEach(r => console.log(`  ${r.acctnumber} ${r.dept}: $${Number(r.spent).toFixed(2)} (${r.cnt} txns)`));
  }

  // Also test: what does p.parent = fyId return?
  const directTest = await suiteQL(
    `SELECT COUNT(*) as cnt
     FROM transaction t
     JOIN transactionline tl ON t.id = tl.transaction
     JOIN account a ON tl.account = a.id
     JOIN department d ON tl.department = d.id
     JOIN AccountingPeriod p ON t.postingperiod = p.id
     WHERE a.acctnumber LIKE '88%'
       AND d.id IN (7, 617, 618)
       AND p.parent = '${fyId}'
       AND p.isyear = 'F'`
  );
  console.log('\nDirect p.parent = fyId test:', JSON.stringify(directTest.items[0]));
})().catch(e => console.error(e));
