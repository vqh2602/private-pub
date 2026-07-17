import { NextRequest, NextResponse } from "next/server";

const registryApi = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; version: string }> },
) {
  const { name, version } = await params;
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);

  try {
    const response = await fetch(
      `${registryApi}/api/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}.tar.gz`,
      { headers, cache: "no-store" },
    );
    const outputHeaders = new Headers();
    for (const header of ["content-type", "content-disposition", "content-length"]) {
      const value = response.headers.get(header);
      if (value) outputHeaders.set(header, value);
    }
    return new NextResponse(response.body, { status: response.status, headers: outputHeaders });
  } catch {
    return NextResponse.json(
      { error: "registry_unavailable", message: "The registry API is unavailable." },
      { status: 502 },
    );
  }
}
