import {
  normalize,
  buildClientIndex,
  matchClientInText,
  inferAssistanceType,
  inferRegion,
  ClientRecord,
} from '../receiptMatching';

// ── Helpers ──

function makeClient(name: string, id?: string, program?: string, region?: string): ClientRecord {
  return { id: id || name.toLowerCase().replace(/\s+/g, '-'), clientName: name, program, region };
}

const CLIENTS: ClientRecord[] = [
  makeClient('John Smith', 'c1', 'SSVF', 'Shreveport'),
  makeClient('Mary Jane Wilson', 'c2', 'SSVF', 'Monroe'),
  makeClient('Robert Johnson', 'c3', 'SSVF', 'Arkansas'),
  makeClient('Ana Lee', 'c4', 'SSVF', 'Shreveport'),
  makeClient('James Brown', 'c5', 'SSVF', 'Monroe'),
  makeClient('De Andre Williams', 'c6', 'SSVF', 'Shreveport'),
  makeClient('Al Green', 'c7', 'SSVF', 'Monroe'),
];

let index: Map<string, any>;

beforeAll(() => {
  index = buildClientIndex(CLIENTS);
});

// ══════════════════════════════════════════════
// normalize()
// ══════════════════════════════════════════════

describe('normalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalize('J. Smith')).toBe('j smith');
  });
  it('collapses whitespace', () => {
    expect(normalize('  John   Smith  ')).toBe('john smith');
  });
  it('strips numbers and special chars', () => {
    expect(normalize('Room #302 — Guest: Smith')).toBe('room guest smith');
  });
  it('converts underscores and hyphens to spaces', () => {
    expect(normalize('JSmith_hotel_receipt')).toBe('jsmith hotel receipt');
    expect(normalize('J-Smith-rent')).toBe('j smith rent');
  });
  it('returns empty string for empty input', () => {
    expect(normalize('')).toBe('');
  });
});

// ══════════════════════════════════════════════
// buildClientIndex()
// ══════════════════════════════════════════════

describe('buildClientIndex', () => {
  it('creates keys for exact, reversed, and initial variants', () => {
    // "John Smith" should produce: john smith, smith john, j smith, jsmith, smith j, smithj
    expect(index.has('john smith')).toBe(true);
    expect(index.has('smith john')).toBe(true);
    expect(index.has('j smith')).toBe(true);
    expect(index.has('jsmith')).toBe(true);
    expect(index.has('smith j')).toBe(true);
    expect(index.has('smithj')).toBe(true);
  });

  it('creates multi-initial keys for three-part names', () => {
    // "Mary Jane Wilson" should produce: m j wilson
    expect(index.has('m j wilson')).toBe(true);
  });

  it('skips clients with very short names', () => {
    const idx = buildClientIndex([makeClient('AB')]);
    // "ab" is only 2 chars, should be skipped
    expect(idx.size).toBe(0);
  });

  it('higher confidence wins on collision', () => {
    // If two clients produce the same key, the one with higher confidence wins
    const entry = index.get('john smith');
    expect(entry.confidence).toBe(0.95);
    expect(entry.matchType).toBe('exact');
  });
});

// ══════════════════════════════════════════════
// matchClientInText() — exact matches
// ══════════════════════════════════════════════

