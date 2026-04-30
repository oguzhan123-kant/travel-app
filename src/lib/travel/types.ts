export type Pace = "relaxed" | "balanced" | "intense";
export type Budget = "low" | "medium" | "high";

export type TravelRequest = {
  city: string;
  days: number;
  budget: Budget;
  pace: Pace;
  interests: string[];
  notes: string;
};

export type TravelerProfile = {
  city: string;
  days: number;
  budget: Budget;
  pace: Pace;
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

export type AgentStep = {
  id: string;
  title: string;
  role: string;
  status: "complete" | "warning" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  input: unknown;
  output: unknown;
};

export type PipelineResult = {
  request: TravelRequest;
  steps: AgentStep[];
  finalItinerary: Itinerary;
  evaluation: EvaluationResult;
  validation: ValidationResult;
  iterations: number;
};
