import "server-only";

import type { NextResponse } from "next/server";

import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";

export async function setSessionCookie(response: NextResponse, version: number): Promise<NextResponse> {
  const { value, maxAge } = await createSessionToken(version);
  response.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/",
  });
  return response;
}
