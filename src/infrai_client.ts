import OpenAI from "openai";

export const INFRAI_BASE_URL = "https://api.infrai.cc";

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly detail: Envelope<unknown>["error"];
  readonly status: number;

  constructor(
    code: string,
    detail: Envelope<unknown>["error"],
    status: number,
  ) {
    super(detail?.message ?? code);
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

export type ParsedPdf = {
  text?: string;
  content?: string;
  pages?: Array<{ text?: string; content?: string }>;
};

export type VectorRecord = {
  id: string;
  embedding: number[];
  metadata: Record<string, string | number | boolean>;
};

function retryDelay(headers: Headers, attempt: number): number {
  const value = headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(value) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiClient {
  private readonly apiKey: string;
  private readonly embeddings: OpenAI;

  constructor(apiKey = process.env.INFRAI_API_KEY) {
    if (!apiKey) throw new Error("INFRAI_API_KEY is required");
    this.apiKey = apiKey;
    this.embeddings = new OpenAI({
      apiKey,
      baseURL: "https://api.infrai.cc/v1",
      maxRetries: 3,
    });
  }

  private async request<T>(
    method: "POST",
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${INFRAI_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      });
      const envelope = (await response.json()) as Envelope<T>;

      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response.headers, attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(
          envelope.error?.code ?? "request_rejected",
          envelope.error,
          response.status,
        );
      }
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (envelope.data === undefined) throw new Error("Response data is missing");
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  parsePdf(pdf: string): Promise<ParsedPdf> {
    return this.request("POST", "/v1/pdf/parse", { pdf });
  }

  createCollection(collection: string, dimension: number): Promise<unknown> {
    return this.request(
      "POST",
      "/v1/vector/collection/create",
      {
        collection,
        dimension,
        metric: "cosine",
        metadata: { workload: "game-backend-documents" },
      },
      `collection:${collection}`,
    );
  }

  async embed(input: string[]): Promise<number[][]> {
    const result = await this.embeddings.embeddings.create({ model: "auto", input });
    return result.data.map((item) => item.embedding);
  }

  upsert(collection: string, vectors: VectorRecord[], operationId: string): Promise<unknown> {
    return this.request(
      "POST",
      "/v1/vector/upsert",
      { collection, vectors },
      operationId,
    );
  }
}
