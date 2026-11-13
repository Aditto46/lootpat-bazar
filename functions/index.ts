import { createSiteContext, createDatabaseClient, errorResponse } from "./_qoder/backend.mjs";
import { createApplication } from "./app.mjs";

// Application-owned identity: the platform cookie is stripped at the gateway and
// this function neither reads nor trusts platform identity headers.
const handle = createApplication({
  db: createDatabaseClient(),
  origin: () => Deno.env.get("APP_ORIGIN"),
  setupToken: () => Deno.env.get("SETUP_TOKEN"),
  env: () => Deno.env.toObject(),
});

Deno.serve(async (request) => {
  let context;
  try {
    context = createSiteContext(request, { forwardApplicationCredentials: true });
    return await handle(context.request);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
