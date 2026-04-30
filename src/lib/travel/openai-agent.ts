import OpenAI from "openai";
import { AgentExecutionMeta, AgentPrompt, AgentTokenUsage, SourceRef } from "./types";
import { calculateTokenCost, defaultModel, resolveModel } from "./models";

export type JsonAgentResult<T> = {
  data: T;
  meta: AgentExecutionMeta;
  sources: SourceRef[];
  usage?: AgentTokenUsage;
};

let client: OpenAI | null = null;

const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;
const DEFAULT_OPENAI_WEB_SEARCH_TIMEOUT_MS = 1_200_000;
const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 6_000;
const DEFAULT_OPENAI_WEB_SEARCH_MAX_OUTPUT_TOKENS = 12_000;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS) || DEFAULT_OPENAI_TIMEOUT_MS
    });
  }

  return client;
}

function getModel(model?: string) {
  return model ? resolveModel(model) : process.env.OPENAI_MODEL || defaultModel;
}

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced?.[1] || trimmed;
}

function getOutputText(response: unknown) {
  const direct = response as { output_text?: string };
  if (typeof direct.output_text === "string") {
    return direct.output_text;
  }

  const structured = response as {
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  const text = structured.output
    ?.flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("");

  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }

  return text;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readUsage(response: unknown, model: string): AgentTokenUsage | undefined {
  const value = response as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      input_tokens_details?: {
        cached_tokens?: number;
      };
      output_tokens_details?: {
        reasoning_tokens?: number;
      };
    };
  };

  if (!value.usage) return undefined;

  const inputTokens = numberValue(value.usage.input_tokens);
  const outputTokens = numberValue(value.usage.output_tokens);
  const cachedInputTokens = numberValue(value.usage.input_tokens_details?.cached_tokens);
  const reasoningTokens = numberValue(value.usage.output_tokens_details?.reasoning_tokens);
  const totalTokens = numberValue(value.usage.total_tokens) || inputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    costUsd: calculateTokenCost(model, inputTokens, outputTokens, reasoningTokens)
  };
}

function hasWebSearchCall(response: unknown) {
  const value = response as {
    output?: Array<{
      type?: string;
    }>;
  };

  return Boolean(value.output?.some((item) => item.type === "web_search_call"));
}

function responseStatus(response: unknown) {
  const value = response as {
    status?: string;
    incomplete_details?: {
      reason?: string;
    };
  };

  return {
    responseStatus: value.status,
    incompleteReason: value.incomplete_details?.reason
  };
}

function readWebSearchQueries(response: unknown): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();

  function add(query: unknown) {
    if (typeof query !== "string") return;
    const normalized = query.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    queries.push(normalized);
  }

  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    const object = value as Record<string, unknown>;
    add(object.query);

    if (Array.isArray(object.queries)) {
      object.queries.forEach(add);
    }

    Object.values(object).forEach(walk);
  }

  walk((response as { output?: unknown }).output);
  return queries.slice(0, 10);
}

function readWebSources(response: unknown): SourceRef[] {
  const collected: SourceRef[] = [];
  const seen = new Set<string>();

  function add(source: { title?: unknown; url?: unknown; confidence?: unknown }) {
    const url = String(source.url || "").trim();
    if (!url || url.includes("example.com") || seen.has(url)) return;

    seen.add(url);
    collected.push({
      title: String(source.title || url),
      url,
      confidence: typeof source.confidence === "number" ? source.confidence : 0.75
    });
  }

  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    const object = value as Record<string, unknown>;
    if (typeof object.url === "string") {
      add(object);
    }

    Object.values(object).forEach(walk);
  }

  walk((response as { output?: unknown }).output);
  return collected.slice(0, 12);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown OpenAI error";
}

function isAbortError(error: unknown) {
  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.toLowerCase().includes("aborted");
  }

  return false;
}

function parseResponse<T>(response: unknown, model: string) {
  const usage = readUsage(response, model);

  try {
    return {
      data: JSON.parse(extractJson(getOutputText(response))) as T,
      usage,
      parseError: undefined
    };
  } catch (error) {
    return {
      data: undefined,
      usage,
      parseError: errorMessage(error)
    };
  }
}

function isReasoningModel(model: string) {
  return model.startsWith("gpt-5") || model.startsWith("o");
}

function reasoningEffortFor(model: string, useWebSearch: boolean) {
  if (!isReasoningModel(model)) return undefined;

  return {
    effort: process.env.OPENAI_REASONING_EFFORT || (useWebSearch ? "low" : "low")
  };
}

