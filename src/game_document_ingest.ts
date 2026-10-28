import { createHash } from "node:crypto";
import type { InfraiClient, ParsedPdf, VectorRecord } from "./infrai_client.js";

export type GameDocumentKind =
  | "player_generated_asset"
  | "live_event"
  | "moderation_queue";

export type GameDocument = {
  documentId: string;
  tenantId: string;
  kind: GameDocumentKind;
  pdf: string;
};

export type IngestDecision = {
  access: "game_ops" | "trust_and_safety";
  containsPlayerData: boolean;
  retentionClass: "operational" | "restricted";
};

export type IngestReceipt = IngestDecision & {
  documentId: string;
  chunksIndexed: number;
  state: "indexed";
};

export interface IngestClient {
  parsePdf(pdf: string): Promise<ParsedPdf>;
  embed(input: string[]): Promise<number[][]>;
  upsert(collection: string, vectors: VectorRecord[], operationId: string): Promise<unknown>;
}

export function decideDocumentHandling(kind: GameDocumentKind): IngestDecision {
  if (kind === "moderation_queue") {
    return {
      access: "trust_and_safety",
      containsPlayerData: true,
      retentionClass: "restricted",
    };
  }
  return {
    access: "game_ops",
    containsPlayerData: kind === "player_generated_asset",
    retentionClass: "operational",
  };
}

function parsedText(parsed: ParsedPdf): string {
  if (parsed.pages?.length) {
    return parsed.pages.map((page) => page.text ?? page.content ?? "").join("\n").trim();
  }
  return (parsed.text ?? parsed.content ?? "").trim();
}

export function chunkDocument(text: string, maxCharacters = 1_200): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxCharacters) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length > maxCharacters) {
      if (current) chunks.push(current);
      current = "";
      for (let offset = 0; offset < paragraph.length; offset += maxCharacters) {
        chunks.push(paragraph.slice(offset, offset + maxCharacters));
      }
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function stableChunkId(documentId: string, index: number, text: string): string {
  return createHash("sha256").update(`${documentId}:${index}:${text}`).digest("hex");
}

export async function ingestGameDocument(
  document: GameDocument,
  client: IngestClient,
  collection: string,
): Promise<IngestReceipt> {
  const decision = decideDocumentHandling(document.kind);
  const parsed = await client.parsePdf(document.pdf);
  const chunks = chunkDocument(parsedText(parsed));
  if (chunks.length === 0) throw new Error("The parsed document contains no indexable text");
  const embeddings = await client.embed(chunks);
  const vectors = chunks.map((text, index): VectorRecord => ({
    id: stableChunkId(document.documentId, index, text),
    embedding: embeddings[index]!,
    metadata: {
      document_id: document.documentId,
      tenant_id: document.tenantId,
      document_kind: document.kind,
      chunk_index: index,
      access: decision.access,
      contains_player_data: decision.containsPlayerData,
      retention_class: decision.retentionClass,
      text,
    },
  }));
  await client.upsert(collection, vectors, `document:${document.documentId}`);
  return { ...decision, documentId: document.documentId, chunksIndexed: chunks.length, state: "indexed" };
}

export async function prepareCollection(client: InfraiClient, collection: string): Promise<void> {
  await client.createCollection(collection, 1536);
}
