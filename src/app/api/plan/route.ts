import { NextResponse } from "next/server";
import { runTravelPipeline } from "@/lib/travel/pipeline";
import { Budget, Pace, TravelRequest } from "@/lib/travel/types";

const budgets: Budget[] = ["low", "medium", "high"];
const paces: Pace[] = ["relaxed", "balanced", "intense"];

function parseRequest(body: unknown): TravelRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  const value = body as Record<string, unknown>;
  const city = String(value.city || "").trim();
  const days = Number(value.days);
  const budget = value.budget as Budget;
  const pace = value.pace as Pace;
  const interests = Array.isArray(value.interests)
    ? value.interests.map(String).map((item) => item.trim()).filter(Boolean)
    : String(value.interests || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  if (!city) throw new Error("City is required.");
  if (!Number.isFinite(days) || days < 1 || days > 7) throw new Error("Days must be between 1 and 7.");
  if (!budgets.includes(budget)) throw new Error("Invalid budget.");
  if (!paces.includes(pace)) throw new Error("Invalid pace.");

  return {
    city,
    days,
    budget,
    pace,
    interests: interests.length > 0 ? interests : ["history", "food", "views"],
    notes: String(value.notes || "")
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const travelRequest = parseRequest(body);
    const result = await runTravelPipeline(travelRequest);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected planning error."
      },
      { status: 400 }
    );
  }
}
