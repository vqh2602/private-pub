import { NextRequest, NextResponse } from "next/server";

const registryApi = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function registryProxy(request: NextRequest, path: string, init: RequestInit = {}) {
  try {
    const headers = new Headers(init.headers);
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${registryApi}${path}`, { ...init, headers, cache: "no-store" });
    const outputHeaders = new Headers({ "content-type": response.headers.get("content-type") ?? "application/json" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) outputHeaders.set("set-cookie", setCookie);
    if (response.status === 204 || response.status === 304) return new NextResponse(null, { status: response.status, headers: outputHeaders });
    return new NextResponse(await response.text(), { status: response.status, headers: outputHeaders });
  } catch {
    return NextResponse.json({ error: "registry_unavailable", message: "The registry API is unavailable." }, { status: 502 });
  }
}
