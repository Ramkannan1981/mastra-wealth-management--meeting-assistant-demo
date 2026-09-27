import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { meetingAssistantAgent } from "./mastra/agents/meeting-assistant-agent.js";
import { MeetingOutputSchema } from "./schemas/meetingOutput.js";
import { redactPii, detectPromptInjection } from "./guardrails/inputGuardrails.js";
import { runOutputGuardrails } from "./guardrails/outputGuardrails.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * End-to-end pipeline:
 *
 *   raw transcript
 *     -> [INPUT GUARDRAILS]  PII redaction, prompt-injection scan
 *     -> [AGENT]             Mastra agent, structured output
 *     -> [OUTPUT GUARDRAILS] schema validation, hallucinated-identifier check
 *     -> final decision (ACCEPT / FLAG_FOR_REVIEW / REJECT)
 *
 * This mirrors the real production pipeline described in the README --
 * see "What this mirrors" for the mapping back to the actual system this
 * is modelled on.
 */
async function main() {
  const transcriptPath = join(__dirname, "..", "sample-data", "sample-transcript.txt");
  const rawTranscript = readFileSync(transcriptPath, "utf-8");

  console.log("=== STAGE 1: Input Guardrails ===\n");

  const injectionCheck = detectPromptInjection(rawTranscript);
  if (injectionCheck.isSuspicious) {
    console.log(
      `⚠ Prompt-injection patterns detected: ${injectionCheck.matchedPatterns.join(", ")}`
    );
    console.log("  (Demo continues, but a production system would flag this transcript for review.)\n");
  } else {
    console.log("✓ No prompt-injection patterns detected.\n");
  }

  const { redactedText, findings } = redactPii(rawTranscript);
  console.log("PII findings (counts only, no raw values logged):");
  if (findings.length === 0) {
    console.log("  none");
  } else {
    for (const f of findings) console.log(`  ${f.type}: ${f.count}`);
  }
  console.log();

  console.log("=== STAGE 2: Agent (Mastra) ===\n");

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log(
      "No model API key found in the environment (ANTHROPIC_API_KEY / OPENAI_API_KEY).\n" +
        "Skipping the live agent call -- see README for setup.\n" +
        "The guardrail logic above and below runs fully without a live model call;\n" +
        "see eval/evalGuardrails.ts for a version that exercises it without needing a key.\n"
    );
    return;
  }

  const response = await meetingAssistantAgent.generate(
    `Here is the meeting transcript (PII already redacted):\n\n${redactedText}`,
    { structuredOutput: { schema: MeetingOutputSchema } }
  );

  console.log("Raw agent output:");
  console.log(JSON.stringify(response.object, null, 2));
  console.log();

  console.log("=== STAGE 3: Output Guardrails ===\n");

  // Note: hallucination check runs against the ORIGINAL transcript (not the
  // redacted one) -- see outputGuardrails.ts for why.
  const decision = runOutputGuardrails(response.object, rawTranscript);

  console.log(`Decision: ${decision.action}`);
  if (decision.action === "REJECT") {
    console.log(`Reason: ${decision.reason}`);
  } else if (decision.action === "FLAG_FOR_REVIEW") {
    console.log(`Reason: ${decision.reason}`);
    console.log("Output (requires human review before use):");
    console.log(JSON.stringify(decision.data, null, 2));
  } else {
    console.log("Output (safe to return to caller):");
    console.log(JSON.stringify(decision.data, null, 2));
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
