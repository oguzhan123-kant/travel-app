import { runTravelPipeline } from "@/lib/travel/pipeline";
import { parseTravelRequest } from "@/lib/travel/request";
import { PipelineStreamEvent } from "@/lib/travel/types";

function encodeEvent(event: PipelineStreamEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
    parseTravelRequest(body);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Invalid travel request."
      },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const travelRequest = parseTravelRequest(body);
  const abortController = new AbortController();

  request.signal.addEventListener("abort", () => {
    abortController.abort();
  });

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: PipelineStreamEvent) => {
        if (closed) return;

        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          closed = true;
        }
      };

      void runTravelPipeline(travelRequest, send, {
        signal: abortController.signal
      })
        .then((result) => {
          send({ type: "pipeline-complete", result });
        })
        .catch((error) => {
          if (abortController.signal.aborted) {
            return;
          }

          send({
            type: "pipeline-error",
            error: error instanceof Error ? error.message : "Unexpected planning error."
          });
        })
        .finally(() => {
          if (!closed) {
            try {
              controller.close();
            } catch {
              closed = true;
            }
          }
        });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
