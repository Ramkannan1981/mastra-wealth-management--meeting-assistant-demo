import { Agent } from "@mastra/core/agent";
import { MeetingOutputSchema } from "../../schemas/meetingOutput.js";

/**
 * The meeting assistant agent.
 *
 * Mirrors the real production pattern (see README "What this mirrors"):
 * transcript in, structured summary + action items out, via a single
 * Mastra Agent with a typed output schema rather than free-text parsing.
 *
 * Model is read from MASTRA_MODEL so this repo isn't pinned to one
 * provider -- swap in any "provider/model-name" string Mastra's model
 * router supports (Anthropic, OpenAI, etc). Model identifiers change
 * frequently; check your provider's current docs rather than trusting a
 * hardcoded default to still be current.
 */
export const meetingAssistantAgent = new Agent({
  id: "meeting-assistant",
  name: "Wealth Management Meeting Assistant",
  instructions: `You are an assistant for financial advisers at a wealth management firm.
You will be given a meeting transcript between an adviser and their client, with
personally identifiable information already redacted (redacted spans look like
[REDACTED_TYPE]).

Your job:
1. Produce a concise 3-5 sentence summary of the meeting.
2. Extract clear action items with an owner (adviser or client) and description.
   Only include a due date if one was explicitly mentioned -- never invent one.
3. Suggest any client record updates implied by the meeting (e.g. changed
   circumstances, new stated goals). If none, return an empty array.
4. Set flaggedForReview to true if anything in the transcript is ambiguous,
   sensitive, or something you are not confident about -- it is always better
   to flag for a human than to guess.

Never invent specific identifiers, account numbers, or figures that were not
stated in the transcript. If a number was redacted, refer to it generically
(e.g. "the client's Medicare number was referenced") rather than fabricating
a replacement value.`,
  model: process.env.MASTRA_MODEL ?? "anthropic/claude-sonnet-4-5",
});

export { MeetingOutputSchema };