describe('matchClientInText — exact', () => {
  it('matches full name in OCR text', () => {
    const result = matchClientInText('Receipt for John Smith dated 01/15/2026', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c1');
    expect(result!.confidence).toBe(0.95);
    expect(result!.matchType).toBe('exact');
  });

  it('matches case-insensitively', () => {
    const result = matchClientInText('JOHN SMITH rent receipt', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c1');
  });

  it('matches with punctuation around the name', () => {
    const result = matchClientInText('Guest: John Smith. Room 101', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c1');
  });
});

// ══════════════════════════════════════════════
// matchClientInText — reversed name
// ══════════════════════════════════════════════

describe('matchClientInText — reversed', () => {
  it('matches "Last First" order', () => {
    const result = matchClientInText('Smith John invoice', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c1');
    expect(result!.confidence).toBe(0.90);
    expect(result!.matchType).toBe('reversed');
  });
});

// ══════════════════════════════════════════════
// matchClientInText — initial patterns
// ══════════════════════════════════════════════

describe('matchClientInText — initial patterns', () => {
  it('matches "J Smith" (initial + space + last)', () => {
    const result = matchClientInText('file: J Smith rent receipt.pdf', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c1');
    expect(result!.confidence).toBe(0.88);
    expect(result!.matchType).toBe('initial');
  });

  it('matches "J. Smith" (period stripped by normalize)', () => {
    const result = matchClientInText('J. Smith utility bill', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c1');
    expect(result!.matchType).toBe('initial');
  });

  it('matches "JSmith" (no space)', () => {
    const result = matchClientInText('JSmith_hotel_receipt.jpg', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c1');
    expect(result!.matchType).toBe('initial');
  });

  it('matches "Smith J" (reversed initial)', () => {
    const result = matchClientInText('receipt smith j electric', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c1');
    expect(result!.confidence).toBe(0.85);
    expect(result!.matchType).toBe('initial-reversed');
  });
});

// ══════════════════════════════════════════════
// matchClientInText — no false positives
// ══════════════════════════════════════════════

describe('matchClientInText — no false positives', () => {
  it('returns null for text with no client mention', () => {
    const result = matchClientInText('Walmart receipt total $45.00 Shreveport LA', index);
    expect(result).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(matchClientInText('', index)).toBeNull();
  });

  it('returns null for very short text', () => {
    expect(matchClientInText('hi', index)).toBeNull();
  });

  it('does not match partial words (old token bug)', () => {
    // "ana" appears in "management" and "banana" — should NOT match Ana Lee
    const result = matchClientInText('property management banana republic', index);
    expect(result).toBeNull();
  });

  it('does not match "green" inside "greenhouse"', () => {
    const result = matchClientInText('greenhouse garden supply store', index);
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════
// matchClientInText — prefers higher confidence
// ══════════════════════════════════════════════

describe('matchClientInText — priority', () => {
  it('prefers exact over initial match when both present', () => {
    // Text contains both "john smith" (exact) and "j smith" (initial) — exact should win
    const result = matchClientInText('j smith john smith', index);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.95);
    expect(result!.matchType).toBe('exact');
  });
});

// ══════════════════════════════════════════════
// matchClientInText — multi-word names
// ══════════════════════════════════════════════

describe('matchClientInText — multi-word names', () => {
  it('matches three-part name exactly', () => {
    const result = matchClientInText('bill for mary jane wilson', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c2');
    expect(result!.confidence).toBe(0.95);
  });

  it('matches "De Andre Williams" (space in first name)', () => {
    const result = matchClientInText('guest folio de andre williams room 205', index);
    expect(result).not.toBeNull();
    expect(result!.client.id).toBe('c6');
  });
});

// ══════════════════════════════════════════════
// inferAssistanceType()
// ══════════════════════════════════════════════

describe('inferAssistanceType', () => {
  // Hotel / Motel — the main issue reported
  it.each([
    ['Holiday Inn', ''],
    ['Hampton Inn & Suites', ''],
    ['Best Western Plus', ''],
    ['La Quinta Inn', ''],
    ['Super 8', ''],
    ['Hilton Garden Inn', ''],
    ['Marriott Courtyard', ''],
    ['Hyatt Place', ''],
    ['Motel 6', ''],
    ['Days Inn', ''],
    ['Extended Stay America', ''],
    ['', 'Room Rate: $89.00 Nightly Rate'],
    ['', 'Guest Folio - Check-In 01/10 Check-Out 01/12'],
    ['Comfort Inn', 'lodging 2 nights'],
    ['Some Random Place', 'hotel room charge'],
  ])('detects hotel/motel: vendor="%s" desc="%s"', (vendor, desc) => {
    expect(inferAssistanceType(vendor, desc)).toBe('Motel/Hotel Voucher');
  });

  // Rental
  it.each([
    ['ABC Property Management', ''],
    ['', 'rent payment for apartment'],
    ['Landlord LLC', 'monthly lease payment'],
  ])('detects rental: vendor="%s" desc="%s"', (vendor, desc) => {
    expect(inferAssistanceType(vendor, desc)).toBe('Rental Assistance');
  });

  // Utilities
  it.each([
    ['Entergy', 'electric bill'],
    ['SWEPCO', ''],
    ['Centerpoint Energy', ''],
    ['', 'water bill payment'],
    ['City of Monroe', 'utility bill'],
  ])('detects utility: vendor="%s" desc="%s"', (vendor, desc) => {
    expect(inferAssistanceType(vendor, desc)).toBe('Utility Assistance');
  });

  // Deposits
  it('detects security deposit', () => {
    expect(inferAssistanceType('ABC Apartments', 'security deposit')).toBe('Security Deposit');
  });
  it('detects utility deposit', () => {
    expect(inferAssistanceType('Entergy', 'utility deposit required')).toBe('Utility Deposit');
  });

  // Moving
  it.each([
    ['U-Haul', ''],
    ['Penske', 'moving truck rental'],
    ['', 'move-in cost'],
  ])('detects moving: vendor="%s" desc="%s"', (vendor, desc) => {
    expect(inferAssistanceType(vendor, desc)).toBe('Moving Cost Assistance');
  });

  // Transportation
  it.each([
    ['', 'Uber ride'],
    ['Greyhound', ''],
    ['', 'bus pass purchase'],
  ])('detects transportation: vendor="%s" desc="%s"', (vendor, desc) => {
    expect(inferAssistanceType(vendor, desc)).toBe('Transportation');
  });

  // No match
  it('returns null for unrecognizable text', () => {
    expect(inferAssistanceType('Walmart', 'groceries and household')).toBeNull();
  });

  // Security deposit should not be "Rental" even though "apartment" might appear
  it('prefers security deposit over rental', () => {
    expect(inferAssistanceType('Sunshine Apartments', 'security deposit for apartment')).toBe('Security Deposit');
  });
});

// ══════════════════════════════════════════════
// inferRegion()
// ══════════════════════════════════════════════

describe('inferRegion', () => {
  it('infers Arkansas', () => {
    expect(inferRegion('123 Main St, Little Rock, AR 72201')).toBe('Arkansas');
  });
  it('infers Monroe', () => {
    expect(inferRegion('500 Elm St, Monroe, LA 71201')).toBe('Monroe');
  });
  it('infers Shreveport', () => {
    expect(inferRegion('700 Texas St, Shreveport, LA 71101')).toBe('Shreveport');
  });
  it('infers Shreveport for generic Louisiana', () => {
    expect(inferRegion('some place, Louisiana')).toBe('Shreveport');
  });
  it('returns null for empty', () => {
    expect(inferRegion('')).toBeNull();
  });
  it('returns null for unknown location', () => {
    expect(inferRegion('456 Oak Rd, Houston, TX 77001')).toBeNull();
  });
});
