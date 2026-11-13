import { createSiteContext, createDatabaseClient, errorResponse } from "../functions/_qoder/backend.mjs";
import { createApplication } from "../functions/app.mjs";

// Deno runner for the deployed shape. `npm run dev:function` needs Deno and the
// platform-injected _qoder SDK; the credential-free Node runner lives in
// dev/function-node.mjs and is what `npm run dev:api` uses here.
const handle = createApplication({
  db: createDatabaseClient(),
  origin: () => Deno.env.get("APP_ORIGIN"),
  setupToken: () => Deno.env.get("SETUP_TOKEN"),
  env: () => Deno.env.toObject(),
});

Deno.serve({ hostname: "127.0.0.1", port: 8000 }, async (request) => {
  let context;
  try {
    context = createSiteContext(request, { forwardApplicationCredentials: true });
    return await handle(context.request);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
