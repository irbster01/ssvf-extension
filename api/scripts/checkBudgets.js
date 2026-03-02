const { suiteQL } = require('../dist/shared/netsuiteClient');

(async () => {
  // Check SSVF budgets in budgetimport (dept 7=SSVF, 617=ARK, 618=MONROE)
  console.log('=== SSVF Budgets in budgetimport ===');
  const r1 = await suiteQL(`
    SELECT bi.id, bi.account, a.acctnumber, a.fullname,
           bi.department, d.name as deptname,
           bi.amount, bi.year,
           bi.periodamount1, bi.periodamount2, bi.periodamount3,
           bi.periodamount4, bi.periodamount5, bi.periodamount6,
           bi.periodamount7, bi.periodamount8, bi.periodamount9,
           bi.periodamount10, bi.periodamount11, bi.periodamount12
    FROM budgetimport bi
    LEFT JOIN account a ON bi.account = a.id
    LEFT JOIN department d ON bi.department = d.id
    WHERE bi.department IN (7, 617, 618)
    ORDER BY a.acctnumber, d.name
  `);
  console.log('SSVF budgets:', r1.totalResults, 'rows');
  console.table(r1.items.map(i => ({
    acct: i.acctnumber + ' ' + (i.fullname || '').substring(0, 30),
    dept: i.deptname,
    annual: i.amount,
    yr: i.year,
    m1: i.periodamount1, m6: i.periodamount6, m12: i.periodamount12,
  })));

  // Check what years exist
  console.log('\n=== Budget Years ===');
  const r2 = await suiteQL(`
    SELECT DISTINCT bi.year, ap.periodname, ap.startdate, ap.enddate
    FROM budgetimport bi
    LEFT JOIN AccountingPeriod ap ON bi.year = ap.id
    ORDER BY bi.year
  `);
  console.table(r2.items);

  // How many total budgets?
  console.log('\n=== All budgetimport count by dept ===');
  const r3 = await suiteQL(`
    SELECT d.name, COUNT(*) as cnt, SUM(bi.amount) as total
    FROM budgetimport bi
    LEFT JOIN department d ON bi.department = d.id
    GROUP BY d.name
    ORDER BY d.name
  `);
  console.table(r3.items.map(i => ({
    dept: i.name, count: i.cnt, total: i.total,
  })));
})();
