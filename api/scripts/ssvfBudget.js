const { suiteQL } = require('../dist/shared/netsuiteClient');

/**
 * Targeted SSVF budget exploration:
 * - All 88xx expense accounts used by SSVF departments (3031, 3035, 3036)
 * - Current FY (Jul 2025 - Jun 2026) actuals
 * - Monthly breakdown for trend analysis
 * - Also check if budgets exist via different approaches
 */
(async () => {
  // 1. Get ALL distinct 88xx accounts used by SSVF departments
  console.log('=== SSVF 88xx Accounts ===');
  try {
    const r = await suiteQL(`
      SELECT DISTINCT a.id, a.acctnumber, a.fullname
      FROM transactionline tl
      JOIN account a ON tl.account = a.id
      JOIN department d ON tl.department = d.id
      WHERE a.acctnumber LIKE '88%'
        AND d.id IN (7, 617, 618)
      ORDER BY a.acctnumber
    `);
    console.table(r.items);
  } catch (e) {
    console.log('88xx accounts X:', e.message.substring(0, 300));
  }

  // 1b. Try with department names in case IDs are different
  console.log('\n=== SSVF Department IDs ===');
  try {
    const r = await suiteQL(`
      SELECT id, name, isinactive
      FROM department
      WHERE name LIKE '%SSVF%'
      ORDER BY id
    `);
    console.table(r.items);
  } catch (e) {
    console.log('Dept lookup X:', e.message.substring(0, 200));
  }

  // 2. Current FY spend by SSVF departments + 88xx accounts (monthly)
  console.log('\n=== SSVF TFA Spend - Current FY by Month ===');
  try {
    const r = await suiteQL(`
      SELECT a.acctnumber, a.fullname as acctname,
             d.name as dept,
             p.periodname as period,
             SUM(tl.amount) as spent,
             COUNT(*) as txn_count
      FROM transaction t
      JOIN transactionline tl ON t.id = tl.transaction
      JOIN account a ON tl.account = a.id
      JOIN department d ON tl.department = d.id
      JOIN AccountingPeriod p ON t.postingperiod = p.id
      WHERE a.acctnumber LIKE '88%'
        AND d.name LIKE '%SSVF%'
        AND t.trandate >= '07/01/2025'
        AND t.trandate <= '06/30/2026'
      GROUP BY a.acctnumber, a.fullname, d.name, p.periodname
      ORDER BY a.acctnumber, d.name, p.periodname
    `);
    console.log(`Current FY SSVF 88xx spend (${r.totalResults} groups):`);
    console.table(r.items.map(i => ({
      acct: i.acctnumber + ' ' + (i.acctname || '').substring(0, 30),
      dept: i.dept,
      period: i.period,
      spent: Number(i.spent).toFixed(2),
      txns: i.txn_count,
    })));
  } catch (e) {
    console.log('Current FY spend X:', e.message.substring(0, 300));
  }

  // 3. ALL-TIME SSVF 88xx spend (to understand historical data if FY is empty in sandbox)
  console.log('\n=== SSVF TFA Spend - ALL TIME ===');
  try {
    const r = await suiteQL(`
      SELECT a.acctnumber, a.fullname as acctname,
             d.name as dept,
             SUM(tl.amount) as total_spent,
             COUNT(*) as txn_count
      FROM transaction t
      JOIN transactionline tl ON t.id = tl.transaction
      JOIN account a ON tl.account = a.id
      JOIN department d ON tl.department = d.id
      WHERE a.acctnumber LIKE '88%'
        AND d.name LIKE '%SSVF%'
      GROUP BY a.acctnumber, a.fullname, d.name
      ORDER BY a.acctnumber, d.name
    `);
    console.log(`All-time SSVF 88xx spend (${r.totalResults} groups):`);
    console.table(r.items.map(i => ({
      acct: i.acctnumber + ' ' + (i.acctname || '').substring(0, 35),
      dept: i.dept,
      total: Number(i.total_spent).toFixed(2),
      txns: i.txn_count,
    })));
  } catch (e) {
    console.log('All-time spend X:', e.message.substring(0, 300));
  }

  // 4. Check if budgets are stored in custom records or saved searches
  console.log('\n=== Custom Record Types (budget-related) ===');
  try {
    const r = await suiteQL(`
      SELECT id, scriptid, name
      FROM customrecordtype
      WHERE LOWER(name) LIKE '%budget%' OR LOWER(scriptid) LIKE '%budget%'
    `);
    console.log('Custom budget records:', r.items.length ? '' : 'NONE');
    if (r.items.length) console.table(r.items);
  } catch (e) {
    console.log('Custom records X:', e.message.substring(0, 200));
  }

  // 5. Check if there are any budget-related items/lists  
  console.log('\n=== All Custom Lists (budget-related) ===');
  try {
    const r = await suiteQL(`
      SELECT id, scriptid, name
      FROM customlist
      WHERE LOWER(name) LIKE '%budget%' OR LOWER(scriptid) LIKE '%budget%'
    `);
    console.log('Custom budget lists:', r.items.length ? '' : 'NONE');
    if (r.items.length) console.table(r.items);
  } catch (e) {
    console.log('Custom lists X:', e.message.substring(0, 200));
  }

  // 6. Try querying budgetmachine table (internal NS budget tracking)
  console.log('\n=== Budget Import/Machine ===');
  for (const tbl of ['budgetexchangerate', 'budgetrates', 'budgetimport', 'budgetmachine']) {
    try {
      const r = await suiteQL(`SELECT * FROM ${tbl} WHERE ROWNUM < 5`);
      console.log(`${tbl}: ${r.totalResults} rows`, r.items.length ? r.items : '');
    } catch (e) {
      console.log(`${tbl}: X (${e.message.substring(0, 80)})`);
    }
  }

  // 7. Try the new Analytics approach - check consolidated exchange rate or budgets
  console.log('\n=== Account Budgets via GL ===');
  try {
    const r = await suiteQL(`
      SELECT a.acctnumber, a.fullname, a.generalrate, a.cashflowrate
      FROM account a
      WHERE a.acctnumber LIKE '88%'
      ORDER BY a.acctnumber
    `);
    console.log(`All 88xx accounts (${r.totalResults}):`);
    console.table(r.items.map(i => ({
      num: i.acctnumber,
      name: i.fullname,
      genRate: i.generalrate,
      cfRate: i.cashflowrate,
    })));
  } catch (e) {
    console.log('GL accounts X:', e.message.substring(0, 200));
  }

})();
