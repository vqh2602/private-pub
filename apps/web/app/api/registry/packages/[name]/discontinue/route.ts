import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  return registryProxy(
    request,
    `/v1/packages/${encodeURIComponent(name)}/discontinue`,
    { method: "POST" },
  );
}
