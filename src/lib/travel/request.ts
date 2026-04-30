import { Budget, Pace, TravelRequest } from "./types";
import { resolveAgentModels, resolveModel } from "./models";

const budgets: Budget[] = ["low", "medium", "high"];
const paces: Pace[] = ["relaxed", "balanced", "intense"];

export function parseTravelRequest(body: unknown): TravelRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  const value = body as Record<string, unknown>;
  const city = String(value.city || "").trim();
  const days = value.days === undefined ? 3 : Number(value.days);
  const budget = budgets.includes(value.budget as Budget) ? (value.budget as Budget) : "medium";
  const pace = paces.includes(value.pace as Pace) ? (value.pace as Pace) : "balanced";
  const interests = Array.isArray(value.interests)
    ? value.interests.map(String).map((item) => item.trim()).filter(Boolean)
    : String(value.interests || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  if (!city) throw new Error("City is required.");
  if (!Number.isFinite(days) || days < 1 || days > 7) throw new Error("Days must be between 1 and 7.");

  return {
    city,
    days,
    budget,
    pace,
    model: resolveModel(value.model),
    agentModels: resolveAgentModels(value.model, value.agentModels),
    webSearchEnabled: value.webSearchEnabled !== false,
    interests: interests.length > 0 ? interests : ["history", "food", "views"],
    notes: String(value.notes || "")
  };
}
