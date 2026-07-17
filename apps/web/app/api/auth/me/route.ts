import { registryProxy } from "@/lib/registry-proxy";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) { return registryProxy(request, "/v1/auth/me"); }
