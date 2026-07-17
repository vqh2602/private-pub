import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) { return registryProxy(request, "/v1/tokens"); }

export async function POST(request: NextRequest) {
  return registryProxy(request, "/v1/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: await request.text() });
}
