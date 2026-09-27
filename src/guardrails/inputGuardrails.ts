/**
 * Input guardrails.
 *
 * These run BEFORE the transcript is ever sent to the model. This mirrors
 * the real production split: what you protect against on the way IN
 * (sensitive data reaching the model, or the model being manipulated by
 * content embedded in the transcript) is a different problem from what you
 * protect against on the way OUT (see outputGuardrails.ts).
 *
 * Deliberately implemented as pure, synchronous functions with no model
 * calls -- these are cheap, deterministic, and fully unit-testable without
 * an API key. See eval/evalGuardrails.ts.
 */

export interface PiiRedactionResult {
  redactedText: string;
  findings: PiiFinding[];
}

export interface PiiFinding {
  type: "EMAIL" | "PHONE" | "MEDICARE_LIKE" | "TFN_LIKE" | "CREDIT_CARD_LIKE";
  /** The matched text is intentionally NOT included here -- findings should
   * be safe to log without re-exposing the PII they describe. */
  count: number;
}

// Patterns are deliberately conservative (prefer false positives over false
// negatives for a guardrail) and are illustrative, not exhaustive. A
// production system would layer a proper PII-detection model or service
// (e.g. AWS Comprehend, Presidio) on top of pattern matching like this.
const PATTERNS: { type: PiiFinding["type"]; regex: RegExp }[] = [
  { type: "EMAIL", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: "PHONE", regex: /\b(?:\+?61|0)[2-478](?:[ -]?\d){8}\b/g },
  // Australian Medicare card numbers: 10 digits, sometimes formatted with spaces
  { type: "MEDICARE_LIKE", regex: /\b\d{4}\s?\d{5}\s?\d{1}\b/g },
  // Australian Tax File Numbers: 8-9 digits
  { type: "TFN_LIKE", regex: /\b\d{3}\s?\d{3}\s?\d{2,3}\b/g },
  { type: "CREDIT_CARD_LIKE", regex: /\b(?:\d[ -]?){13,16}\b/g },
];

/**
 * Redacts likely-PII from transcript text before it reaches the model or
 * any log line. Returns both the redacted text and a count-only summary of
 * what was found, so callers can decide whether to flag the document for
 * review without ever having the raw PII pass back through application code.
 */
export function redactPii(rawText: string): PiiRedactionResult {
  let redactedText = rawText;
  const findings: PiiFinding[] = [];

  for (const { type, regex } of PATTERNS) {
    const matches = redactedText.match(regex);
    if (matches && matches.length > 0) {
      findings.push({ type, count: matches.length });
      redactedText = redactedText.replace(regex, `[REDACTED_${type}]`);
    }
  }

  return { redactedText, findings };
}

export interface PromptInjectionResult {
  isSuspicious: boolean;
  matchedPatterns: string[];
}

// Heuristic patterns for content embedded in a transcript that is attempting
// to manipulate the agent's instructions, rather than being genuine meeting
// content. Real systems typically combine this kind of heuristic layer with
// a model-based classifier; this demo shows the deterministic layer only.
const INJECTION_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: "instruction_override", regex: /ignore (all|any|the) (previous|prior|above) instructions?/i },
  { label: "role_override", regex: /you are now/i },
  { label: "system_prompt_probe", regex: /(reveal|show|print) (your|the) (system prompt|instructions)/i },
  { label: "exfiltration_attempt", regex: /forward (this|all) (data|information|transcript) to/i },
];

/**
 * Scans transcript content for patterns suggesting the text is attempting
 * to inject instructions to the agent, rather than being genuine transcript
 * content. This does not block the transcript -- it flags it for the
 * `flaggedForReview` output field, consistent with a "visible failure, not
 * silent" design (see README's Design Notes section).
 */
export function detectPromptInjection(text: string): PromptInjectionResult {
  const matchedPatterns: string[] = [];
  for (const { label, regex } of INJECTION_PATTERNS) {
    if (regex.test(text)) {
      matchedPatterns.push(label);
    }
  }
  return { isSuspicious: matchedPatterns.length > 0, matchedPatterns };
}
