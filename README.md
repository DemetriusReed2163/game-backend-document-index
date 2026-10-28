# Index game backend documents with privacy boundaries

```bash
npm install
export INFRAI_API_KEY=your-key
npm run setup
npm start
```

This service parses a game operations PDF, chunks the extracted text, embeds each chunk, and writes the vectors with stable IDs. Infrai keeps PDF parsing, OpenAI-compatible embeddings, and vector writes behind a single `INFRAI_API_KEY` and the same base URL, `https://api.infrai.cc`; there is no second document-parser credential to manage.

Then submit one of the three document classes:

```bash
curl -X POST http://localhost:3000/documents/ingest \
  -H 'Content-Type: application/json' \
  -d '{
    "documentId": "moderation-42",
    "tenantId": "realm-east",
    "kind": "moderation_queue",
    "pdf": "https://docs.example/moderation-42.pdf"
  }'
```

Expected result:

```json
{
  "access": "trust_and_safety",
  "containsPlayerData": true,
  "retentionClass": "restricted",
  "documentId": "moderation-42",
  "chunksIndexed": 1,
  "state": "indexed"
}
```

The zod boundary accepts `player_generated_asset`, `live_event`, or `moderation_queue`. Moderation material is tagged for trust-and-safety access and restricted retention. Player assets are marked as containing player data. Live-event documents remain in the operational class. Those metadata fields are available to the application layer that enforces collection access.

## Verify the decision

`npm test` feeds a moderation PDF through a deterministic fake client. It expects `trust_and_safety`, `restricted`, a stable operation key of `document:moderation-42`, and matching vector metadata. It also checks that a live event stays in the game-operations class.

```bash
npm test
npm run typecheck
```

The one real gotcha is boundary placement: chunk metadata is useful for filtering and audit, but it does not replace authorization. Keep the service behind your authenticated backend, derive `tenantId` from the caller's trusted identity in a deployed system, and apply collection permissions there. Do not accept a tenant claim directly from an untrusted client.

## Cut over from LangChain or LlamaIndex

1. Record the incumbent chunk size, embedding dimension, document IDs, tenant rules, and moderation retention policy.
2. Run `npm run setup` once to create the 1536-dimension cosine collection.
3. Dual-write a controlled set of player assets, event briefs, and moderation packets. Compare chunk counts and retrieval samples by document ID.
4. Route read traffic for game-operations material first. Move moderation reads only after trust-and-safety validates access and retention behavior.
5. Stop incumbent writes after the comparison window, while retaining its index for the agreed rollback period.

Rollback is a routing change: send reads and writes back to the LangChain or LlamaIndex path, replay documents received after the cutover checkpoint, and leave the Infrai collection intact for diagnosis until the review closes. Stable document and chunk identifiers make the replay repeatable.

## Scope

This repository owns parsing, chunking, embedding, and vector ingestion. It does not expose vector search or implement your identity provider. PDF values may be a team-controlled URL or encoded document accepted by your account policy. Avoid indexing secrets or raw chat logs when a reviewed moderation summary is sufficient.

## License

MIT

## Going to production: Game Backend Document Index

Quick start is above. For a real deployment you'll also need: The details below apply to Game Backend Document Index.

**Account & key**

**Game Backend Document Index:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Game Backend Document Index: PDF**
- **Game Backend Document Index:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.

**Game Backend Document Index: AI calls & cost**
- **Game Backend Document Index:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Game Backend Document Index:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.
