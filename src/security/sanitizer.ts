/**
 * APEX GENESIS V9 — XSS SANITIZER, URL VALIDATOR & SEMANTIC CLAIM ENTAILMENT VERIFIER
 * Prevents stored/reflected XSS, blocks dangerous URL schemes, and verifies
 * that candidate claims are genuinely entailed by their cited document excerpt
 * (including adversarial checks for negation, numeric/year contradictions, and role inflation).
 */

export function stripExecutableMarkup(input: string): string {
  if (!input) return '';
  return String(input)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/data:text\/html/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

export function escapeHtml(input: string): string {
  return String(input ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

export function sanitizeUrl(rawUrl: string): string {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) return 'https://invalid.apex-genesis.local/empty-url';
  if (/^(javascript|vbscript|data|file):/i.test(trimmed)) {
    throw new Error(`UNSAFE_URL_SCHEME: URL scheme in '${trimmed.slice(0, 32)}' is forbidden.`);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`UNSAFE_URL_PROTOCOL: Protocol '${parsed.protocol}' is forbidden.`);
    }
    return parsed.toString();
  } catch (err: any) {
    if (String(err.message).startsWith('UNSAFE_URL')) throw err;
    throw new Error(`INVALID_URL: '${trimmed.slice(0, 64)}' is not a valid HTTP/HTTPS URL.`);
  }
}

/**
 * V9 Semantic Entailment Guard:
 * 1. Verifies verbatim presence of `evidenceExcerpt` inside `rawDocumentText`.
 * 2. Rejects negated claims (`no`, `not`, `never`, `without`, `lacks`, `zero`) when the claim is affirmative.
 * 3. Rejects contradictory numbers, years, or metrics (e.g. claiming 10 years when excerpt says 2 years).
 * 4. Rejects seniority/role inflation (e.g. claiming Principal/VP/Director when excerpt says Intern/Junior).
 * 5. Requires meaningful token support from `attributeValue` and `attributeKey`.
 */
