import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return registryProxy(request, `/v1/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}
