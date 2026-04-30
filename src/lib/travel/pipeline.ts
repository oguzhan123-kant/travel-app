import {
  AgentPrompt,
  AgentStep,
  AgentExecutionMeta,
  AgentTokenUsage,
  Budget,
  CandidatePlace,
  EvaluationResult,
  Itinerary,
  ItineraryDay,
  ItineraryStop,
  Pace,
  PipelineResult,
  PipelineStreamEvent,
  RealityCheckedPlace,
  SourceRef,
  TravelRequest,
  TravelerProfile,
  ValidationResult
} from "./types";
import { getSeedPlaces } from "./mock-data";
import { runJsonAgent } from "./openai-agent";
import { resolveModel } from "./models";

type StepRunResult<TOutput> = {
  output: TOutput;
  meta?: AgentExecutionMeta;
  usage?: AgentTokenUsage;
};

type StepRunner<TInput, TOutput> = {
  id: string;
  title: string;
  role: string;
  prompt?: (input: TInput) => AgentPrompt;
  run: (
    input: TInput,
    prompt?: AgentPrompt,
    options?: PipelineRunOptions
  ) => Promise<TOutput | StepRunResult<TOutput>> | TOutput | StepRunResult<TOutput>;
};

const nowIso = () => new Date().toISOString();

type PipelineEventHandler = (event: PipelineStreamEvent) => void | Promise<void>;
type PipelineRunOptions = {
  signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Run aborted.");
  }
}

function stepModel(agentId: string, input: unknown) {
  const value = input as {
    model?: unknown;
    agentModels?: Record<string, unknown>;
    profile?: { model?: unknown; agentModels?: Record<string, unknown> };
  };

  return resolveModel(
    value.agentModels?.[agentId] ||
      value.profile?.agentModels?.[agentId] ||
      value.model ||
      value.profile?.model
  );
}

function selectedModel(profile: TravelerProfile, agentId: keyof TravelerProfile["agentModels"]) {
  return resolveModel(profile.agentModels[agentId] || profile.model);
}

function stepResult<TOutput>(value: TOutput | StepRunResult<TOutput>): StepRunResult<TOutput> {
  if (value && typeof value === "object" && "output" in value) {
    return value as StepRunResult<TOutput>;
  }

  return {
    output: value as TOutput
  };
}

async function runStep<TInput, TOutput>(
  steps: AgentStep[],
  runner: StepRunner<TInput, TOutput>,
  input: TInput,
  onEvent?: PipelineEventHandler,
  options: PipelineRunOptions = {}
): Promise<TOutput> {
  throwIfAborted(options.signal);
  const started = performance.now();
  const startedAt = nowIso();
  const prompt = runner.prompt?.(input);
  const runningStep: AgentStep = {
    id: runner.id,
    title: runner.title,
    role: runner.role,
    model: stepModel(runner.id, input),
    status: "running",
    prompt,
    startedAt,
    durationMs: 0,
    input
  };

  await onEvent?.({
    type: "step-start",
    step: runningStep
  });
  throwIfAborted(options.signal);

  try {
    const result = stepResult(await runner.run(input, prompt, options));
    throwIfAborted(options.signal);
    const durationMs = Math.round(performance.now() - started);
    const step: AgentStep = {
      id: runner.id,
      title: runner.title,
      role: runner.role,
      model: stepModel(runner.id, input),
      status: "complete",
      prompt,
      startedAt,
      finishedAt: nowIso(),
      durationMs,
      meta: result.meta,
      usage: result.usage,
      input,
      output: result.output
    };

    steps.push(step);
    await onEvent?.({
      type: "step-complete",
      step
    });

    return result.output;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const step: AgentStep = {
      id: runner.id,
      title: runner.title,
      role: runner.role,
      model: stepModel(runner.id, input),
      status: "failed",
      prompt,
      startedAt,
      finishedAt: nowIso(),
      durationMs,
      input,
      output: {
        message: error instanceof Error ? error.message : "Unknown pipeline error"
      }
    };

    steps.push(step);
    await onEvent?.({
      type: "step-complete",
      step
    });
    throw error;
  }
}

