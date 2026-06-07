import { type NextRequest, NextResponse } from "next/server";

const API_BASE = process.env["API_URL"] ?? "http://localhost:3001/api/v1";

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
  const url = `${API_BASE}/${path.join("/")}${request.nextUrl.search}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = request.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;

  const hasBody = method !== "GET" && method !== "DELETE";
  const body = hasBody ? await request.text() : null;
  const response = await fetch(url, { method, headers, ...(body !== null ? { body } : {}) });
  const data = await response.text();

  return new NextResponse(data, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}