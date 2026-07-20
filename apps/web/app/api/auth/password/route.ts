import { registryProxy, streamedRegistryRequest } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function PATCH(request: NextRequest) {
  return registryProxy(
    request,
    "/v1/auth/password",
    streamedRegistryRequest(request, "PATCH", "application/json"),
  );
}