const budgetLimit: Record<Budget, number> = {
  low: 55,
  medium: 110,
  high: 220
};

const paceConfig: Record<Pace, { hours: number; stops: number }> = {
  relaxed: { hours: 6, stops: 4 },
  balanced: { hours: 8, stops: 5 },
  intense: { hours: 10, stops: 7 }
};

const budgetValues: Budget[] = ["low", "medium", "high"];
const paceValues: Pace[] = ["relaxed", "balanced", "intense"];

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function slug(value: string, fallback: string) {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return result || fallback;
}

function validBudget(value: unknown, fallback: Budget): Budget {
  return budgetValues.includes(value as Budget) ? (value as Budget) : fallback;
}

function validPace(value: unknown, fallback: Pace): Pace {
  return paceValues.includes(value as Pace) ? (value as Pace) : fallback;
}

function safeSources(place: Partial<CandidatePlace>, city: string, topic: string): SourceRef[] {
  if (Array.isArray(place.sources) && place.sources.length > 0) {
    return place.sources
      .map((source, index) => ({
        title: String(source.title || `${topic} source ${index + 1}`),
        url: String(source.url || ""),
        confidence: Number.isFinite(source.confidence) ? Number(source.confidence) : 0.7
      }))
      .filter((source) => source.url && !source.url.includes("example.com"));
  }

  return [];
}

function normalizeCandidate(place: Partial<CandidatePlace>, index: number, city: string): CandidatePlace {
  const name = String(place.name || `Candidate Place ${index + 1}`);
  const tags = Array.isArray(place.tags) ? place.tags.map(String).filter(Boolean) : ["general"];

  return {
    id: String(place.id || slug(name, `place-${index + 1}`)),
    name,
    category: String(place.category || "culture"),
    area: String(place.area || "central area"),
    priority: Math.max(1, Math.min(100, Number(place.priority) || 65)),
    estimatedDurationMinutes: Math.max(30, Math.min(300, Number(place.estimatedDurationMinutes) || 90)),
    expectedCost: Math.max(0, Math.min(500, Number(place.expectedCost) || 0)),
    tags,
    whyVisit: String(place.whyVisit || "Useful candidate for the requested travel style."),
    sources: safeSources(place, city, name)
  };
}

function attachFallbackSources(places: CandidatePlace[], sources: SourceRef[]) {
  if (sources.length === 0) return places;

  return places.map((place, index) => ({
    ...place,
    sources: place.sources.length > 0 ? place.sources : sources.slice(index % sources.length, index % sources.length + 2)
  }));
}

function readCandidatePlacesPayload(value: unknown): Partial<CandidatePlace>[] {
  if (Array.isArray(value)) {
    return value as Partial<CandidatePlace>[];
  }

  if (value && typeof value === "object") {
    const places = (value as { places?: unknown }).places;
    return Array.isArray(places) ? (places as Partial<CandidatePlace>[]) : [];
  }

  return [];
}

function normalizeRealityPlace(
  place: Partial<RealityCheckedPlace>,
  fallback: CandidatePlace,
  index: number,
  city: string
): RealityCheckedPlace {
  const base = normalizeCandidate({ ...fallback, ...place }, index, city);
  const bestVisitWindow = ["morning", "afternoon", "evening"].includes(String(place.bestVisitWindow))
    ? (place.bestVisitWindow as RealityCheckedPlace["bestVisitWindow"])
    : index % 3 === 0
      ? "morning"
      : index % 3 === 1
        ? "afternoon"
        : "evening";
  const transitComplexity = ["low", "medium", "high"].includes(String(place.transitComplexity))
    ? (place.transitComplexity as RealityCheckedPlace["transitComplexity"])
    : "low";

  return {
    ...base,
    openingWindow: String(place.openingWindow || "09:00-18:00"),
    bestVisitWindow,
    transitComplexity,
    constraints: Array.isArray(place.constraints) ? place.constraints.map(String).filter(Boolean) : [],
    realismScore: Math.max(1, Math.min(100, Number(place.realismScore) || 78))
  };
}

