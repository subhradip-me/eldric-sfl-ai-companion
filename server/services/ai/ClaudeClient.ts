/**
 * ClaudeClient — Claude Opus 4.8 via the provider's Anthropic-native Messages API.
 * LLM explains; never calculates (design §20).
 *
 * Provider: https://api.justwoker.icu — its OpenAI-compatible /v1/chat/completions
 * path is Cloudflare-blocked (403), so we use the working Anthropic surface:
 *   POST /v1/messages  with  x-api-key + anthropic-version  headers.
 *
 * For drop-in compatibility with the rest of the codebase, `complete()` accepts
 * OpenAI-style messages (a `system` role is allowed) and converts them to the
 * Anthropic request shape internally.
 *
 * Configure via env: CLAUDE_API_KEY, CLAUDE_MODEL, CLAUDE_BASE_URL, CLAUDE_ANTHROPIC_VERSION.
 */

const DEFAULT_BASE_URL = 'https://api.justwoker.icu';
const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM = `You are a Sunflower Land farming strategy assistant.
Use supplied structured farm and market data as the source of truth.
Do not invent prices, recipes, XP values, inventory, or game mechanics.
Application-provided calculations are authoritative.
Distinguish observed facts, inferred events, and estimates.
If the plan is unaffordable, prioritize FLOWER income advice.
Prefer practical actions over generic advice.

Formatting rules (the UI renders markdown in a narrow chat panel):
- Be concise. Lead with the direct answer in 1-2 sentences.
- Use a small markdown table (max 4 columns, short headers) for comparisons.
- Use short bullet points for action steps; **bold** key numbers.
- Never use code fences for prose or math — write formulas inline like: 21,936,930 ÷ 273,421 ≈ **80.2 FLOWER**.
- No horizontal rules, no nested lists, no wide tables.`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChatMessage = { role: string; content: any; [k: string]: unknown };

export interface CompleteOptions {
  /** Override the configured model. */
  model?: string;
  /** Sampling temperature (default 0.4). */
  temperature?: number;
  /** Max tokens to generate — required by the Messages API (default 4096). */
  maxTokens?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /** Anthropic-native tool definitions ({ name, description, input_schema }). */
  tools?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /** Anthropic tool_choice, e.g. { type: 'auto' } | { type: 'tool', name }. */
  toolChoice?: object;
  /** Extra system text appended after any system-role messages. */
  system?: string;
}

/** Coerce OpenAI-style message content (string or content parts) into plain text. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contentToText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return content == null ? '' : String(content);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  [k: string]: unknown;
};

export class ClaudeClient {
  private readonly model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  private readonly baseUrl = (process.env.CLAUDE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  private readonly anthropicVersion = process.env.CLAUDE_ANTHROPIC_VERSION || DEFAULT_ANTHROPIC_VERSION;

  private endpoint(): string {
    return `${this.baseUrl}/v1/messages`;
  }

  private apiKey(): string {
    return process.env.CLAUDE_API_KEY ?? '';
  }

  /**
   * Low-level completion against the Anthropic Messages API.
   * Accepts OpenAI-style messages (system role allowed) and returns the raw
   * Anthropic response JSON. Use `textOf()` to extract the answer string.
   */
  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<AnthropicResponse> {
    // Anthropic requires `system` as a top-level field; conversation messages are
    // user/assistant only. Pull system-role messages out of the array.
    const systemParts = messages
      .filter((m) => m.role === 'system')
      .map((m) => contentToText(m.content))
      .filter(Boolean);
    if (opts.system) systemParts.push(opts.system);

    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: contentToText(m.content),
      }))
      .filter((m) => m.content.length > 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      model: opts.model || this.model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.4,
      messages: conversation,
    };
    if (systemParts.length > 0) body.system = systemParts.join('\n\n');
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      if (opts.toolChoice) body.tool_choice = opts.toolChoice;
    }

    const res = await fetch(this.endpoint(), {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey(),
        'anthropic-version': this.anthropicVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Claude ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<AnthropicResponse>;
  }

  /** Concatenate the text blocks of an Anthropic response into a single string. */
  textOf(resp: AnthropicResponse): string {
    return (resp.content ?? [])
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
  }

  /**
   * Run a completion with the given (OpenAI-style) messages and return the
   * cleaned answer text. Adds no system prompt of its own — pass one via a
   * system-role message or `opts.system`. Returns '' if the model emitted no text.
   */
  async completeText(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    return this.textOf(await this.complete(messages, opts));
  }

  /** Send a user message with structured farm context and get a markdown answer. */
  async chat(message: string, context: unknown): Promise<string> {
    const text = await this.completeText([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `DATA:\n${JSON.stringify(context)}\n\nQUESTION: ${message}` },
    ]);
    if (!text)
      throw new Error('Claude returned an empty answer — check CLAUDE_MODEL/CLAUDE_API_KEY in .env.');
    return text;
  }
}

export const claudeClient = new ClaudeClient();
