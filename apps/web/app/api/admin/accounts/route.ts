import { registryProxy, streamedRegistryRequest } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return registryProxy(request, "/v1/admin/accounts");
}

export async function POST(request: NextRequest) {
  return registryProxy(
    request,
    "/v1/admin/accounts",
    streamedRegistryRequest(request, "POST", "application/json"),
  );
}
