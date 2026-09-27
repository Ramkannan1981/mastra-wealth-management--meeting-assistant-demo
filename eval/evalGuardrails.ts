import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { redactPii, detectPromptInjection } from "../src/guardrails/inputGuardrails.js";
import {
  validateStructuredOutput,
  detectHallucinatedIdentifiers,
  runOutputGuardrails,
} from "../src/guardrails/outputGuardrails.js";
import type { MeetingOutput } from "../src/schemas/meetingOutput.js";

/**
 * Deterministic assertions against the guardrail layer -- no model call
 * required. This is the bottom tier of the "evaluation pyramid" referenced
 * in the README: deterministic assertions -> LLM-as-Judge -> meta-evaluation.
 * Only the first tier is implemented here; it is the tier that should run
 * on every commit in CI, since it's fast and free.
 *
 * Run with: npm run eval
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

console.log("=== Input Guardrail Tests ===\n");

{
  const transcriptPath = join(__dirname, "..", "sample-data", "sample-transcript.txt");
  const transcript = readFileSync(transcriptPath, "utf-8");

  const { redactedText, findings } = redactPii(transcript);
  assert(
    findings.some((f) => f.type === "EMAIL"),
    "detects the email address in the sample transcript"
  );
  assert(
    findings.some((f) => f.type === "MEDICARE_LIKE"),
    "detects the Medicare-like number in the sample transcript"
  );
  assert(
    !redactedText.includes("j.harper@example.com"),
    "redacted text no longer contains the raw email"
  );
  assert(
    !redactedText.includes("2950 84715 1"),
    "redacted text no longer contains the raw Medicare-like number"
  );

  const injection = detectPromptInjection(transcript);
  assert(
    injection.isSuspicious,
    "detects the embedded prompt-injection attempt in the sample transcript"
  );
  assert(
    injection.matchedPatterns.includes("instruction_override"),
    "specifically flags the 'ignore all previous instructions' pattern"
  );
}

{
  const cleanText = "We discussed the client's super contributions and agreed to follow up next week.";
  const injection = detectPromptInjection(cleanText);
  assert(!injection.isSuspicious, "does NOT flag ordinary transcript content as suspicious");
}

console.log("\n=== Output Guardrail Tests ===\n");

{
  const validOutput: MeetingOutput = {
    summary: "Client discussed increasing super contributions following a pay rise.",
    actionItems: [
      { owner: "adviser", description: "Send investment property loan information", dueDate: "next Friday" },
    ],
    clientRecordUpdates: ["Updated income following new role", "Added property purchase as near-term goal"],
    flaggedForReview: false,
  };

  const validation = validateStructuredOutput(validOutput);
  assert(validation.valid, "accepts a well-formed structured output");

  const invalidOutput = { summary: "Missing required fields" };
  const invalidValidation = validateStructuredOutput(invalidOutput);
  assert(!invalidValidation.valid, "rejects output missing required fields");
}

{
  // The real Medicare-like number that WAS in the transcript -- should NOT
  // be flagged, since it's a genuine value, not a hallucination.
  const transcriptPath = join(__dirname, "..", "sample-data", "sample-transcript.txt");
  const transcript = readFileSync(transcriptPath, "utf-8");

  const outputWithRealNumber: MeetingOutput = {
    summary: "Confirmed the client's Medicare number 2950 84715 1 is current.",
    actionItems: [],
    clientRecordUpdates: [],
    flaggedForReview: false,
  };
  const realNumberCheck = detectHallucinatedIdentifiers(outputWithRealNumber, transcript);
  assert(
    !realNumberCheck.hasHallucinatedIdentifier,
    "does NOT flag an identifier that genuinely appeared in the source transcript"
  );

  // A DIFFERENT identifier-shaped number that was never in the transcript --
  // this is the actual hallucination case the guardrail exists to catch.
  const outputWithFabricatedNumber: MeetingOutput = {
    summary: "Confirmed the client's Medicare number 1234 56789 0 is current.",
    actionItems: [],
    clientRecordUpdates: [],
    flaggedForReview: false,
  };
  const fabricatedCheck = detectHallucinatedIdentifiers(outputWithFabricatedNumber, transcript);
  assert(
    fabricatedCheck.hasHallucinatedIdentifier,
    "flags an identifier-shaped value that does NOT appear anywhere in the source transcript"
  );

  const decision = runOutputGuardrails(outputWithFabricatedNumber, transcript);
  assert(
    decision.action === "FLAG_FOR_REVIEW",
    "full guardrail chain routes a fabricated identifier to FLAG_FOR_REVIEW, not silent ACCEPT"
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
