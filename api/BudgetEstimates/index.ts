import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { suiteQL } from '../shared/netsuiteClient';
import { validateAuthWithRole, isElevated } from '../shared/rbac';
import { getCorsHeaders as _getCors } from '../shared/cors';

function getCorsHeaders(origin: string) {
  return _getCors(origin, 'GET, OPTIONS');
}

/**
 * SSVF department IDs and their region mapping.
 */
const SSVF_DEPARTMENTS: Record<string, string> = {
  '7':   '3031 SSVF',           // Shreveport
  '617': '3035 SSVF - ARKANSAS', // Arkansas
  '618': '3036 SSVF - MONROE',   // Monroe
};
const SSVF_DEPT_IDS = Object.keys(SSVF_DEPARTMENTS).join(', ');

/**
 * Map department name to region label for frontend display.
 */
function deptToRegion(deptName: string): string {
  if (deptName.includes('ARKANSAS')) return 'Arkansas';
  if (deptName.includes('MONROE')) return 'Monroe';
  return 'Shreveport';
}

/**
 * Friendly short names for 88xx GL accounts.
 */
const ACCOUNT_SHORT_NAMES: Record<string, string> = {
  '8801': 'Direct Client Assistance',
  '8805': 'Room & Board',
  '8810': 'Room & Board (Intercompany)',
  '8815': 'Client Utilities',
  '8820': 'Client Food Service',
  '8825': 'Canteen Expenses',
  '8830': 'Clothing & Personal Needs',
  '8835': 'Incentives',
  '8840': 'Medical Fees',
  '8845': 'Cash Subsidy / Scholarships',
  '8846': 'Cash Subsidy',
  '8850': 'Moving Expenses',
  '8855': 'Client Furniture',
  '8860': 'Transportation',
  '8865': 'Client Needs (COVID-19)',
};

