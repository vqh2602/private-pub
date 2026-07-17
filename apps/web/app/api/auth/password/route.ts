import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function PATCH(request: NextRequest) {
  return registryProxy(request, "/v1/auth/password", { method: "PATCH", headers: { "content-type": "application/json" }, body: await request.text() });
}
