import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
  return registryProxy(request, `/v1/admin/accounts/${id}`, {
    method: "DELETE",
  });
}
