import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ name: string; version: string; path: string[] }>;
  },
) {
  const { name, version, path } = await params;
  const encodedPath = path.map(encodeURIComponent).join("/");
  return registryProxy(
    request,
    `/v1/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/files/${encodedPath}`,
  );
}
