import { NextRequest, NextResponse } from "next/server";

const registryApi =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

export async function registryProxy(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
) {
  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (
      (origin && !isSameOrigin(request, origin)) ||
      fetchSite === "cross-site"
    )
      return NextResponse.json({ error: "csrf_rejected" }, { status: 403 });
  }
  try {
    const headers = new Headers(init.headers);
    const session = request.cookies.get("private_pub_session")?.value;
    if (session) headers.set("cookie", `private_pub_session=${session}`);
    const response = await fetch(`${registryApi}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(120_000),
    });
    const outputHeaders = new Headers({
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) outputHeaders.set("set-cookie", setCookie);
    if (response.status === 204 || response.status === 304)
      return new NextResponse(null, {
        status: response.status,
        headers: outputHeaders,
      });
    return new NextResponse(response.body, {
      status: response.status,
      headers: outputHeaders,
    });
  } catch {
    return NextResponse.json(
      {
        error: "registry_unavailable",
        message: "The registry API is unavailable.",
      },
      { status: 502 },
    );
  }
}

function isSameOrigin(request: NextRequest, origin: string) {
  try {
    const candidate = new URL(origin);
    if (candidate.origin === request.nextUrl.origin) return true;
    const host = request.headers.get("host");
    if (!host || candidate.host !== host) return false;
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const requestProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : request.nextUrl.protocol;
    return candidate.protocol === requestProtocol;
  } catch {
    return false;
  }
}

export function streamedRegistryRequest(
  request: NextRequest,
  method: string,
  fallbackContentType?: string,
) {
  const contentType =
    request.headers.get("content-type") ?? fallbackContentType;
  return {
    method,
    headers: contentType ? { "content-type": contentType } : undefined,
    body: request.body,
    duplex: "half",
  } as RequestInit;
}