export function verifyExcerptEntailment(params: {
  attributeKey: string;
  attributeValue: string;
  evidenceExcerpt: string;
  rawDocumentText: string;
}): {
  excerptExistsInDocument: boolean;
  claimEntailedByExcerpt: boolean;
  matchedTokens: string[];
  reason: string;
} {
  const docNorm = String(params.rawDocumentText ?? '').replace(/\s+/g, ' ').trim();
  const excerptNorm = String(params.evidenceExcerpt ?? '').replace(/\s+/g, ' ').trim();

  if (!excerptNorm || excerptNorm.length < 4) {
    return {
      excerptExistsInDocument: false,
      claimEntailedByExcerpt: false,
      matchedTokens: [],
      reason: 'EXCERPT_TOO_SHORT: Evidence excerpt must contain at least 4 characters.',
    };
  }

  const excerptExists = docNorm.toLowerCase().includes(excerptNorm.toLowerCase());
  if (!excerptExists) {
    return {
      excerptExistsInDocument: false,
      claimEntailedByExcerpt: false,
      matchedTokens: [],
      reason: 'EXCERPT_NOT_IN_DOCUMENT: Supplied evidence excerpt does not appear verbatim in the source document.',
    };
  }

  const combinedClaim = `${params.attributeKey || ''} ${params.attributeValue || ''}`.toLowerCase();
  const excerptLower = excerptNorm.toLowerCase();

  // 1. Adversarial Negation Check:
  // If the excerpt contains negation markers ("no experience", "never used", "not proficient", "without", "lacks")
  // while the claim itself does not state a negation, reject immediately.
  const negationRegex = /\b(no|not|never|without|lack|lacks|lacking|neither|none|zero\s+experience)\b/i;
  if (negationRegex.test(excerptLower) && !negationRegex.test(combinedClaim)) {
    return {
      excerptExistsInDocument: true,
      claimEntailedByExcerpt: false,
      matchedTokens: [],
      reason: `ENTAILMENT_NEGATED: Excerpt '${excerptNorm.slice(0, 80)}' contains negation contradicting affirmative claim '${params.attributeKey}: ${params.attributeValue}'.`,
    };
  }

  // 2. Adversarial Numeric / Duration / Year Contradiction Check:
  // Extract numbers (ignoring formatting commas like 45,000 -> 45000) from claim and excerpt.
  const normalizeNumbers = (str: string): number[] => {
    const cleaned = str.replace(/(\d),(\d)/g, '$1$2');
    const matches = cleaned.match(/\b\d+(?:\.\d+)?\b/g);
    return matches ? matches.map((n) => Number(n)) : [];
  };
  const claimNumbers = normalizeNumbers(combinedClaim);
  const excerptNumbers = normalizeNumbers(excerptLower);

  if (claimNumbers.length > 0) {
    for (const cNum of claimNumbers) {
      if (!excerptNumbers.includes(cNum)) {
        return {
          excerptExistsInDocument: true,
          claimEntailedByExcerpt: false,
          matchedTokens: [],
          reason: `ENTAILMENT_NUMERIC_CONTRADICTION: Claimed number '${cNum}' in '${params.attributeKey}: ${params.attributeValue}' is not supported by excerpt numbers [${excerptNumbers.join(', ')}].`,
        };
      }
    }
  }

  // 3. Adversarial Role / Seniority Inflation Check:
  const highSeniorityTokens = ['principal', 'staff', 'director', 'vp', 'chief', 'cto', 'ceo', 'head', 'fellow'];
  const claimedSeniority = highSeniorityTokens.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(combinedClaim));
  for (const sen of claimedSeniority) {
    if (!new RegExp(`\\b${sen}\\b`, 'i').test(excerptLower)) {
      return {
        excerptExistsInDocument: true,
        claimEntailedByExcerpt: false,
        matchedTokens: [],
        reason: `ENTAILMENT_ROLE_INFLATION: Claimed seniority '${sen}' does not appear in evidence excerpt '${excerptNorm.slice(0, 80)}'.`,
      };
    }
  }

  // 4. Token Coverage Check:
  const stopWords = new Set(['and', 'the', 'for', 'with', 'from', 'that', 'this', 'years', 'experience', 'skill', 'role', 'work']);
  const claimTokens = Array.from(
    new Set(
      combinedClaim
        .replace(/(\d),(\d)/g, '$1$2')
        .split(/[^a-z0-9+#.]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !stopWords.has(t))
    )
  );

  const valueTokens = Array.from(
    new Set(
      String(params.attributeValue || '')
        .toLowerCase()
        .replace(/(\d),(\d)/g, '$1$2')
        .split(/[^a-z0-9+#.]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !stopWords.has(t))
    )
  );

  const excerptCleanedForTokens = excerptLower.replace(/(\d),(\d)/g, '$1$2');
  const matchedTokens = claimTokens.filter((tok) => excerptCleanedForTokens.includes(tok));
  const matchedValueTokens = valueTokens.filter((tok) => excerptCleanedForTokens.includes(tok));

  const hasValueSupport = valueTokens.length === 0 || matchedValueTokens.length >= 1;
  const coverageRatio = claimTokens.length > 0 ? matchedTokens.length / claimTokens.length : 0;
  const entailed = hasValueSupport && matchedTokens.length >= 1 && (matchedValueTokens.length >= 1 || coverageRatio >= 0.33);

  return {
    excerptExistsInDocument: true,
    claimEntailedByExcerpt: entailed,
    matchedTokens,
    reason: entailed
      ? `ENTAILED: Matched [${matchedTokens.join(', ')}] in verbatim excerpt.`
      : `ENTAILMENT_MISMATCH: Asserted fact ('${params.attributeKey}: ${params.attributeValue}') is not supported by excerpt '${excerptNorm.slice(0, 80)}'.`,
  };
}
