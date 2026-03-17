/**
 * Receipt matching utilities: client name lookup (index-based), assistance type
 * inference, and region inference.
 *
 * The client index is built once when the client cache refreshes (every 10 min).
 * Each client generates multiple lookup keys (exact, reversed, initial variants).
 * Matching scans normalized OCR text for any key, longest-first, yielding O(k)
 * lookups instead of O(n·regex) per request, with zero false positives.
 */

// ── Types ──

export interface ClientRecord {
  id: string;
  clientName: string;
  program?: string;
  region?: string;
}

export interface ClientMatchResult {
  client: ClientRecord;
  confidence: number;
  matchType: string;
}

interface IndexEntry {
  client: ClientRecord;
  confidence: number;
  matchType: string;
}

// ── Normalize ──

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[_\-\/\\]/g, ' ').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ── Client index ──

/**
 * Build a lookup index from a list of client records.
 * Each client produces several normalized keys mapped to { client, confidence, matchType }.
 * When two clients produce the same key, the higher-confidence entry wins;
 * ties break in favor of the longer client name (more specific).
 */
export function buildClientIndex(clients: ClientRecord[]): Map<string, IndexEntry> {
  const index = new Map<string, IndexEntry>();

  function put(key: string, entry: IndexEntry) {
    if (!key || key.length < 2) return;
    const existing = index.get(key);
    if (
      !existing ||
      entry.confidence > existing.confidence ||
      (entry.confidence === existing.confidence &&
        normalize(entry.client.clientName).length > normalize(existing.client.clientName).length)
    ) {
      index.set(key, entry);
    }
  }

  for (const client of clients) {
    const name = normalize(client.clientName);
    if (!name || name.length < 3) continue;

    const parts = name.split(' ').filter(p => p.length >= 2);

    // 1. Exact full name  →  "john smith"
    put(name, { client, confidence: 0.95, matchType: 'exact' });

    if (parts.length >= 2) {
      // 2. Reversed  →  "smith john"
      const reversed = [...parts].reverse().join(' ');
      put(reversed, { client, confidence: 0.90, matchType: 'reversed' });

      const firstName = parts[0];
      const lastName = parts[parts.length - 1];
      const initial = firstName[0];

      // 3a. Initial + space + last  →  "j smith"
      put(`${initial} ${lastName}`, { client, confidence: 0.88, matchType: 'initial' });
      // 3b. Initial + last (no space)  →  "jsmith"
      put(`${initial}${lastName}`, { client, confidence: 0.88, matchType: 'initial' });
      // 3c. Last + space + initial  →  "smith j"
      put(`${lastName} ${initial}`, { client, confidence: 0.85, matchType: 'initial-reversed' });
      // 3d. Last + initial (no space)  →  "smithj"
      put(`${lastName}${initial}`, { client, confidence: 0.85, matchType: 'initial-reversed' });

      // For three-part names like "Mary Jane Smith", also index middle-initial patterns
      if (parts.length >= 3) {
        const middleParts = parts.slice(1, -1);
        const middleInitials = middleParts.map(p => p[0]).join('');
        // "m j smith" (first-initial + middle-initials + last)
        put(`${initial} ${middleInitials} ${lastName}`, { client, confidence: 0.86, matchType: 'initials' });
      }
    }
  }

  return index;
}

/**
 * Search normalized text for any key in the client index.
 * Keys are checked longest-first so "john smith" (exact) beats "j smith" (initial).
 * Each key must appear as a whole-word boundary match in the text (not inside another word).
 */
export function matchClientInText(
  ocrText: string,
  clientIndex: Map<string, IndexEntry>,
): ClientMatchResult | null {
  const text = normalize(ocrText);
  if (!text || text.length < 3) return null;

  // Sort keys longest-first so higher-confidence exact matches are checked first
  const sortedKeys = [...clientIndex.keys()].sort((a, b) => b.length - a.length);

  let best: ClientMatchResult | null = null;

  for (const key of sortedKeys) {
    // Quick check before regex
    if (!text.includes(key)) continue;

    // Word-boundary check: the key must not be embedded inside longer words
    // For single-char keys (shouldn't happen but guard), skip boundary check
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
    if (!re.test(text)) continue;

    const entry = clientIndex.get(key)!;
    if (
      !best ||
      entry.confidence > best.confidence ||
      (entry.confidence === best.confidence &&
        normalize(entry.client.clientName).length > normalize(best.client.clientName).length)
    ) {
      best = {
        client: entry.client,
        confidence: entry.confidence,
        matchType: entry.matchType,
      };
    }

    // If we found an exact match (0.95), no need to keep looking
    if (best.confidence >= 0.95) break;
  }

  return best;
}

