/**
 * Paging through candle history from a source (Deriv) whose `count` covers time, not candles:
 * hours a market was closed come back empty, so a page is often shorter than asked for. Only an
 * empty page, or one with nothing older, means the history has run out. Shared by the bots
 * (server) and the Markets chart (browser).
 */
export async function pageByTime<T>(
  wanted: number,
  fetchPage: (end: number | "latest", count: number) => Promise<T[]>,
  timeOf: (item: T) => number,
  opts: { maxPages?: number; perRequest?: number; minRequest?: number } = {},
): Promise<T[]> {
  const { maxPages = 12, perRequest = 1000, minRequest = 100 } = opts;
  let items: T[] = [];
  let end: number | "latest" = "latest";
  for (let pages = 0; items.length < wanted && pages < maxPages; pages++) {
    const requested = Math.min(perRequest, Math.max(wanted - items.length, minRequest));
    const page = await fetchPage(end, requested);
    const older = page.filter((c) => !items.length || timeOf(c) < timeOf(items[0]!));
    if (!older.length) break; // no more history
    items = [...older, ...items];
    end = timeOf(older[0]!) - 1;
  }
  return items.slice(-wanted);
}
