import {
  AgentStep,
  Budget,
  CandidatePlace,
  EvaluationResult,
  Itinerary,
  ItineraryDay,
  ItineraryStop,
  Pace,
  PipelineResult,
  RealityCheckedPlace,
  TravelRequest,
  TravelerProfile,
  ValidationResult
} from "./types";
import { getSeedPlaces } from "./mock-data";

type StepRunner<TInput, TOutput> = {
  id: string;
  title: string;
  role: string;
  run: (input: TInput) => Promise<TOutput> | TOutput;
};

const nowIso = () => new Date().toISOString();

async function runStep<TInput, TOutput>(
  steps: AgentStep[],
  runner: StepRunner<TInput, TOutput>,
  input: TInput
): Promise<TOutput> {
  const started = performance.now();
  const startedAt = nowIso();

  try {
    const output = await runner.run(input);
    const durationMs = Math.round(performance.now() - started);

    steps.push({
      id: runner.id,
      title: runner.title,
      role: runner.role,
      status: "complete",
      startedAt,
      finishedAt: nowIso(),
      durationMs,
      input,
      output
    });

    return output;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    steps.push({
      id: runner.id,
      title: runner.title,
      role: runner.role,
      status: "failed",
      startedAt,
      finishedAt: nowIso(),
      durationMs,
      input,
      output: {
        message: error instanceof Error ? error.message : "Unknown pipeline error"
      }
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

const preferenceAgent: StepRunner<TravelRequest, TravelerProfile> = {
  id: "preference-agent",
  title: "Preference Agent",
  role: "User intent normalization",
  run: (request) => {
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
      interests: request.interests,
      avoid,
      dailyTimeBudgetHours: paceConfig[request.pace].hours,
      maxStopsPerDay: paceConfig[request.pace].stops
    };
  }
};

const cityResearchAgent: StepRunner<TravelerProfile, CandidatePlace[]> = {
  id: "city-research-agent",
  title: "City Research Agent",
  role: "Web-search style POI discovery",
  run: (profile) => {
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
};

const localRealityAgent: StepRunner<
  { profile: TravelerProfile; candidates: CandidatePlace[] },
  RealityCheckedPlace[]
> = {
  id: "local-reality-agent",
  title: "Local Reality Agent",
  role: "Hours, costs, constraints, and feasibility enrichment",
  run: ({ profile, candidates }) => {
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
};

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

const routePlannerAgent: StepRunner<
  { profile: TravelerProfile; places: RealityCheckedPlace[] },
  Itinerary
> = {
  id: "route-planner-agent",
  title: "Route Planner Agent",
  role: "Draft itinerary generation",
  run: ({ profile, places }) => {
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
          reason: `${place.whyVisit} Matched tags: ${place.tags
            .filter((tag) => profile.interests.includes(tag))
            .join(", ") || "general city priority"}.`
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
};

const validator: StepRunner<{ profile: TravelerProfile; itinerary: Itinerary }, ValidationResult> = {
  id: "hard-validator",
  title: "Hard Validator",
  role: "Budget, time, and structural checks",
  run: ({ profile, itinerary }) => {
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
};

const evaluatorAgent: StepRunner<
  { profile: TravelerProfile; itinerary: Itinerary; validation: ValidationResult },
  EvaluationResult
> = {
  id: "evaluator-agent",
  title: "Evaluator Agent",
  role: "LLM critic scoring and repair instructions",
  run: ({ profile, itinerary, validation }) => {
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
};

const repairAgent: StepRunner<
  { profile: TravelerProfile; itinerary: Itinerary; evaluation: EvaluationResult },
  Itinerary
> = {
  id: "repair-agent",
  title: "Repair Agent",
  role: "Targeted itinerary revision",
  run: ({ profile, itinerary, evaluation }) => {
    if (evaluation.score >= 82) return itinerary;

    const dailyBudget = budgetLimit[profile.budget];
    const repairedDays = itinerary.days.map((day) => {
      const trimmedStops = [...day.stops]
        .sort((a, b) => a.cost - b.cost)
        .slice(0, Math.max(2, profile.maxStopsPerDay - 1))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      const totalCost = trimmedStops.reduce((sum, stop) => sum + stop.cost, 0);
      const withinBudgetStops =
        totalCost <= dailyBudget
          ? trimmedStops
          : trimmedStops.filter((stop) => stop.cost <= dailyBudget * 0.4);

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
};

const finalItineraryAgent: StepRunner<
  { profile: TravelerProfile; itinerary: Itinerary; evaluation: EvaluationResult },
  Itinerary
> = {
  id: "final-itinerary-agent",
  title: "Final Itinerary Agent",
  role: "User-facing plan packaging",
  run: ({ profile, itinerary, evaluation }) => ({
    ...itinerary,
    narrative: `Final route for ${profile.city}: ${profile.days} day(s), ${profile.pace} tempo, estimated total cost ${itinerary.estimatedTotalCost}. Evaluation score: ${evaluation.score}/100.`
  })
};

export async function runTravelPipeline(request: TravelRequest): Promise<PipelineResult> {
  const steps: AgentStep[] = [];
  const profile = await runStep(steps, preferenceAgent, request);
  const candidates = await runStep(steps, cityResearchAgent, profile);
  const realityChecked = await runStep(steps, localRealityAgent, { profile, candidates });

  let itinerary = await runStep(steps, routePlannerAgent, { profile, places: realityChecked });
  let validation = await runStep(steps, validator, { profile, itinerary });
  let evaluation = await runStep(steps, evaluatorAgent, { profile, itinerary, validation });
  let iterations = 1;

  if (evaluation.score < 82) {
    itinerary = await runStep(steps, repairAgent, { profile, itinerary, evaluation });
    validation = await runStep(steps, validator, { profile, itinerary });
    evaluation = await runStep(steps, evaluatorAgent, { profile, itinerary, validation });
    iterations = 2;
  }

  const finalItinerary = await runStep(steps, finalItineraryAgent, {
    profile,
    itinerary,
    evaluation
  });

  return {
    request,
    steps,
    finalItinerary,
    evaluation,
    validation,
    iterations
  };
}
