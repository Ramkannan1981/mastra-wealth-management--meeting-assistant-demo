import { MeetingOutputSchema, type MeetingOutput } from "../schemas/meetingOutput.js";

/**
 * Output guardrails.
 *
 * Two distinct checks, deliberately kept separate:
 *
 * 1. Structured-output validation -- does the model's output actually match
 *    the contract in schemas/meetingOutput.ts? A model can return
 *    plausible-looking JSON that doesn't conform (wrong types, missing
 *    fields); this is the check that catches that before it reaches a
 *    caller.
 *
 * 2. Hallucinated-identifier detection -- the specific, higher-stakes check:
 *    does the output contain something that LOOKS like a Medicare number,
 *    TFN, or similar identifier that was NOT present anywhere in the
 *    original transcript? If so, the model has almost certainly generated
 *    (hallucinated) a plausible-looking identifier rather than reporting
 *    one that was actually said in the meeting -- which in a wealth
 *    management context is exactly the failure mode that must never reach
 *    a client record silently.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data: MeetingOutput | null;
}

export function validateStructuredOutput(rawOutput: unknown): ValidationResult {
  const result = MeetingOutputSchema.safeParse(rawOutput);
  if (result.success) {
    return { valid: true, errors: [], data: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    data: null,
  };
}

// Same identifier-shaped patterns as the input guardrail, reused here for a
// different purpose: not redaction, but "does this appear in the output but
// NOT in the source transcript."
const IDENTIFIER_PATTERNS: RegExp[] = [
  /\b\d{4}\s?\d{5}\s?\d{1}\b/g, // Medicare-like
  /\b\d{3}\s?\d{3}\s?\d{2,3}\b/g, // TFN-like
];

export interface HallucinatedIdentifierResult {
  hasHallucinatedIdentifier: boolean;
  suspectValues: string[];
}

/**
 * Compares identifier-shaped strings found in the agent's output against
 * the original (unredacted) transcript. Anything present in the output but
 * absent from the source transcript is flagged as a likely hallucination,
 * not a real value the client or adviser actually stated.
 *
 * NOTE: this intentionally runs against the *original* transcript, not the
 * PII-redacted version -- redaction happens on the way into the model
 * (see inputGuardrails.ts); this check happens on the way out, comparing
 * against ground truth.
 */
export function detectHallucinatedIdentifiers(
  output: MeetingOutput,
  originalTranscript: string
): HallucinatedIdentifierResult {
  const outputText = JSON.stringify(output);
  const suspectValues: string[] = [];

  for (const pattern of IDENTIFIER_PATTERNS) {
    const matches = outputText.match(pattern) ?? [];
    for (const match of matches) {
      const normalizedMatch = match.replace(/\s/g, "");
      const foundInSource = originalTranscript
        .replace(/\s/g, "")
        .includes(normalizedMatch);
      if (!foundInSource) {
        suspectValues.push(match);
      }
    }
  }

  return {
    hasHallucinatedIdentifier: suspectValues.length > 0,
    suspectValues,
  };
}

/**
 * Runs the full output guardrail chain. Returns a final decision on whether
 * the output is safe to return to a caller as-is, needs to be flagged for
 * human review, or should be rejected outright.
 */
export type OutputDecision =
  | { action: "ACCEPT"; data: MeetingOutput }
  | { action: "FLAG_FOR_REVIEW"; data: MeetingOutput; reason: string }
  | { action: "REJECT"; reason: string };

export function runOutputGuardrails(
  rawOutput: unknown,
  originalTranscript: string
): OutputDecision {
  const validation = validateStructuredOutput(rawOutput);
  if (!validation.valid || !validation.data) {
    return {
      action: "REJECT",
      reason: `Structured output validation failed: ${validation.errors.join("; ")}`,
    };
  }

  const hallucinationCheck = detectHallucinatedIdentifiers(
    validation.data,
    originalTranscript
  );
  if (hallucinationCheck.hasHallucinatedIdentifier) {
    return {
      action: "FLAG_FOR_REVIEW",
      data: validation.data,
      reason: `Output contains identifier-shaped value(s) not present in the source transcript: ${hallucinationCheck.suspectValues.length} suspect value(s) found. This is treated as a likely hallucination, not a confirmed client detail.`,
    };
  }

  if (validation.data.flaggedForReview) {
    return {
      action: "FLAG_FOR_REVIEW",
      data: validation.data,
      reason: "Agent itself flagged this output for human review.",
    };
  }

  return { action: "ACCEPT", data: validation.data };
}