function localProfile(request: TravelRequest): TravelerProfile {
  const notes = request.notes.toLowerCase();
  const avoid = [
    notes.includes("museum") || notes.includes("müze sevmem") ? "long_museum_visits" : "",
    notes.includes("walk") || notes.includes("yürümek istemiyorum") ? "long_walks" : ""
  ].filter(Boolean);

  return {
    city: request.city,
    days: request.days,
    budget: request.budget,
    pace: request.pace,
    model: request.model,
    agentModels: request.agentModels,
    webSearchEnabled: request.webSearchEnabled,
    interests: request.interests,
    avoid,
    dailyTimeBudgetHours: paceConfig[request.pace].hours,
    maxStopsPerDay: paceConfig[request.pace].stops
  };
}

function localCandidates(profile: TravelerProfile): CandidatePlace[] {
  const seedPlaces = getSeedPlaces(profile.city);
  const interestBoosted = seedPlaces.map((place) => {
    const matchCount = place.tags.filter((tag) => profile.interests.includes(tag)).length;
    return {
      ...place,
      priority: Math.min(100, place.priority + matchCount * 6)
    };
  });

  return interestBoosted.sort((a, b) => b.priority - a.priority);
}

function localReality(profile: TravelerProfile, candidates: CandidatePlace[]): RealityCheckedPlace[] {
  return candidates.map((place, index) => {
    const isMuseum = place.category === "museum";
    const costPressure = place.expectedCost > budgetLimit[profile.budget] * 0.35;
    const constraints = [
      isMuseum ? "Verify weekly closing day before ticket purchase." : "",
      costPressure ? "High share of daily budget." : "",
      place.estimatedDurationMinutes > 140 ? "Needs protected time block." : ""
    ].filter(Boolean);

    return {
      ...place,
      openingWindow: isMuseum ? "10:00-18:00" : "09:00-22:00",
      bestVisitWindow: index % 3 === 0 ? "morning" : index % 3 === 1 ? "afternoon" : "evening",
      transitComplexity: index % 4 === 0 ? "medium" : "low",
      constraints,
      realismScore: Math.max(62, 94 - constraints.length * 9 - (index > 7 ? 8 : 0))
    };
  });
}

