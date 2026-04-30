export const defaultModel = "gpt-4o-mini";

export const agentModelIds = [
  "preference-agent",
  "city-research-agent",
  "local-reality-agent",
  "route-planner-agent",
  "hard-validator",
  "evaluator-agent",
  "repair-agent",
  "final-itinerary-agent"
] as const;

export const agentModelLabels: Record<(typeof agentModelIds)[number], string> = {
  "preference-agent": "Preference",
  "city-research-agent": "Research",
  "local-reality-agent": "Reality",
  "route-planner-agent": "Planner",
  "hard-validator": "Validator",
  "evaluator-agent": "Evaluator",
  "repair-agent": "Repair",
  "final-itinerary-agent": "Final"
};

export const modelOptions = [
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    description: "Fast, low-cost default for playground runs."
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    description: "Fast instruction-following and tool-calling model."
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    description: "Stronger non-reasoning model for higher quality outputs."
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    description: "Flexible higher-intelligence general model."
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 mini",
    description: "Cost-efficient GPT-5 family option for agentic tasks."
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    description: "Stronger reasoning model for complex planning."
  }
] as const;

export type AgentModelId = (typeof agentModelIds)[number];

export type AgentModelMap = Partial<Record<AgentModelId, string>>;

export function resolveModel(model: unknown) {
  const modelId = String(model || "").trim();
  return modelOptions.some((option) => option.id === modelId) ? modelId : defaultModel;
}

export function resolveAgentModels(model: unknown, agentModels: unknown): AgentModelMap {
  const defaultResolved = resolveModel(model);
  const raw = agentModels && typeof agentModels === "object" ? (agentModels as Record<string, unknown>) : {};

  return Object.fromEntries(
    agentModelIds.map((agentId) => [agentId, resolveModel(raw[agentId] || defaultResolved)])
  ) as AgentModelMap;
}

export type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  reasoningPerMillion?: number;
};

// USD per 1M tokens. Keep this table near the model list so playground cost math is explicit.
export const modelPricing: Record<string, ModelPricing> = {
  "gpt-4o-mini": {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6
  },
  "gpt-4.1-mini": {
    inputPerMillion: 0.4,
    outputPerMillion: 1.6
  },
  "gpt-4.1": {
    inputPerMillion: 2,
    outputPerMillion: 8
  },
  "gpt-4o": {
    inputPerMillion: 2.5,
    outputPerMillion: 10
  },
  "gpt-5-mini": {
    inputPerMillion: 0.25,
    outputPerMillion: 2
  },
  "gpt-5": {
    inputPerMillion: 1.25,
    outputPerMillion: 10
  }
};

export function calculateTokenCost(model: string, inputTokens: number, outputTokens: number, reasoningTokens = 0) {
  const pricing = modelPricing[resolveModel(model)];

  if (!pricing) {
    return undefined;
  }

  const outputBillableTokens = outputTokens + reasoningTokens;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputBillableTokens / 1_000_000) * (pricing.reasoningPerMillion || pricing.outputPerMillion);

  return Number((inputCost + outputCost).toFixed(8));
}
