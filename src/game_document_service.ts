import { createServer } from "node:http";
import { z } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { ingestGameDocument, type GameDocument } from "./game_document_ingest.js";

const requestSchema = z.object({
  documentId: z.string().min(1).max(120),
  tenantId: z.string().min(1).max(120),
  kind: z.enum(["player_generated_asset", "live_event", "moderation_queue"]),
  pdf: z.string().min(1),
}).strict();

const port = Number(process.env.PORT ?? 3000);
const collection = process.env.INFRAI_COLLECTION ?? "game-backend-documents";
const client = new InfraiClient();

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/documents/ingest") {
    send(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const buffers: Buffer[] = [];
    for await (const buffer of request) buffers.push(Buffer.from(buffer));
    const input = requestSchema.parse(
      JSON.parse(Buffer.concat(buffers).toString("utf8")),
    ) as GameDocument;
    const receipt = await ingestGameDocument(input, client, collection);
    send(response, 201, receipt);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: "invalid_request" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, detail: error.detail });
      return;
    }
    send(response, 502, { error: "ingest_failed" });
  }
}).listen(port, () => {
  console.log(`game document service listening on http://localhost:${port}`);
});
