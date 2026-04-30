import { AgentModelMap } from "./models";

export type Pace = "relaxed" | "balanced" | "intense";
export type Budget = "low" | "medium" | "high";

export type TravelRequest = {
  city: string;
  days: number;
  budget: Budget;
  pace: Pace;
  model: string;
  agentModels: AgentModelMap;
  webSearchEnabled: boolean;
  interests: string[];
  notes: string;
};

export type AgentPrompt = {
  system: string;
  user: string;
};

export type TravelerProfile = {
  city: string;
  days: number;
  budget: Budget;
  pace: Pace;
  model: string;
  agentModels: AgentModelMap;
  webSearchEnabled: boolean;
  interests: string[];
  avoid: string[];
  dailyTimeBudgetHours: number;
  maxStopsPerDay: number;
};

export type SourceRef = {
  title: string;
  url: string;
  confidence: number;
};

export type CandidatePlace = {
  id: string;
  name: string;
  category: string;
  area: string;
  priority: number;
  estimatedDurationMinutes: number;
  expectedCost: number;
  tags: string[];
  whyVisit: string;
  sources: SourceRef[];
};

export type RealityCheckedPlace = CandidatePlace & {
  openingWindow: string;
  bestVisitWindow: "morning" | "afternoon" | "evening";
  transitComplexity: "low" | "medium" | "high";
  constraints: string[];
  realismScore: number;
};

export type ItineraryStop = {
  placeId: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  cost: number;
  transferMinutes: number;
  reason: string;
};

export type ItineraryDay = {
  day: number;
  theme: string;
  totalCost: number;
  totalMinutes: number;
  stops: ItineraryStop[];
};

export type Itinerary = {
  days: ItineraryDay[];
  estimatedTotalCost: number;
  narrative: string;
};

export type ValidationResult = {
  passed: boolean;
  issues: string[];
  warnings: string[];
  metrics: {
    totalCost: number;
    averageStopsPerDay: number;
    maxDayMinutes: number;
  };
};

export type EvaluationResult = {
  score: number;
  budgetScore: number;
  timeEfficiencyScore: number;
  interestMatchScore: number;
  realismScore: number;
  issues: string[];
  repairInstructions: string[];
};

export type AgentStepStatus = "pending" | "running" | "complete" | "warning" | "failed";

export type AgentTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd?: number;
};

export type AgentExecutionMeta = {
  provider: "openai" | "fallback";
  webSearchRequested: boolean;
  webSearchEnabled: boolean;
  webSearchUsed: boolean;
  webSearchQueries?: string[];
  responseStatus?: string;
  incompleteReason?: string;
  fallbackReason?: string;
};

export type AgentStep = {
  id: string;
  title: string;
  role: string;
  model?: string;
  status: AgentStepStatus;
  prompt?: AgentPrompt;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  meta?: AgentExecutionMeta;
  usage?: AgentTokenUsage;
  input: unknown;
  output?: unknown;
};

export type PipelineResult = {
  request: TravelRequest;
  steps: AgentStep[];
  finalItinerary: Itinerary;
  evaluation: EvaluationResult;
  validation: ValidationResult;
  iterations: number;
};

export type PipelineStepStartEvent = {
  type: "step-start";
  step: AgentStep;
};

export type PipelineStepCompleteEvent = {
  type: "step-complete";
  step: AgentStep;
};

export type PipelineCompleteEvent = {
  type: "pipeline-complete";
  result: PipelineResult;
};

export type PipelineErrorEvent = {
  type: "pipeline-error";
  error: string;
};

export type PipelineStreamEvent =
  | PipelineStepStartEvent
  | PipelineStepCompleteEvent
  | PipelineCompleteEvent
  | PipelineErrorEvent;