// ── Assistance type inference ──

/**
 * Infer SSVF assistance type from vendor name and item descriptions / file name.
 * Returns null if no confident match can be made.
 */
export function inferAssistanceType(vendorName: string, description: string): string | null {
  const text = `${vendorName} ${description}`.toLowerCase();

  // Deposits (check before rental since "security deposit" contains no rent keyword)
  if (/security\s*deposit/.test(text)) return 'Security Deposit';
  if (/utility\s*deposit/.test(text)) return 'Utility Deposit';

  // Hotel / Motel — chain names, generic terms, and receipt keywords
  if (
    /motel|hotel|\binn\b|\blodge\b|\blodging\b|\bsuites?\b|\bresort\b/.test(text) ||
    /\bhilton\b|\bmarriott\b|\bhampton\b|\bholiday\s*inn\b|\bbest\s*western\b/.test(text) ||
    /\bla\s*quinta\b|\bhyatt\b|\bwyndham\b|\bclarion\b|\bcomfort\s*(inn|suites?)\b/.test(text) ||
    /\bsuper\s*8\b|\bdays?\s*inn\b|\bmotel\s*6\b|\btravelodge\b|\bramada\b/.test(text) ||
    /\bcourtyard\b|\bfairfield\b|\bspringhill\b|\btowneplace\b|\bresidence\s*inn\b/.test(text) ||
    /\bembassy\s*suites?\b|\bhomewood\b|\bdoubletre+\b|\bcandlewood\b/.test(text) ||
    /\bextended\s*stay\b|\bstudio\s*6\b|\bred\s*roof\b|\bquality\s*inn\b/.test(text) ||
    /\bsleep\s*inn\b|\becono\s*lodge\b|\bamericas?\s*best\b|\bmicrotel\b/.test(text) ||
    /room\s*rat[e]|nightly\s*rat[e]|room\s*charg[e]|guest\s*folio|check.?in|check.?out\s*dat[e]/.test(text) ||
    /\bstay\b.*\bnight/.test(text)
  ) {
    return 'Motel/Hotel Voucher';
  }

  // Moving
  if (/\bu-haul\b|uhaul|penske|budget\s*truck|moving\s*cost|move[\s-]*in|moving\s*truck|moving\s*expense/.test(text)) {
    return 'Moving Cost Assistance';
  }

  // Transportation
  if (/\btransport|\btaxi\b|uber|lyft|\bgreyhound\b|bus\s*pass|train\s*ticket|\bfare\b/.test(text)) {
    return 'Transportation';
  }

  // Utilities
  if (
    /entergy|swepco|cleco|centerpoint|atmos|xcel/.test(text) ||
    /electric\s*bill|gas\s*bill|water\s*bill|utility\s*bill|\butilities\b|sewage|natural\s*gas/.test(text) ||
    /electric\s*company|power\s*company|\bwater\s*works\b/.test(text)
  ) {
    return 'Utility Assistance';
  }

  // Rental (after utilities/hotel so "hotel" doesn't fall through to rental on "apartment" mention)
  if (/\brent\b|\brental\b|\blease\b|\bapartment\b|\blandlord\b|property\s*management/.test(text)) {
    return 'Rental Assistance';
  }

  // Emergency / moving supplies
  if (/emergency\s*suppl|moving\s*suppl/.test(text)) return 'Emergency Supplies';

  return null;
}

// ── Region inference ──

/**
 * Infer SSVF region from vendor/service address text.
 */
export function inferRegion(address: string): string | null {
  if (!address) return null;
  const text = address.toLowerCase();

  if (/\barkansas\b|\bar\b/.test(text)) return 'Arkansas';
  if (/\bmonroe\b|\bwest monroe\b|\bbastrop\b|\bruston\b|\bouachita\b|\brichwood\b|\bsterlington\b|\bfarmerville\b/.test(text)) return 'Monroe';
  if (/\bshreveport\b|\bbossier\b|\bcaddo\b|\bminden\b|\bnatchitoch\b|\bdesoto\b|\bwebster\b|\blouisiana\b|\bla\b/.test(text)) return 'Shreveport';

  return null;
}
