import { z } from "zod";
import { buildGrounding, validateExplanation } from "../explanations/grounding";
export const TRANSCRIPT_VERSION = "1.0.0";
export const MAX_TEXT_LENGTH = 16000;
const savedContent = z.object({ insights: z.array(z.object({ reference: z.string(), explanation: z.string(), suggestedCheck: z.string() })).min(1).max(8) });
export function narrationText(explanation: { organizationId: string; status: string; content: unknown }, investigation: Parameters<typeof buildGrounding>[0]) {
  if (explanation.organizationId !== investigation.organizationId || explanation.status !== "COMPLETED") throw new Error("Completed same-tenant explanation required");
  // Rebuild evidence statements from immutable source snapshots. Never trust
  // saved verifiedStatement fields or accept client-supplied speech text.
  const parsed = savedContent.parse(explanation.content);
  const grounded = validateExplanation(parsed, buildGrounding(investigation));
  const text = ["This is an AI-generated voice reading a saved AI interpretation and verified metric statements. Interpretations may contain errors. Observed changes do not establish causes.", ...grounded.insights.map((item) => `${item.key.replaceAll("_", " ")}. ${item.explanation} Verified metric statement: ${item.verifiedStatement} Suggested check: ${item.suggestedCheck}`)].join("\n\n");
  if (text.length > MAX_TEXT_LENGTH) throw new Error("Narration exceeds the text limit");
  return text;
}
