import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/users";
import { getDashboardState } from "@/lib/trading/state";

export const dynamic = "force-dynamic";

export const GET = withUser(async (user) => NextResponse.json(await getDashboardState(user)));
