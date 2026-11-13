import { createSiteContext, createDatabaseClient, errorResponse } from "./_qoder/backend.mjs";
import { createApplication } from "./app.mjs";

// Application-owned identity: the platform cookie is stripped at the gateway and
// this function neither reads nor trusts platform identity headers.
const handle = createApplication({
  db: createDatabaseClient(),
  // APP_ORIGIN wins when set; otherwise the request origin is the site itself.
  origin: (request: Request) =>
    Deno.env.get("APP_ORIGIN") ?? new URL(request.url).origin,
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
