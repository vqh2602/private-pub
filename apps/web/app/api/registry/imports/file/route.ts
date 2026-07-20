import { registryProxy, streamedRegistryRequest } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return registryProxy(
    request,
    "/v1/imports/file",
    streamedRegistryRequest(request, "POST"),
  );
}
