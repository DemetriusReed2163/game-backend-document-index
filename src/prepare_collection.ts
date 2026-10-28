import { InfraiClient } from "./infrai_client.js";
import { prepareCollection } from "./game_document_ingest.js";

const collection = process.env.INFRAI_COLLECTION ?? "game-backend-documents";
await prepareCollection(new InfraiClient(), collection);
console.log(JSON.stringify({ collection, state: "ready" }));
