import { registryProxy, streamedRegistryRequest } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return registryProxy(
    request,
    "/v1/auth/login",
    streamedRegistryRequest(request, "POST", "application/json"),
  );
}
