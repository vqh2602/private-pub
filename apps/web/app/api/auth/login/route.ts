import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return registryProxy(request, "/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: await request.text() });
}
