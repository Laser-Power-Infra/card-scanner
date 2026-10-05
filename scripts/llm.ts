/**
 * OpenAI-compatible JSON client for the cleanup scripts.
 *
 * Script-only: never import this from `app/`. The model id is read from
 * `LLM_MODEL` rather than hard-coded, because the app routes pin a model id that
 * `CONCERNS.md` flags as invalid.
 */

export interface ChatJsonOptions {
  system: string;
  user: unknown;
}

export class MissingLlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingLlmConfigError";
  }
}

export class LlmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmParseError";
  }
}

interface LlmConfig {
  url: string;
  key: string;
  model: string;
}

function readConfig(): LlmConfig {
  const url = process.env.LLM_API_URL;
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!url) throw new MissingLlmConfigError("Missing LLM_API_URL environment variable.");
  if (!key) throw new MissingLlmConfigError("Missing OPENAI_API_KEY environment variable.");
  if (!model) throw new MissingLlmConfigError("Missing LLM_MODEL environment variable.");
  return { url, key, model };
}

/** Strip a ```json fence and parse. Throws LlmParseError on failure. */
export function parseJsonContent(text: string): unknown {
  const stripped = text.replace(/```json\s*|```/gi, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new LlmParseError(`LLM did not return JSON: ${stripped.slice(0, 200)}`);
  }
}

/**
 * Unwrap the common envelope keys the model may use. Returns the raw parsed
 * value when it is already an array or an object without those keys.
 */
export function unwrapRows(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of ["rows", "results", "data"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

async function requestOnce<T>(config: LlmConfig, opts: ChatJsonOptions): Promise<T> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: opts.system },
        {
          role: "user",
          content: typeof opts.user === "string" ? opts.user : JSON.stringify(opts.user),
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return parseJsonContent(data.choices?.[0]?.message?.content ?? "{}") as T;
}

/**
 * Send one prompt and parse JSON, retrying once on a parse failure. Throws after
 * the second failure so the caller can fall back to per-row retries.
 */
export async function chatJson<T>(opts: ChatJsonOptions): Promise<T> {
  const config = readConfig();
  try {
    return await requestOnce<T>(config, opts);
  } catch (error) {
    if (error instanceof LlmParseError) {
      return await requestOnce<T>(config, opts);
    }
    throw error;
  }
}

/**
 * Chat and return a row array, unwrapping `rows`/`results`/`data`. Returns `[]`
 * instead of throwing on a bad batch so the caller can retry rows individually.
 */
export async function chatRows<T>(opts: ChatJsonOptions): Promise<T[]> {
  try {
    return unwrapRows(await chatJson<unknown>(opts)) as T[];
  } catch (error) {
    console.error("[llm] batch failed:", error);
    return [];
  }
}