async function createResponse(prompt: AgentPrompt, useWebSearch: boolean, model?: string, signal?: AbortSignal) {
  const selectedModel = getModel(model);
  const tools = useWebSearch
    ? [
        {
          type: "web_search_preview",
          search_context_size: "medium"
        }
      ]
    : undefined;

  const responseConfig: Parameters<OpenAI["responses"]["create"]>[0] = {
    model: selectedModel,
    input: [
      {
        role: "system",
        content: `${prompt.system}\n\nReturn only a valid JSON object.`
      },
      {
        role: "user",
        content: prompt.user
      }
    ],
    tools,
    tool_choice: useWebSearch ? "required" : undefined,
    include: useWebSearch ? ["web_search_call.action.sources"] : undefined,
    reasoning: reasoningEffortFor(selectedModel, useWebSearch),
    max_output_tokens: useWebSearch
      ? Number(process.env.OPENAI_WEB_SEARCH_MAX_OUTPUT_TOKENS) || DEFAULT_OPENAI_WEB_SEARCH_MAX_OUTPUT_TOKENS
      : Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || DEFAULT_OPENAI_MAX_OUTPUT_TOKENS
  } as Parameters<OpenAI["responses"]["create"]>[0];

  if (!useWebSearch) {
    responseConfig.text = {
      format: {
        type: "json_object"
      }
    };
  }

  return getClient().responses.create(
    responseConfig,
    {
      signal,
      timeout: useWebSearch
        ? Number(process.env.OPENAI_WEB_SEARCH_TIMEOUT_MS) || DEFAULT_OPENAI_WEB_SEARCH_TIMEOUT_MS
        : Number(process.env.OPENAI_TIMEOUT_MS) || DEFAULT_OPENAI_TIMEOUT_MS
    }
  );
}

export async function runJsonAgent<T>(
  prompt: AgentPrompt,
  fallback: () => T,
  options: { useWebSearch?: boolean; model?: string; webSearchEnabled?: boolean; signal?: AbortSignal } = {}
): Promise<JsonAgentResult<T>> {
  const webSearchRequested = Boolean(options.useWebSearch);
  const webSearchEnabled = Boolean(options.webSearchEnabled);

  if (!process.env.OPENAI_API_KEY) {
    return {
      data: fallback(),
      sources: [],
      meta: {
        provider: "fallback",
        webSearchRequested,
        webSearchEnabled,
        webSearchUsed: false,
        fallbackReason: "OPENAI_API_KEY is missing."
      }
    };
  }

  const useWebSearch = webSearchRequested && webSearchEnabled;
  const model = getModel(options.model);

  try {
    if (options.signal?.aborted) {
      throw new Error("Run aborted.");
    }

    const response = await createResponse(prompt, Boolean(useWebSearch), model, options.signal);
    const parsed = parseResponse<T>(response, model);
    const sources = readWebSources(response);
    const webSearchQueries = readWebSearchQueries(response);
    const status = responseStatus(response);

    if (parsed.parseError) {
      return {
        data: fallback(),
        sources,
        meta: {
          provider: "fallback",
          webSearchRequested,
          webSearchEnabled,
          webSearchUsed: hasWebSearchCall(response),
          webSearchQueries,
          ...status,
          fallbackReason: `OpenAI response received but JSON parse failed: ${parsed.parseError}`
        },
        usage: parsed.usage
      };
    }

    return {
      data: parsed.data as T,
      sources,
      meta: {
        provider: "openai",
        webSearchRequested,
        webSearchEnabled,
        webSearchUsed: hasWebSearchCall(response),
        webSearchQueries,
        ...status
      },
      usage: parsed.usage
    };
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      throw error instanceof Error ? error : new Error("Run aborted.");
    }

    if (useWebSearch) {
      try {
        if (options.signal?.aborted) {
          throw new Error("Run aborted.");
        }

        const response = await createResponse(prompt, false, model, options.signal);
        const parsed = parseResponse<T>(response, model);
        const sources = readWebSources(response);
        const webSearchQueries = readWebSearchQueries(response);
        const status = responseStatus(response);

        if (parsed.parseError) {
          return {
            data: fallback(),
            sources,
            meta: {
              provider: "fallback",
              webSearchRequested,
              webSearchEnabled,
              webSearchUsed: false,
              webSearchQueries,
              ...status,
              fallbackReason: `Retried without web search, but JSON parse failed: ${parsed.parseError}`
            },
            usage: parsed.usage
          };
        }

        return {
          data: parsed.data as T,
          sources,
          meta: {
            provider: "openai",
            webSearchRequested,
            webSearchEnabled,
            webSearchUsed: false,
            webSearchQueries,
            ...status,
            fallbackReason: `Retried without web search after: ${errorMessage(error)}`
          },
          usage: parsed.usage
        };
      } catch (retryError) {
        if (options.signal?.aborted || isAbortError(retryError)) {
          throw retryError instanceof Error ? retryError : new Error("Run aborted.");
        }

        console.warn("OpenAI agent fallback:", retryError);
        return {
          data: fallback(),
          sources: [],
          meta: {
            provider: "fallback",
            webSearchRequested,
            webSearchEnabled,
            webSearchUsed: false,
            fallbackReason: errorMessage(retryError)
          }
        };
      }
    }

    console.warn("OpenAI agent fallback:", error);
    return {
      data: fallback(),
      sources: [],
      meta: {
        provider: "fallback",
        webSearchRequested,
        webSearchEnabled,
        webSearchUsed: false,
        fallbackReason: errorMessage(error)
      }
    };
  }
}
