import { describe, expect, it } from "vitest";

import { checkScript } from "@/lib/strategies/script";
import { tidyCode } from "@/lib/strategies/tidy-code";

describe("pasting a script", () => {
  it("drops blank lines at the end and spaces at line ends, keeps the code", () => {
    expect(tidyCode("function onBar(i) {\n  return;   \n}\n\n\n   \n\n")).toBe("function onBar(i) {\n  return;\n}\n");
    expect(tidyCode("a\r\nb\rc")).toBe("a\nb\nc\n");
    expect(tidyCode("\tx = 1;")).toBe("  x = 1;\n");
    expect(tidyCode("\n\n  \n")).toBe("");
  });

  it("removes invisible characters that would break the script", async () => {
    // A non-breaking space and a zero-width space, as copied from a chat or web page.
    const pasted = "function onBar(i) {\n  return​ \"buy\";\n}";
    await expect(checkScript(pasted)).rejects.toThrow();
    await expect(checkScript(tidyCode(pasted))).resolves.toBeTruthy();
  });
});
