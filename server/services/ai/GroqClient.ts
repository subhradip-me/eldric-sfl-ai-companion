/**
 * GroqClient — Groq LLM chat completions.
 * LLM explains; never calculates (design §20).
 */

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

export class GroqClient {
  /** Send a user message with structured farm context and get a markdown answer. */
  async chat(message: string, context: unknown): Promise<string> {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `DATA:\n${JSON.stringify(context)}\n\nQUESTION: ${message}` },
        ],
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Groq ${res.status}: ${body.slice(0, 200)}`);
    }

    const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    let content = j.choices?.[0]?.message?.content ?? '';
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!content)
      throw new Error('Groq returned an empty answer — check GROQ_MODEL in .env (try llama-3.3-70b-versatile).');
    return content;
  }
}

export const groqClient = new GroqClient();
