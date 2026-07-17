import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type");
  return registryProxy(request, "/v1/imports/file", {
    method: "POST",
    headers: contentType ? { "content-type": contentType } : undefined,
    body: await request.arrayBuffer()
  });
}
