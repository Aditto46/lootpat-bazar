import { createSiteContext, createDatabaseClient, errorResponse } from "./_qoder/backend.mjs";
import { createApplication } from "./app.mjs";

const HOST_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d+)?$/i;
const LOOPBACK_PATTERN = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;
const PUBLIC_ORIGIN_HEADER = "x-app-public-origin";

// The gateway forwards the request to an internal address, so the upstream URL is
// not the public origin. APP_ORIGIN wins when configured; otherwise the gateway's
// forwarded host is used. Public sites are served over https even though the
// internal hop is http; loopback hosts keep http for local development.
function resolveOrigin(request: Request): string {
  const configured = Deno.env.get("APP_ORIGIN")?.trim();
  if (configured) return configured;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (forwardedHost && HOST_PATTERN.test(forwardedHost)) {
    const scheme = LOOPBACK_PATTERN.test(forwardedHost) ? "http" : "https";
    return `${scheme}://${forwardedHost.toLowerCase()}`;
  }
  return new URL(request.url).origin;
}

// Application-owned identity: the platform cookie is stripped at the gateway and
// this function neither reads nor trusts platform identity headers. The resolved
// public origin travels with the request in a header this entry point sets
// itself, so the handler never has to infer it from the internal upstream URL.
const handle = createApplication({
  db: createDatabaseClient(),
  origin: (request) => request.headers.get(PUBLIC_ORIGIN_HEADER) ?? resolveOrigin(request),
  setupToken: () => Deno.env.get("SETUP_TOKEN"),
  env: () => Deno.env.toObject(),
});

Deno.serve(async (request) => {
  let context;
  try {
    context = createSiteContext(request, { forwardApplicationCredentials: true });
    const headers = new Headers(context.request.headers);
    headers.set(PUBLIC_ORIGIN_HEADER, resolveOrigin(request));
    const inner = new Request(context.request, { headers });
    if (new URL(request.url).pathname.endsWith("/api/health")) {
      console.log(
        JSON.stringify({
          requestUrl: request.url,
          forwardedHost: request.headers.get("x-forwarded-host"),
          forwardedProto: request.headers.get("x-forwarded-proto"),
          origin: headers.get(PUBLIC_ORIGIN_HEADER),
          innerOrigin: context.request.headers.get("origin"),
        }),
      );
    }
    return await handle(inner);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
