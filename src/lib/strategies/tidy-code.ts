// Cleans code pasted into the script editor. Safe for the browser.

/**
 * Line endings to \n, tabs to two spaces, invisible characters out (non-breaking spaces become
 * spaces), no spaces at line ends, and no blank lines at the end (one final newline).
 */
export function tidyCode(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .replace(/\t/g, "  ")
    .split("\n")
    .map((l) => l.replace(/[ ]+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? `${lines.join("\n")}\n` : "";
}
