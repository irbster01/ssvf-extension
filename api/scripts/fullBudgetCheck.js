const { suiteQL } = require('../dist/shared/netsuiteClient');

(async () => {
  // 1. Get all budgeted account numbers for FY2026 SSVF
  const budgets = await suiteQL(`
    SELECT a.acctnumber, a.fullname, d.name as dept, bi.amount as budget
    FROM budgetimport bi
    JOIN account a ON bi.account = a.id
    JOIN department d ON bi.department = d.id
    WHERE bi.department IN (7, 617, 618)
      AND bi.year = '72'
    ORDER BY a.acctnumber, d.name
  `);

  console.log(`=== All FY2026 SSVF Budgeted Accounts (${budgets.items.length} rows) ===`);
  const acctNums = new Set();
  budgets.items.forEach(r => {
    acctNums.add(r.acctnumber);
    console.log(`  ${r.acctnumber} ${r.fullname} [${r.dept}]: $${Number(r.budget).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  });

  // 2. Get monthly period IDs for FY2026
  const periodResult = await suiteQL(`
    SELECT id FROM AccountingPeriod
    WHERE parent IN (SELECT id FROM AccountingPeriod WHERE parent = '72')
    AND isyear = 'F' AND isquarter = 'F'
  `);
  const monthIds = periodResult.items.map(p => p.id).join(',');

  // 3. Get actuals for ALL budgeted accounts
  const allAcctFilter = [...acctNums].map(n => `'${n}'`).join(', ');
  console.log(`\nQuerying actuals for ${acctNums.size} unique accounts: ${[...acctNums].join(', ')}`);

  const actuals = await suiteQL(`
    SELECT a.acctnumber, a.fullname,
           d.name as dept,
           SUM(tl.amount) as spent,
           COUNT(*) as cnt
    FROM transaction t
    JOIN transactionline tl ON t.id = tl.transaction
    JOIN account a ON tl.account = a.id
    JOIN department d ON tl.department = d.id
    WHERE a.acctnumber IN (${allAcctFilter})
      AND d.id IN (7, 617, 618)
      AND t.postingperiod IN (${monthIds})
    GROUP BY a.acctnumber, a.fullname, d.name
    ORDER BY a.acctnumber, d.name
  `);

  console.log(`\n=== FY2026 Actuals for ALL Budgeted Accounts (${actuals.items.length} rows) ===`);
  let grandBudget = 0, grandSpent = 0;
  
  // Build actuals map
  const actualsMap = {};
  actuals.items.forEach(r => {
    const key = `${r.acctnumber}|${r.dept}`;
    actualsMap[key] = { spent: Number(r.spent), cnt: Number(r.cnt) };
  });

  // Compare budget vs actuals
  console.log('\n=== Budget vs Actuals Comparison ===');
  console.log(`${'Acct'.padEnd(6)} ${'Name'.padEnd(40)} ${'Dept'.padEnd(22)} ${'Budget'.padStart(14)} ${'Actual'.padStart(14)} ${'Remaining'.padStart(14)} ${'%'.padStart(6)}`);
  console.log('-'.repeat(120));
  
  budgets.items.forEach(r => {
    const budget = Number(r.budget);
    const key = `${r.acctnumber}|${r.dept}`;
    const actual = actualsMap[key]?.spent || 0;
    const remaining = budget - actual;
    const pct = budget > 0 ? Math.round((actual / budget) * 100) : 0;
    const name = r.fullname.replace('EXPENSES : ', '').substring(0, 38);
    grandBudget += budget;
    grandSpent += actual;
    console.log(`${r.acctnumber.padEnd(6)} ${name.padEnd(40)} ${r.dept.substring(0,20).padEnd(22)} ${('$' + budget.toLocaleString('en-US', {minimumFractionDigits: 2})).padStart(14)} ${('$' + actual.toLocaleString('en-US', {minimumFractionDigits: 2})).padStart(14)} ${('$' + remaining.toLocaleString('en-US', {minimumFractionDigits: 2})).padStart(14)} ${(pct + '%').padStart(6)}`);
  });
  
  console.log('-'.repeat(120));
  const grandRemaining = grandBudget - grandSpent;
  const grandPct = grandBudget > 0 ? Math.round((grandSpent / grandBudget) * 100) : 0;
  console.log(`${'TOTAL'.padEnd(6)} ${''.padEnd(40)} ${''.padEnd(22)} ${('$' + grandBudget.toLocaleString('en-US', {minimumFractionDigits: 2})).padStart(14)} ${('$' + grandSpent.toLocaleString('en-US', {minimumFractionDigits: 2})).padStart(14)} ${('$' + grandRemaining.toLocaleString('en-US', {minimumFractionDigits: 2})).padStart(14)} ${(grandPct + '%').padStart(6)}`);

  // 4. Check: any actuals in SSVF that have NO budget?
  console.log('\n=== Unbudgeted SSVF Spend (accounts with actuals but no budget) ===');
  const unbud = await suiteQL(`
    SELECT a.acctnumber, a.fullname,
           SUM(tl.amount) as spent, COUNT(*) as cnt
    FROM transaction t
    JOIN transactionline tl ON t.id = tl.transaction  
    JOIN account a ON tl.account = a.id
    JOIN department d ON tl.department = d.id
    WHERE a.acctnumber LIKE '88%'
      AND a.acctnumber NOT IN (${allAcctFilter})
      AND d.id IN (7, 617, 618)
      AND t.postingperiod IN (${monthIds})
    GROUP BY a.acctnumber, a.fullname
    ORDER BY a.acctnumber
  `);
  if (unbud.items.length === 0) {
    console.log('  (none — all 88xx spend has a matching budget)');
  } else {
    unbud.items.forEach(r => console.log(`  ${r.acctnumber} ${r.fullname}: $${Number(r.spent).toLocaleString('en-US', {minimumFractionDigits: 2})} (${r.cnt} txns)`));
  }
})().catch(e => console.error(e));
