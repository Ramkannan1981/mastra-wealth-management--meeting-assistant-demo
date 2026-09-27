import { z } from "zod";

/**
 * Structured output contract for the meeting assistant agent.
 *
 * This mirrors a real production pattern: the agent is not free-texting a
 * summary, it is required to return data matching this shape. That is what
 * makes the output-side guardrails in `guardrails/outputGuardrails.ts`
 * possible -- you can only validate and redact fields you know exist.
 */
export const ActionItemSchema = z.object({
  owner: z.string().describe("Who is responsible for this action item"),
  description: z.string().describe("What needs to be done"),
  dueDate: z.string().nullable().describe("Due date if mentioned, otherwise null"),
});

export const MeetingOutputSchema = z.object({
  summary: z
    .string()
    .describe("A concise summary of the meeting, 3-5 sentences"),
  actionItems: z
    .array(ActionItemSchema)
    .describe("Extracted action items from the meeting"),
  clientRecordUpdates: z
    .array(z.string())
    .describe(
      "Suggested updates to the client's record based on the meeting (e.g. changed circumstances, new goals). Empty array if none."
    ),
  flaggedForReview: z
    .boolean()
    .describe(
      "True if anything in the transcript needs human review before this output is used (e.g. ambiguous instruction, sensitive topic, low confidence)"
    ),
});

export type MeetingOutput = z.infer<typeof MeetingOutputSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
