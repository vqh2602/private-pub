import { registryProxy, streamedRegistryRequest } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  return registryProxy(
    request,
    `/v1/packages/${encodeURIComponent(name)}/permissions`,
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  return registryProxy(
    request,
    `/v1/packages/${encodeURIComponent(name)}/permissions`,
    streamedRegistryRequest(request, "POST", "application/json"),
  );
}
