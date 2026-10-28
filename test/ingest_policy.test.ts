import assert from "node:assert/strict";
import test from "node:test";
import { decideDocumentHandling, ingestGameDocument, type IngestClient } from "../src/game_document_ingest.js";

test("moderation documents are indexed with restricted trust-and-safety metadata", async () => {
  const writes: Parameters<IngestClient["upsert"]>[] = [];
  const client: IngestClient = {
    async parsePdf() {
      return { pages: [{ text: "Player report 42\n\nReview chat evidence before action." }] };
    },
    async embed(input) {
      return input.map(() => [0.25, 0.75]);
    },
    async upsert(...args) {
      writes.push(args);
      return {};
    },
  };

  const receipt = await ingestGameDocument(
    {
      documentId: "moderation-42",
      tenantId: "realm-east",
      kind: "moderation_queue",
      pdf: "https://docs.example/moderation-42.pdf",
    },
    client,
    "game-backend-documents",
  );

  assert.deepEqual(decideDocumentHandling("live_event"), {
    access: "game_ops",
    containsPlayerData: false,
    retentionClass: "operational",
  });
  assert.equal(receipt.access, "trust_and_safety");
  assert.equal(receipt.retentionClass, "restricted");
  assert.equal(receipt.state, "indexed");
  assert.equal(writes[0]?.[1][0]?.metadata.access, "trust_and_safety");
  assert.equal(writes[0]?.[2], "document:moderation-42");
});
