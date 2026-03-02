const { suiteQL } = require('../dist/shared/netsuiteClient');

(async () => {
  // 1. Total actuals by account for FY2026 SSVF
  const periodResult = await suiteQL(`
    SELECT id FROM AccountingPeriod
    WHERE parent IN (
      SELECT id FROM AccountingPeriod WHERE parent = '72'
    )
    AND isyear = 'F' AND isquarter = 'F'
  `);
  const monthIds = periodResult.items.map(p => p.id).join(',');

  const totals = await suiteQL(`
    SELECT a.acctnumber, a.fullname,
           SUM(tl.amount) as total_spent,
           COUNT(*) as txn_count
    FROM transaction t
    JOIN transactionline tl ON t.id = tl.transaction
    JOIN account a ON tl.account = a.id
    JOIN department d ON tl.department = d.id
    WHERE a.acctnumber LIKE '88%'
      AND d.id IN (7, 617, 618)
      AND t.postingperiod IN (${monthIds})
    GROUP BY a.acctnumber, a.fullname
    ORDER BY SUM(tl.amount) DESC
  `);

  console.log('=== FY2026 SSVF 88xx Totals ===');
  let grandTotal = 0;
  totals.items.forEach(r => {
    const amt = Number(r.total_spent);
    grandTotal += amt;
    console.log(`  ${r.acctnumber} ${r.fullname}: $${amt.toLocaleString('en-US', {minimumFractionDigits: 2})} (${r.txn_count} txns)`);
  });
  console.log(`  GRAND TOTAL: $${grandTotal.toLocaleString('en-US', {minimumFractionDigits: 2})}`);

  // 2. Look at 8805 specifically — find the big transactions
  console.log('\n=== 8805 Room & Board — Largest Transactions ===');
  const bigTxns = await suiteQL(`
    SELECT t.id, t.tranid, t.trandate, t.type,
           tl.amount, tl.memo,
           d.name as dept,
           p.periodname
    FROM transaction t
    JOIN transactionline tl ON t.id = tl.transaction
    JOIN account a ON tl.account = a.id
    JOIN department d ON tl.department = d.id
    JOIN AccountingPeriod p ON t.postingperiod = p.id
    WHERE a.acctnumber = '8805'
      AND d.id IN (7, 617, 618)
      AND t.postingperiod IN (${monthIds})
    ORDER BY ABS(tl.amount) DESC
  `, 20);

  bigTxns.items.forEach(r => {
    console.log(`  ${r.trandate} ${r.type} #${r.tranid}: $${Number(r.amount).toLocaleString('en-US', {minimumFractionDigits: 2})} [${r.dept}] ${r.periodname} — ${r.memo || '(no memo)'}`);
  });

  // 3. Monthly breakdown for 8805 to see which month has the spike
  console.log('\n=== 8805 Room & Board — By Month ===');
  const monthly = await suiteQL(`
    SELECT p.periodname, d.name as dept,
           SUM(tl.amount) as spent, COUNT(*) as cnt
    FROM transaction t
    JOIN transactionline tl ON t.id = tl.transaction
    JOIN account a ON tl.account = a.id
    JOIN department d ON tl.department = d.id
    JOIN AccountingPeriod p ON t.postingperiod = p.id
    WHERE a.acctnumber = '8805'
      AND d.id IN (7, 617, 618)
      AND t.postingperiod IN (${monthIds})
    GROUP BY p.periodname, d.name
    ORDER BY p.periodname, d.name
  `);
  monthly.items.forEach(r => {
    console.log(`  ${r.periodname} ${r.dept}: $${Number(r.spent).toLocaleString('en-US', {minimumFractionDigits: 2})} (${r.cnt} txns)`);
  });
})().catch(e => console.error(e));