// Cache budget data for 15 minutes (avoid hammering NetSuite)
let budgetCache: { data: any; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

interface BudgetLineItem {
  accountNumber: string;
  accountName: string;
  department: string;
  region: string;
  budgetAnnual: number;
  budgetMonthly: number[];
  actualSpent: number;
  actualByMonth: Record<string, number>;
  remaining: number;
  percentUsed: number;
  transactionCount: number;
}

interface BudgetSummary {
  fiscalYear: string;
  fiscalYearId: string;
  asOf: string;
  departments: string[];
  lineItems: BudgetLineItem[];
  totals: {
    totalBudget: number;
    totalSpent: number;
    totalRemaining: number;
    percentUsed: number;
  };
  byRegion: Record<string, {
    totalBudget: number;
    totalSpent: number;
    remaining: number;
    percentUsed: number;
  }>;
}

async function fetchBudgetData(context: InvocationContext): Promise<BudgetSummary> {
  // Check cache
  if (budgetCache && Date.now() - budgetCache.fetchedAt < CACHE_TTL_MS) {
    context.log('[Budget] Returning cached data');
    return budgetCache.data;
  }

  context.log('[Budget] Fetching fresh data from NetSuite');

  // 1. Find current fiscal year ID
  const fyResult = await suiteQL(`
    SELECT id, periodname, startdate, enddate
    FROM AccountingPeriod
    WHERE isyear = 'T'
      AND startdate <= SYSDATE
      AND enddate >= SYSDATE
    ORDER BY startdate DESC
  `, 1);

  if (fyResult.items.length === 0) {
    throw new Error('No active fiscal year found in NetSuite');
  }

  const currentFY = fyResult.items[0];
  const fyId = currentFY.id;
  const fyName = currentFY.periodname;
  const fyStart = currentFY.startdate;
  const fyEnd = currentFY.enddate;

  context.log(`[Budget] Current FY: ${fyName} (ID: ${fyId}, ${fyStart} - ${fyEnd})`);

  // 2. Get budgets from budgetimport for SSVF departments + current FY
  const budgetResult = await suiteQL(`
    SELECT bi.account, a.acctnumber, a.fullname,
           bi.department, d.name as deptname,
           bi.amount as annual_budget,
           bi.periodamount1, bi.periodamount2, bi.periodamount3,
           bi.periodamount4, bi.periodamount5, bi.periodamount6,
           bi.periodamount7, bi.periodamount8, bi.periodamount9,
           bi.periodamount10, bi.periodamount11, bi.periodamount12
    FROM budgetimport bi
    JOIN account a ON bi.account = a.id
    JOIN department d ON bi.department = d.id
    WHERE bi.department IN (${SSVF_DEPT_IDS})
      AND bi.year = '${fyId}'
    ORDER BY a.acctnumber, d.name
  `);

  context.log(`[Budget] Found ${budgetResult.totalResults} budget rows for FY ${fyName}`);

  // 2b. Get all monthly period IDs belonging to this fiscal year.
  //     NetSuite hierarchy: Year → Quarter → Month, so months are grandchildren.
  const periodResult = await suiteQL(`
    SELECT id FROM AccountingPeriod
    WHERE parent IN (
      SELECT id FROM AccountingPeriod WHERE parent = '${fyId}'
    )
    AND isyear = 'F' AND isquarter = 'F'
  `);
  const monthPeriodIds = periodResult.items.map((p: any) => p.id).join(', ');
  context.log(`[Budget] Monthly period IDs for FY: ${monthPeriodIds}`);

  // 3. Get actual spend from transactions for SSVF departments + 88xx accounts + current FY
  //    Filter by posting period belonging to current fiscal year (Year→Quarter→Month hierarchy)
  const actualsResult = await suiteQL(`
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
      AND d.id IN (${SSVF_DEPT_IDS})
      AND t.postingperiod IN (${monthPeriodIds})
    GROUP BY a.acctnumber, a.fullname, d.name, p.periodname
    ORDER BY a.acctnumber, d.name
  `);

  context.log(`[Budget] Found ${actualsResult.totalResults} actual spend groups`);

  // 4. Also get actuals for non-88xx budgeted accounts (operational)
  const budgetedAcctNumbers = budgetResult.items
    .map((b: any) => b.acctnumber)
    .filter((n: string) => !n.startsWith('88'));
  const uniqueAcctNums = [...new Set(budgetedAcctNumbers)] as string[];

  let operationalActuals: any[] = [];
  if (uniqueAcctNums.length > 0) {
    // Batch query for operational accounts
    const acctFilter = uniqueAcctNums.map(n => `'${n}'`).join(', ');
    const opResult = await suiteQL(`
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
      WHERE a.acctnumber IN (${acctFilter})
        AND d.id IN (${SSVF_DEPT_IDS})
        AND t.postingperiod IN (${monthPeriodIds})
      GROUP BY a.acctnumber, a.fullname, d.name, p.periodname
      ORDER BY a.acctnumber, d.name
    `);
    operationalActuals = opResult.items;
  }

  const allActuals = [...actualsResult.items, ...operationalActuals];

  // 5. Build actuals lookup: key = "acctNumber|deptName"
  const actualsMap = new Map<string, { total: number; byMonth: Record<string, number>; txnCount: number }>();
  for (const row of allActuals) {
    const key = `${row.acctnumber}|${row.dept}`;
    if (!actualsMap.has(key)) {
      actualsMap.set(key, { total: 0, byMonth: {}, txnCount: 0 });
    }
    const entry = actualsMap.get(key)!;
    const amount = Number(row.spent) || 0;
    entry.total += amount;
    entry.byMonth[row.period] = (entry.byMonth[row.period] || 0) + amount;
    entry.txnCount += Number(row.txn_count) || 0;
  }

  // 6. Build line items from budget data
  const lineItems: BudgetLineItem[] = [];
  const seenKeys = new Set<string>();

  for (const budget of budgetResult.items) {
    const acctNum = budget.acctnumber;
    const deptName = budget.deptname;
    const key = `${acctNum}|${deptName}`;
    seenKeys.add(key);

    const annualBudget = Number(budget.annual_budget) || 0;
    const monthlyBudget = [
      Number(budget.periodamount1) || 0, Number(budget.periodamount2) || 0,
      Number(budget.periodamount3) || 0, Number(budget.periodamount4) || 0,
      Number(budget.periodamount5) || 0, Number(budget.periodamount6) || 0,
      Number(budget.periodamount7) || 0, Number(budget.periodamount8) || 0,
      Number(budget.periodamount9) || 0, Number(budget.periodamount10) || 0,
      Number(budget.periodamount11) || 0, Number(budget.periodamount12) || 0,
    ];

    const actuals = actualsMap.get(key);
    const actualSpent = actuals?.total || 0;
    const remaining = annualBudget - actualSpent;

    lineItems.push({
      accountNumber: acctNum,
      accountName: ACCOUNT_SHORT_NAMES[acctNum] || budget.fullname?.replace('EXPENSES : ', '') || acctNum,
      department: deptName,
      region: deptToRegion(deptName),
      budgetAnnual: annualBudget,
      budgetMonthly: monthlyBudget,
      actualSpent,
      actualByMonth: actuals?.byMonth || {},
      remaining,
      percentUsed: annualBudget > 0 ? Math.round((actualSpent / annualBudget) * 100) : 0,
      transactionCount: actuals?.txnCount || 0,
    });
  }

  // 7. Add any actuals that don't have a matching budget (over-budget / unbudgeted spend)
  for (const [key, actuals] of actualsMap) {
    if (!seenKeys.has(key)) {
      const [acctNum, deptName] = key.split('|');
      lineItems.push({
        accountNumber: acctNum,
        accountName: ACCOUNT_SHORT_NAMES[acctNum] || acctNum,
        department: deptName,
        region: deptToRegion(deptName),
        budgetAnnual: 0,
        budgetMonthly: Array(12).fill(0),
        actualSpent: actuals.total,
        actualByMonth: actuals.byMonth,
        remaining: -actuals.total,
        percentUsed: 0, // no budget = can't calculate percentage
        transactionCount: actuals.txnCount,
      });
    }
  }

  // Sort: 88xx TFA accounts first, then operational, by account number
  lineItems.sort((a, b) => {
    const aIsTFA = a.accountNumber.startsWith('88');
    const bIsTFA = b.accountNumber.startsWith('88');
    if (aIsTFA !== bIsTFA) return aIsTFA ? -1 : 1;
    if (a.accountNumber !== b.accountNumber) return a.accountNumber.localeCompare(b.accountNumber);
    return a.department.localeCompare(b.department);
  });

  // 8. Compute totals
  let totalBudget = 0, totalSpent = 0;
  const byRegion: Record<string, { totalBudget: number; totalSpent: number; remaining: number; percentUsed: number }> = {};

  for (const item of lineItems) {
    totalBudget += item.budgetAnnual;
    totalSpent += item.actualSpent;

    if (!byRegion[item.region]) {
      byRegion[item.region] = { totalBudget: 0, totalSpent: 0, remaining: 0, percentUsed: 0 };
    }
    byRegion[item.region].totalBudget += item.budgetAnnual;
    byRegion[item.region].totalSpent += item.actualSpent;
  }

  for (const region of Object.values(byRegion)) {
    region.remaining = region.totalBudget - region.totalSpent;
    region.percentUsed = region.totalBudget > 0 ? Math.round((region.totalSpent / region.totalBudget) * 100) : 0;
  }

  const summary: BudgetSummary = {
    fiscalYear: fyName,
    fiscalYearId: fyId,
    asOf: new Date().toISOString(),
    departments: Object.values(SSVF_DEPARTMENTS),
    lineItems,
    totals: {
      totalBudget,
      totalSpent,
      totalRemaining: totalBudget - totalSpent,
      percentUsed: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
    },
    byRegion,
  };

  // Cache the result
  budgetCache = { data: summary, fetchedAt: Date.now() };
  return summary;
}

// ============ BUDGET ESTIMATES ENDPOINT ============
app.http('BudgetEstimates', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'budget',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const origin = request.headers.get('origin') || '';
    const cors = getCorsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: cors };
    }

    // Auth check - elevated users only
    const auth = await validateAuthWithRole(request, context);
    if (!auth.valid) {
      return { status: 401, headers: cors, jsonBody: { error: 'Unauthorized' } };
    }
    if (!isElevated(auth.role!)) {
      return { status: 403, headers: cors, jsonBody: { error: 'Budget data requires elevated access' } };
    }

    context.log(`[Budget] Requested by ${auth.userId} (${auth.role})`);

    // Optional query params
    const regionFilter = request.query.get('region'); // "Shreveport" | "Monroe" | "Arkansas"
    const tfaOnly = request.query.get('tfa') === 'true'; // only 88xx accounts

    try {
      const summary = await fetchBudgetData(context);

      // Apply filters if specified
      let filteredItems = summary.lineItems;
      if (regionFilter) {
        filteredItems = filteredItems.filter(item => item.region === regionFilter);
      }
      if (tfaOnly) {
        filteredItems = filteredItems.filter(item => item.accountNumber.startsWith('88'));
      }

      // Recompute totals for filtered data
      let totalBudget = 0, totalSpent = 0;
      for (const item of filteredItems) {
        totalBudget += item.budgetAnnual;
        totalSpent += item.actualSpent;
      }

      return {
        status: 200,
        headers: cors,
        jsonBody: {
          ...summary,
          lineItems: filteredItems,
          totals: {
            totalBudget,
            totalSpent,
            totalRemaining: totalBudget - totalSpent,
            percentUsed: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
          },
        },
      };
    } catch (err) {
      context.error('[Budget] Error fetching budget data:', err);
      return {
        status: 502,
        headers: cors,
        jsonBody: {
          error: `Failed to fetch budget data: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  },
});
