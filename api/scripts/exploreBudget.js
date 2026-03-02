const { suiteQL, netsuiteRequest } = require('../dist/shared/netsuiteClient');

(async () => {
  // 1. Check if budget record type exists in metadata
  console.log('--- Checking record types ---');
  try {
    const r = await netsuiteRequest('GET', '/record/v1/metadata-catalog/?select=budget');
    console.log('Budget metadata:', JSON.stringify(r, null, 2).substring(0, 500));
  } catch (e) {
    console.log('Budget metadata X:', e.message.substring(0, 200));
  }

  // 2. Check what PO transactions exist and their GL impact  
  console.log('\n--- PO transactions with GL accounts ---');
  try {
    const r = await suiteQL(`
      SELECT t.id, t.tranid, t.trandate, t.status, t.amount,
             tl.account, a.acctnumber, a.fullname,
             tl.department, d.name as deptname,
             tl.amount as lineamount
      FROM transaction t
      JOIN transactionline tl ON t.id = tl.transaction
      LEFT JOIN account a ON tl.account = a.id
      LEFT JOIN department d ON tl.department = d.id
      WHERE t.type = 'PurchOrd'
      AND ROWNUM < 20
      ORDER BY t.id DESC
    `);
    console.log(`PO lines (${r.totalResults} total):`);
    console.table(r.items.map(i => ({
      po: i.tranid,
      date: i.trandate,
      acct: i.acctnumber + ' ' + (i.fullname || '').substring(0, 25),
      dept: (i.deptname || '').substring(0, 20),
      lineAmt: i.lineamount,
    })));
  } catch (e) {
    console.log('PO transactions X:', e.message.substring(0, 300));
  }

  // 3. Summarize PO spend by GL account & department
  console.log('\n--- PO spend by account/department ---');
  try {
    const r = await suiteQL(`
      SELECT a.acctnumber, a.fullname as acctname, d.name as deptname,
             SUM(tl.amount) as total_amount, COUNT(*) as line_count
      FROM transaction t
      JOIN transactionline tl ON t.id = tl.transaction
      LEFT JOIN account a ON tl.account = a.id
      LEFT JOIN department d ON tl.department = d.id
      WHERE t.type = 'PurchOrd'
      GROUP BY a.acctnumber, a.fullname, d.name
      ORDER BY a.acctnumber
    `);
    console.log(`Spend breakdown (${r.totalResults} groups):`);
    console.table(r.items.map(i => ({
      acct: (i.acctnumber || '?') + ' ' + (i.acctname || '').substring(0, 30),
      dept: (i.deptname || '').substring(0, 20),
      total: i.total_amount,
      lines: i.line_count,
    })));
  } catch (e) {
    console.log('Spend breakdown X:', e.message.substring(0, 300));
  }

  // 4. Check accounting periods for current FY
  console.log('\n--- Current FY periods ---');
  try {
    const r = await suiteQL(`
      SELECT id, periodname, startdate, enddate, isquarter, isyear
      FROM AccountingPeriod
      WHERE startdate >= '07/01/2025' AND enddate <= '06/30/2026'
      ORDER BY startdate
    `);
    console.table(r.items.map(i => ({
      id: i.id, name: i.periodname, start: i.startdate, end: i.enddate,
      isQ: i.isquarter, isY: i.isyear,
    })));
  } catch (e) {
    console.log('Periods X:', e.message.substring(0, 200));
  }
})();
