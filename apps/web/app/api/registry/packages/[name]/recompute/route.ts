import { registryProxy, streamedRegistryRequest } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  return registryProxy(
    request,
    "/v1/analyses/recompute",
    streamedRegistryRequest(request, "POST", "application/json"),
  );
}
