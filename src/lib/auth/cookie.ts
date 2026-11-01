import "server-only";

import type { NextResponse } from "next/server";

import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import type { User } from "@/lib/trading/types";

export async function setSessionCookie(response: NextResponse, user: Pick<User, "id" | "session_version">): Promise<NextResponse> {
  const { value, maxAge } = await createSessionToken(user.id, user.session_version);
  response.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/",
  });
  return response;
}
