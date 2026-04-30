import { NextResponse } from "next/server";
import { runTravelPipeline } from "@/lib/travel/pipeline";
import { parseTravelRequest } from "@/lib/travel/request";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const travelRequest = parseTravelRequest(body);
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
