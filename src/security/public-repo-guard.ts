/**
 * APEX GENESIS V9.1 — PUBLIC REPOSITORY SECRET, CREDENTIAL & CANDIDATE PII GUARD
 * Enforces zero exposure of credentials, session tokens, candidate PII, or personal documents
 * in public repository exports, diagnostics, and API audit responses.
 */

export interface PublicSafetyScanFinding {
  ruleId: string;
  severity: 'CRITICAL' | 'HIGH';
  location: string;
  description: string;
}

export interface PublicSafetyAuditResult {
  safeForPublicRepository: boolean;
  canonicalRepositoryUrl: string;
  canonicalOwner: string;
  scannedItemsCount: number;
  findings: PublicSafetyScanFinding[];
  verifiedAt: string;
}

export const CANONICAL_PUBLIC_REPO_URL = 'https://github.com/akshatgogri458-blip/apex-genesis-os';
export const CANONICAL_PUBLIC_REPO_OWNER = 'akshatgogri458-blip';

const SECRET_PATTERNS: Array<{ id: string; regex: RegExp; description: string }> = [
  {
    id: 'SECRET_PRIVATE_KEY',
    regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|DSA\s+)?PRIVATE\s+KEY-----/,
    description: 'PEM/OpenSSH private cryptographic key detected.',
  },
  {
    id: 'SECRET_GITHUB_PAT',
    regex: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
    description: 'GitHub Personal Access Token detected.',
  },
  {
    id: 'SECRET_GOOGLE_API_KEY',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/,
    description: 'Google Cloud / Gemini API key detected.',
  },
  {
    id: 'SECRET_OPENAI_OR_ANTHROPIC_KEY',
    regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9\-_]{32,}\b/,
    description: 'LLM provider secret key detected.',
  },
  {
    id: 'SECRET_SLACK_TOKEN',
    regex: /\bxox[baprs]-[0-9A-Za-z\-]{20,}\b/,
    description: 'Slack API token detected.',
  },
];

/**
 * Scans a text buffer or serialized payload for accidental credential or secret exposure.
 */
export function scanTextForPublicRepoLeaks(
  content: string,
  locationLabel: string = 'payload'
): PublicSafetyScanFinding[] {
  const findings: PublicSafetyScanFinding[] = [];
  if (!content) return findings;

  for (const pat of SECRET_PATTERNS) {
    if (pat.regex.test(content)) {
      findings.push({
        ruleId: pat.id,
        severity: 'CRITICAL',
        location: locationLabel,
        description: pat.description,
      });
    }
  }
  return findings;
}

/**
 * Redacts sensitive candidate PII, session tokens, CSRF secrets, and OAuth subjects
 * from any diagnostic or public-facing state snapshot.
 */
export function redactCandidatePiiForPublicExport(input: any): any {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    // Redact email addresses while preserving domain for debugging
    return input
      .replace(/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1***@$2')
      .replace(/\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[REDACTED_PHONE]');
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactCandidatePiiForPublicExport(item));
  }
  if (typeof input === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      const lowerKey = k.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('sessiontoken') ||
        lowerKey.includes('session_token') ||
        lowerKey.includes('csrftoken') ||
        lowerKey.includes('csrf_token') ||
        lowerKey.includes('verificationtoken') ||
        lowerKey.includes('oauth_subject') ||
        lowerKey.includes('oauthsubject') ||
        lowerKey === 'rawtext' ||
        lowerKey === 'raw_text' ||
        lowerKey === 'content'
      ) {
        out[k] = '[REDACTED_FOR_PUBLIC_SAFETY]';
      } else {
        out[k] = redactCandidatePiiForPublicExport(v);
      }
    }
    return out;
  }
  return input;
}
