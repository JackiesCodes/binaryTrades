import { describe, expect, it } from "vitest";

import { invalidFieldsMessage } from "@/lib/client";

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
