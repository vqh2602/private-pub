import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; subjectId: string }> },
) {
  const { name, subjectId } = await params;
  return registryProxy(
    request,
    `/v1/packages/${encodeURIComponent(name)}/permissions/${encodeURIComponent(subjectId)}`,
    { method: "DELETE" },
  );
}