function minutesToClock(total: number) {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function chooseTransferMinutes(previous: RealityCheckedPlace | undefined, next: RealityCheckedPlace) {
  if (!previous) return 0;
  if (previous.area === next.area) return 10;
  if (previous.transitComplexity === "medium" || next.transitComplexity === "medium") return 28;
  return 18;
}

function localItinerary(profile: TravelerProfile, places: RealityCheckedPlace[]): Itinerary {
  const avoidMuseum = profile.avoid.includes("long_museum_visits");
  const filtered = places.filter((place) => !(avoidMuseum && place.category === "museum"));
  const selected = filtered.slice(0, profile.days * profile.maxStopsPerDay);
  const days: ItineraryDay[] = [];

  for (let day = 1; day <= profile.days; day += 1) {
    const dayPlaces = selected
      .filter((_, index) => index % profile.days === day - 1)
      .slice(0, profile.maxStopsPerDay)
      .sort((a, b) => {
        const order = { morning: 0, afternoon: 1, evening: 2 };
        return order[a.bestVisitWindow] - order[b.bestVisitWindow];
      });

    let cursor = 9 * 60 + (day - 1) * 15;
    let previous: RealityCheckedPlace | undefined;
    const stops: ItineraryStop[] = [];

    for (const place of dayPlaces) {
      const transferMinutes = chooseTransferMinutes(previous, place);
      const nextTotalMinutes =
        stops.reduce((sum, stop) => sum + stop.durationMinutes + stop.transferMinutes, 0) +
        transferMinutes +
        place.estimatedDurationMinutes;

      if (nextTotalMinutes > profile.dailyTimeBudgetHours * 60 && stops.length >= 2) {
        continue;
      }

      cursor += transferMinutes;
      const startTime = minutesToClock(cursor);
      cursor += place.estimatedDurationMinutes;
      previous = place;

      stops.push({
        placeId: place.id,
        name: place.name,
        startTime,
        durationMinutes: place.estimatedDurationMinutes,
        cost: place.expectedCost,
        transferMinutes,
        reason: `${place.whyVisit} Matched tags: ${
          place.tags.filter((tag) => profile.interests.includes(tag)).join(", ") || "general city priority"
        }.`
      });
    }

    days.push({
      day,
      theme: stops[0]?.name ? `${profile.city} focus: ${stops[0].name}` : "Flexible exploration",
      totalCost: stops.reduce((sum, stop) => sum + stop.cost, 0),
      totalMinutes: stops.reduce((sum, stop) => sum + stop.durationMinutes + stop.transferMinutes, 0),
      stops
    });
  }

  return {
    days,
    estimatedTotalCost: days.reduce((sum, day) => sum + day.totalCost, 0),
    narrative: `Draft route optimized for ${profile.pace} pace, ${profile.budget} budget, and ${profile.interests.join(", ")} interests.`
  };
}

function validateItinerary(profile: TravelerProfile, itinerary: Itinerary): ValidationResult {
  const dailyBudget = budgetLimit[profile.budget];
  const issues: string[] = [];
  const warnings: string[] = [];

  for (const day of itinerary.days) {
    if (day.totalCost > dailyBudget) {
      issues.push(`Day ${day.day} exceeds daily ${profile.budget} budget target by ${day.totalCost - dailyBudget}.`);
    }

    if (day.totalMinutes > profile.dailyTimeBudgetHours * 60) {
      issues.push(`Day ${day.day} exceeds ${profile.dailyTimeBudgetHours} hour pace target.`);
    }

    if (day.stops.length === 0) {
      warnings.push(`Day ${day.day} has no planned stops.`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
    metrics: {
      totalCost: itinerary.estimatedTotalCost,
      averageStopsPerDay:
        itinerary.days.reduce((sum, day) => sum + day.stops.length, 0) / itinerary.days.length,
      maxDayMinutes: Math.max(...itinerary.days.map((day) => day.totalMinutes))
    }
  };
}

function localEvaluation(
  profile: TravelerProfile,
  itinerary: Itinerary,
  validation: ValidationResult
): EvaluationResult {
  const budgetScore = validation.issues.some((issue) => issue.includes("budget")) ? 68 : 92;
  const timeEfficiencyScore = validation.issues.some((issue) => issue.includes("pace")) ? 64 : 88;
  const interestHits = itinerary.days.flatMap((day) => day.stops.map((stop) => stop.reason)).join(" ");
  const interestMatchScore = Math.min(
    96,
    72 + profile.interests.filter((interest) => interestHits.includes(interest)).length * 8
  );
  const realismScore = validation.passed ? 88 : 70;
  const score = Math.round((budgetScore + timeEfficiencyScore + interestMatchScore + realismScore) / 4);
  const issues = [...validation.issues];

  if (interestMatchScore < 82) {
    issues.push("Route does not strongly reflect enough declared interests.");
  }

  return {
    score,
    budgetScore,
    timeEfficiencyScore,
    interestMatchScore,
    realismScore,
    issues,
    repairInstructions:
      score >= 82
        ? ["No repair required; final narrative can be generated."]
        : [
            "Remove or replace the lowest priority expensive stop.",
            "Reduce transfers by keeping each day closer to one area.",
            "Prefer stops whose tags match declared interests."
          ]
  };
}

function localRepair(profile: TravelerProfile, itinerary: Itinerary, evaluation: EvaluationResult): Itinerary {
  if (evaluation.score >= 82) return itinerary;

  const dailyBudget = budgetLimit[profile.budget];
  const repairedDays = itinerary.days.map((day) => {
    const trimmedStops = [...day.stops]
      .sort((a, b) => a.cost - b.cost)
      .slice(0, Math.max(2, profile.maxStopsPerDay - 1))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    const totalCost = trimmedStops.reduce((sum, stop) => sum + stop.cost, 0);
    const withinBudgetStops =
      totalCost <= dailyBudget ? trimmedStops : trimmedStops.filter((stop) => stop.cost <= dailyBudget * 0.4);

    return {
      ...day,
      stops: withinBudgetStops,
      totalCost: withinBudgetStops.reduce((sum, stop) => sum + stop.cost, 0),
      totalMinutes: withinBudgetStops.reduce(
        (sum, stop) => sum + stop.durationMinutes + Math.min(stop.transferMinutes, 18),
        0
      )
    };
  });

  return {
    days: repairedDays,
    estimatedTotalCost: repairedDays.reduce((sum, day) => sum + day.totalCost, 0),
    narrative: `${itinerary.narrative} Repaired with critic feedback: ${evaluation.repairInstructions.join(" ")}`
  };
}

function normalizeItinerary(value: Partial<Itinerary>, fallback: Itinerary): Itinerary {
  const days = Array.isArray(value.days) && value.days.length > 0 ? value.days : fallback.days;
  const normalizedDays = days.map((day, dayIndex) => {
    const stops = Array.isArray(day.stops) ? day.stops : [];

    return {
      day: Number(day.day) || dayIndex + 1,
      theme: String(day.theme || fallback.days[dayIndex]?.theme || "Daily route"),
      totalCost: Number(day.totalCost) || stops.reduce((sum, stop) => sum + (Number(stop.cost) || 0), 0),
      totalMinutes:
        Number(day.totalMinutes) ||
        stops.reduce(
          (sum, stop) => sum + (Number(stop.durationMinutes) || 0) + (Number(stop.transferMinutes) || 0),
          0
        ),
      stops: stops.map((stop, index) => ({
        placeId: String(stop.placeId || `stop-${dayIndex + 1}-${index + 1}`),
        name: String(stop.name || `Stop ${index + 1}`),
        startTime: String(stop.startTime || minutesToClock(9 * 60 + index * 90)),
        durationMinutes: Math.max(15, Number(stop.durationMinutes) || 60),
        cost: Math.max(0, Number(stop.cost) || 0),
        transferMinutes: Math.max(0, Number(stop.transferMinutes) || 0),
        reason: String(stop.reason || "Selected by planner.")
      }))
    };
  });

  return {
    days: normalizedDays,
    estimatedTotalCost:
      Number(value.estimatedTotalCost) || normalizedDays.reduce((sum, day) => sum + day.totalCost, 0),
    narrative: String(value.narrative || fallback.narrative)
  };
}

const preferenceAgent: StepRunner<TravelRequest, TravelerProfile> = {
  id: "preference-agent",
  title: "Preference Agent",
  role: "User intent normalization",
  prompt: (request) => ({
    system:
      "You are a travel preference parser. Convert messy traveler input into normalized planning constraints. Keep the user's explicit city, days, budget, and pace unless the input is invalid.",
    user: `Normalize this travel request as JSON with keys city, days, budget, pace, interests, avoid, dailyTimeBudgetHours, maxStopsPerDay.\n\nRequest:\n${json(request)}`
  }),
  run: async (request, prompt, options) => {
    const fallback = () => localProfile(request);
    const parsed = await runJsonAgent<TravelerProfile>(prompt!, fallback, {
      webSearchEnabled: request.webSearchEnabled,
      signal: options?.signal,
      model: request.agentModels["preference-agent"] || request.model
    });

    return {
      output: {
        ...parsed.data,
        city: request.city,
        days: request.days,
        budget: validBudget(parsed.data.budget, request.budget),
        pace: validPace(parsed.data.pace, request.pace),
        model: request.model,
        agentModels: request.agentModels,
        webSearchEnabled: request.webSearchEnabled,
        interests: Array.isArray(parsed.data.interests) && parsed.data.interests.length > 0 ? parsed.data.interests : request.interests,
        avoid: Array.isArray(parsed.data.avoid) ? parsed.data.avoid : [],
        dailyTimeBudgetHours:
          Number(parsed.data.dailyTimeBudgetHours) || paceConfig[validPace(parsed.data.pace, request.pace)].hours,
        maxStopsPerDay: Number(parsed.data.maxStopsPerDay) || paceConfig[validPace(parsed.data.pace, request.pace)].stops
      },
      meta: parsed.meta,
      usage: parsed.usage
    };
  }
};

const cityResearchAgent: StepRunner<TravelerProfile, CandidatePlace[]> = {
  id: "city-research-agent",
  title: "City Research Agent",
  role: "Web-search style POI discovery",
  prompt: (profile) => ({
    system:
      "You are a city research agent for itinerary planning. You must use web search before answering. Use current, source-aware travel judgment. Prefer official tourism, maps, museums, transit, and reputable local guide signals. Do not invent places. Return specific real place names, not generic clusters or labels.",
    user: `Research candidate places for this traveler by first running web searches with these exact query intents:
- "places to visit in ${profile.city}"
- "best things to do in ${profile.city} official tourism"
- "${profile.city} hidden gems local neighborhoods food viewpoints"

From the search results, choose 8-10 specific places. Return a compact JSON object exactly in this shape:
{"places":[{"id":"kebab-case","name":"Real Place Name","category":"history|museum|food|viewpoint|culture|shopping|walk|nature","area":"district/neighborhood","priority":1-100,"estimatedDurationMinutes":60,"expectedCost":0,"tags":["tag"],"whyVisit":"short reason","sources":[{"title":"source title","url":"https://...","confidence":0.0-1.0}]}]}

Rules:
- name must be a real named place, museum, neighborhood, market, viewpoint, park, route, or experience in the city.
- Do not use generic names such as "Old Town Core", "Central Market", "Signature Museum", "City Viewpoint", "Riverfront Route", or "Local Neighborhood Walk".
- Include a diverse candidate set, not only the obvious top monuments.
- Give each place 1-2 source URLs that came from actual consulted sources.
- Do not use placeholder domains such as example.com.
- If no source URL is available for a place, use an empty sources array.
- Keep reasons short so the JSON is not truncated.

Traveler profile:
${json(profile)}`
  }),
  run: async (profile, prompt, options) => {
    const fallback = () => localCandidates(profile);
    const payload = await runJsonAgent<{ places?: Partial<CandidatePlace>[] } | Partial<CandidatePlace>[]>(
      prompt!,
      () => ({ places: fallback() }),
      {
        useWebSearch: true,
        webSearchEnabled: profile.webSearchEnabled,
        signal: options?.signal,
        model: selectedModel(profile, "city-research-agent")
      }
    );
    const parsedPlaces = readCandidatePlacesPayload(payload.data);
    const places = parsedPlaces.length > 0 ? parsedPlaces : fallback();
    const normalizedPlaces = places.map((place, index) => normalizeCandidate(place, index, profile.city));
    const usedModelPlaces = parsedPlaces.length > 0 && payload.meta.provider === "openai";

    return {
      output: usedModelPlaces ? attachFallbackSources(normalizedPlaces, payload.sources) : normalizedPlaces,
      meta: payload.meta,
      usage: payload.usage
    };
  }
};

const localRealityAgent: StepRunner<
  { profile: TravelerProfile; candidates: CandidatePlace[] },
  RealityCheckedPlace[]
> = {
  id: "local-reality-agent",
  title: "Local Reality Agent",
  role: "Hours, costs, constraints, and feasibility enrichment",
  prompt: ({ profile, candidates }) => ({
    system:
      "You are a local reality checker. Enrich candidate places with practical constraints, opening windows, best visit windows, transit complexity, and realism scores. Preserve candidate IDs.",
    user: `Enrich each candidate. Return JSON: {"places":[candidate fields plus openingWindow,bestVisitWindow,transitComplexity,constraints,realismScore]}.\n\nProfile:\n${json(profile)}\n\nCandidates:\n${json(candidates)}`
  }),
  run: async ({ profile, candidates }, prompt, options) => {
    const fallback = () => localReality(profile, candidates);
    const payload = await runJsonAgent<{ places: Partial<RealityCheckedPlace>[] }>(
      prompt!,
      () => ({ places: fallback() }),
      {
        useWebSearch: true,
        webSearchEnabled: profile.webSearchEnabled,
        signal: options?.signal,
        model: selectedModel(profile, "local-reality-agent")
      }
    );
    const outputPlaces = Array.isArray(payload.data.places) ? payload.data.places : [];

    return {
      output: candidates.map((candidate, index) => {
        const matched = outputPlaces.find((place) => place.id === candidate.id || place.name === candidate.name);
        return normalizeRealityPlace(matched || {}, candidate, index, profile.city);
      }),
      meta: payload.meta,
      usage: payload.usage
    };
  }
};

const routePlannerAgent: StepRunner<
  { profile: TravelerProfile; places: RealityCheckedPlace[] },
  Itinerary
> = {
  id: "route-planner-agent",
  title: "Route Planner Agent",
  role: "Draft itinerary generation",
  prompt: ({ profile, places }) => ({
    system:
      "You are a route planner agent. Build a realistic day-by-day itinerary that maximizes interest match while minimizing backtracking, budget pressure, and overpacked days.",
    user: `Create an itinerary JSON with keys days, estimatedTotalCost, narrative. Each day must include day, theme, totalCost, totalMinutes, stops. Each stop must include placeId,name,startTime,durationMinutes,cost,transferMinutes,reason.\n\nProfile:\n${json(profile)}\n\nReality checked places:\n${json(places)}`
  }),
  run: async ({ profile, places }, prompt, options) => {
    const fallback = () => localItinerary(profile, places);
    const itinerary = await runJsonAgent<Partial<Itinerary>>(prompt!, fallback, {
      model: selectedModel(profile, "route-planner-agent"),
      signal: options?.signal
    });
    return {
      output: normalizeItinerary(itinerary.data, fallback()),
      meta: itinerary.meta,
      usage: itinerary.usage
    };
  }
};

const validator: StepRunner<{ profile: TravelerProfile; itinerary: Itinerary }, ValidationResult> = {
  id: "hard-validator",
  title: "Hard Validator",
  role: "Budget, time, and structural checks",
  prompt: ({ profile, itinerary }) => ({
    system:
      "Deterministic validator rules: daily cost must fit budget target, total minutes must fit pace target, and every day should contain at least one stop. This step does not call an LLM.",
    user: `Validate itinerary with hard rules.\n\nProfile:\n${json(profile)}\n\nItinerary:\n${json(itinerary)}`
  }),
  run: ({ profile, itinerary }) => validateItinerary(profile, itinerary)
};

const evaluatorAgent: StepRunner<
  { profile: TravelerProfile; itinerary: Itinerary; validation: ValidationResult },
  EvaluationResult
> = {
  id: "evaluator-agent",
  title: "Evaluator Agent",
  role: "LLM critic scoring and repair instructions",
  prompt: ({ profile, itinerary, validation }) => ({
    system:
      "You are a strict itinerary critic. Score the plan from 0-100 across budget, time efficiency, interest match, and realism. Return actionable repair instructions if score is below 82.",
    user: `Evaluate this route. Return JSON with score,budgetScore,timeEfficiencyScore,interestMatchScore,realismScore,issues,repairInstructions.\n\nProfile:\n${json(profile)}\n\nItinerary:\n${json(itinerary)}\n\nHard validation:\n${json(validation)}`
  }),
  run: async ({ profile, itinerary, validation }, prompt, options) => {
    const fallback = () => localEvaluation(profile, itinerary, validation);
    const evaluation = await runJsonAgent<EvaluationResult>(prompt!, fallback, {
      model: selectedModel(profile, "evaluator-agent"),
      signal: options?.signal
    });
    const data = evaluation.data;

    return {
      output: {
        score: Math.max(0, Math.min(100, Number(data.score) || fallback().score)),
        budgetScore: Math.max(0, Math.min(100, Number(data.budgetScore) || fallback().budgetScore)),
        timeEfficiencyScore: Math.max(
          0,
          Math.min(100, Number(data.timeEfficiencyScore) || fallback().timeEfficiencyScore)
        ),
        interestMatchScore: Math.max(
          0,
          Math.min(100, Number(data.interestMatchScore) || fallback().interestMatchScore)
        ),
        realismScore: Math.max(0, Math.min(100, Number(data.realismScore) || fallback().realismScore)),
        issues: Array.isArray(data.issues) ? data.issues.map(String) : fallback().issues,
        repairInstructions: Array.isArray(data.repairInstructions)
          ? data.repairInstructions.map(String)
          : fallback().repairInstructions
      },
      meta: evaluation.meta,
      usage: evaluation.usage
    };
  }
};

const repairAgent: StepRunner<
  { profile: TravelerProfile; itinerary: Itinerary; evaluation: EvaluationResult },
  Itinerary
> = {
  id: "repair-agent",
  title: "Repair Agent",
  role: "Targeted itinerary revision",
  prompt: ({ profile, itinerary, evaluation }) => ({
    system:
      "You are a repair agent. Do not rewrite the whole trip unless necessary. Apply critic instructions while preserving the user's core preferences.",
    user: `Repair this itinerary. Return the same itinerary JSON shape with days, estimatedTotalCost, narrative.\n\nProfile:\n${json(profile)}\n\nCurrent itinerary:\n${json(itinerary)}\n\nCritic evaluation:\n${json(evaluation)}`
  }),
  run: async ({ profile, itinerary, evaluation }, prompt, options) => {
    const fallback = () => localRepair(profile, itinerary, evaluation);
    const repaired = await runJsonAgent<Partial<Itinerary>>(prompt!, fallback, {
      model: selectedModel(profile, "repair-agent"),
      signal: options?.signal
    });
    return {
      output: normalizeItinerary(repaired.data, fallback()),
      meta: repaired.meta,
      usage: repaired.usage
    };
  }
};

const finalItineraryAgent: StepRunner<
  { profile: TravelerProfile; itinerary: Itinerary; evaluation: EvaluationResult },
  Itinerary
> = {
  id: "final-itinerary-agent",
  title: "Final Itinerary Agent",
  role: "User-facing plan packaging",
  prompt: ({ profile, itinerary, evaluation }) => ({
    system:
      "You are the final itinerary packaging agent. Keep the itinerary structure intact and improve the narrative so it is concise, useful, and user-facing.",
    user: `Package this final itinerary. Preserve days and stops. Return itinerary JSON with days, estimatedTotalCost, narrative.\n\nProfile:\n${json(profile)}\n\nItinerary:\n${json(itinerary)}\n\nEvaluation:\n${json(evaluation)}`
  }),
  run: async ({ profile, itinerary, evaluation }, prompt, options) => {
    const fallback = () => ({
      ...itinerary,
      narrative: `Final route for ${profile.city}: ${profile.days} day(s), ${profile.pace} tempo, estimated total cost ${itinerary.estimatedTotalCost}. Evaluation score: ${evaluation.score}/100.`
    });
    const finalItinerary = await runJsonAgent<Partial<Itinerary>>(prompt!, fallback, {
      model: selectedModel(profile, "final-itinerary-agent"),
      signal: options?.signal
    });
    return {
      output: normalizeItinerary(finalItinerary.data, fallback()),
      meta: finalItinerary.meta,
      usage: finalItinerary.usage
    };
  }
};

export async function runTravelPipeline(
  request: TravelRequest,
  onEvent?: PipelineEventHandler,
  options: PipelineRunOptions = {}
): Promise<PipelineResult> {
  const steps: AgentStep[] = [];
  const profile = await runStep(steps, preferenceAgent, request, onEvent, options);
  const candidates = await runStep(steps, cityResearchAgent, profile, onEvent, options);
  const realityChecked = await runStep(steps, localRealityAgent, { profile, candidates }, onEvent, options);

  let itinerary = await runStep(steps, routePlannerAgent, { profile, places: realityChecked }, onEvent, options);
  let validation = await runStep(steps, validator, { profile, itinerary }, onEvent, options);
  let evaluation = await runStep(steps, evaluatorAgent, { profile, itinerary, validation }, onEvent, options);
  let iterations = 1;

  if (evaluation.score < 82) {
    itinerary = await runStep(steps, repairAgent, { profile, itinerary, evaluation }, onEvent, options);
    validation = await runStep(steps, validator, { profile, itinerary }, onEvent, options);
    evaluation = await runStep(steps, evaluatorAgent, { profile, itinerary, validation }, onEvent, options);
    iterations = 2;
  }

  const finalItinerary = await runStep(steps, finalItineraryAgent, {
    profile,
    itinerary,
    evaluation
  }, onEvent, options);

  return {
    request,
    steps,
    finalItinerary,
    evaluation,
    validation,
    iterations
  };
}
