const { suiteQL } = require('./dist/shared/netsuiteClient');

(async () => {
  try {
    console.log('Page 1 (offset=0)...');
    const r1 = await suiteQL("SELECT id, entityId, companyName FROM vendor WHERE isInactive = 'F' ORDER BY companyName", 1000, 0);
    console.log('Page 1:', r1.items.length, 'items, hasMore:', r1.hasMore, 'totalResults:', r1.totalResults);

    if (r1.hasMore) {
      console.log('Page 2 (offset=1000)...');
      const r2 = await suiteQL("SELECT id, entityId, companyName FROM vendor WHERE isInactive = 'F' ORDER BY companyName", 1000, 1000);
      console.log('Page 2:', r2.items.length, 'items, hasMore:', r2.hasMore);
    }
    console.log('DONE - Total vendors fetched successfully');
  } catch (err) {
    console.error('ERROR:', err.message);
  }
})();
