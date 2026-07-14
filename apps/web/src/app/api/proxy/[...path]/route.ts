import { type NextRequest, NextResponse } from "next/server";

const API_BASE = process.env["API_URL"];

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(request, params.path, "GET");
}
export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(request, params.path, "POST");
}
export async function PUT(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(request, params.path, "PUT");
}
export async function PATCH(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(request, params.path, "PATCH");
}
export async function DELETE(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(request, params.path, "DELETE");
}

async function proxyRequest(request: NextRequest, path: string[], method: string) {
  if (!API_BASE) {
    console.error("[proxy] API_URL environment variable is not set");
    return NextResponse.json(
      { status: "error", code: 503, message: "API_URL not configured" },
      { status: 503 },
    );
  }

  const url = `${API_BASE}/${path.join("/")}${request.nextUrl.search}`;
  const headers: Record<string, string> = {};
  const auth = request.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;
  // Impersonación de empresa por superadmin (el backend solo la respeta si el rol lo es).
  const actAs = request.headers.get("x-act-as-tenant");
  if (actAs) headers["x-act-as-tenant"] = actAs;

  const hasBody = method !== "GET" && method !== "DELETE";
  const body = hasBody ? await request.arrayBuffer() : undefined;
  const hasContent = body !== undefined && body.byteLength > 0;
  // Solo se reenvía Content-Type cuando hay cuerpo real (preserva el boundary de
  // multipart). Con cuerpo vacío, Fastify daría 400 (FST_ERR_CTP_EMPTY_JSON_BODY).
  if (hasContent) headers["Content-Type"] = request.headers.get("content-type") ?? "application/json";

  try {
    const response = await fetch(url, { method, headers, ...(hasContent ? { body } : {}) });
    // Reenvía la respuesta tal cual (soporta JSON y binarios como PDF).
    const contentType = response.headers.get("content-type") ?? "application/json";
    const resHeaders: Record<string, string> = { "Content-Type": contentType };
    const disposition = response.headers.get("content-disposition");
    if (disposition) resHeaders["Content-Disposition"] = disposition;
    const buffer = await response.arrayBuffer();
    return new NextResponse(buffer, { status: response.status, headers: resHeaders });
  } catch (err) {
    console.error(`[proxy] Failed to reach upstream ${url}:`, err);
    return NextResponse.json(
      { status: "error", code: 502, message: "Upstream API unreachable" },
      { status: 502 },
    );
  }
}