import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
const GATEWAY_MODEL = "anthropic/claude-opus-5.5";

/** Vercel AI Gateway (spec 13.2): on when OPENSTUDY_AI_GATEWAY=1 and the deployment has a gateway credential. */
function gatewayToken(): string | undefined {
  if (process.env.OPENSTUDY_AI_GATEWAY !== "1") return undefined;
  return process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
}

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY || !!gatewayToken();
}

export function noAi(): Response {
  return Response.json({ error: "no_ai" }, { status: 503 });
}

/** Model id plus server-side fallbacks, which only the direct API takes. */
export function modelParams() {
  return process.env.ANTHROPIC_API_KEY
    ? { model: MODEL, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : { model: GATEWAY_MODEL };
}

let client: Anthropic | null = null;
export function aiClient(): Anthropic {
  // The OIDC token rotates, so a gateway client is made per call; a direct key client is reused.
  if (!process.env.ANTHROPIC_API_KEY) return new Anthropic({ apiKey: null, authToken: gatewayToken(), baseURL: "https://ai-gateway.vercel.sh" });
  if (!client) client = new Anthropic();
  return client;
}

export class RefusalError extends Error {}

/**
 * One structured-output call. Effort low, server-side fallbacks on refusal.
 * Returns the parsed JSON object matching `schema`.
 */
export async function structuredCall<T>(opts: { system: string; user: string; schema: Record<string, unknown>; maxTokens?: number }): Promise<T> {
  const stream = aiClient().beta.messages.stream({
    ...modelParams(),
    max_tokens: opts.maxTokens ?? 32000,
    output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new RefusalError("refused");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return JSON.parse(text) as T;
}

/** Error response that tells the client to fall back to the offline engine. */
export function aiFailed(e: unknown): Response {
  if (e instanceof RefusalError) return Response.json({ error: "refusal" }, { status: 422 });
  if (e instanceof Anthropic.RateLimitError) return Response.json({ error: "rate_limited" }, { status: 429 });
  if (e instanceof Anthropic.AuthenticationError) return Response.json({ error: "no_ai" }, { status: 503 });
  if (e instanceof Anthropic.APIError) return Response.json({ error: "ai_error" }, { status: 502 });
  return Response.json({ error: "ai_error" }, { status: 500 });
}
