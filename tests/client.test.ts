import { afterEach, describe, expect, it } from "vitest";

import { api, invalidFieldsMessage } from "@/lib/client";

describe("invalidFieldsMessage", () => {
  it("names the rejected field and what it accepts", () => {
    expect(invalidFieldsMessage({ risk_percent: ["Number must be less than or equal to 5"] })).toBe(
      "Please check: Risk per trade (%): between 0.1 and 5. For a dollar amount, use Fixed $.",
    );
  });

  it("falls back to the field name and the server's reason", () => {
    expect(invalidFieldsMessage({ widgets: ["Required"] })).toBe("Please check: widgets (Required).");
    expect(invalidFieldsMessage({})).toMatch(/Check the form/);
  });
});

describe("api()", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const answer = (body: string | null, status = 200) => {
    globalThis.fetch = (async () => {
      if (body === null) return { ok: true, status, text: () => Promise.reject(new TypeError("network error")) };
      return new Response(status === 204 ? null : body, { status });
    }) as unknown as typeof fetch;
  };

  it("never hands back a cut-off or non-JSON answer as data (the dashboard would crash on it)", async () => {
    answer('{"settings":{"kill_sw');
    await expect(api("/api/state")).rejects.toThrow(/Couldn't read the server's answer/);
    answer("<html>proxy page</html>");
    await expect(api("/api/state")).rejects.toThrow(/Couldn't read/);
    answer(null);
    await expect(api("/api/state")).rejects.toThrow(/connection dropped/);
  });

  it("still accepts empty answers and real data, and passes on the server's reason", async () => {
    answer("", 204);
    await expect(api("/api/x", "DELETE")).resolves.toEqual({});
    answer('{"ok":true}');
    await expect(api("/api/x")).resolves.toEqual({ ok: true });
    answer('{"error":"BOT_NOT_FOUND"}', 404);
    await expect(api("/api/x")).rejects.toThrow();
  });
});
