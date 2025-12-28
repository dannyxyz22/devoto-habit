/**
 * Utility functions for percentage calculations
 * Following DRY principle to avoid code duplication
 */

/**
 * Calculate percentage from a ratio (part/total)
 * @param part - The part value
 * @param total - The total value
 * @param options - Optional configuration
 * @returns Percentage value (0-100)
 */
export function calculatePercent(
  part: number,
  total: number,
  options: {
    min?: number;
    max?: number;
    round?: boolean;
  } = {}
): number {
  const { min = 0, max = 100, round = true } = options;

  if (total === 0 || total < 0) return min;
  if (part < 0) return min;

  const percent = (part / total) * 100;
  const clamped = Math.max(min, Math.min(max, percent));

  return round ? Math.round(clamped) : clamped;
}

/**
 * Calculate percentage for physical books (pages)
 * @param currentPage - Current page number
 * @param totalPages - Total pages in the book
 * @returns Percentage (0-100)
 */
export function calculatePagePercent(currentPage: number, totalPages: number, options: { round?: boolean } = {}): number {
  return calculatePercent(currentPage, totalPages, options);
}

/**
 * Calculate percentage for word-based books
 * @param wordsUpToCurrent - Words read up to current position
 * @param totalWords - Total words in the book
 * @returns Percentage (0-100)
 */
export function calculateWordPercent(
  wordsUpToCurrent: number,
  totalWords: number,
  options: { round?: boolean } = {}
): number {
  return calculatePercent(wordsUpToCurrent, Math.max(1, totalWords), options);
}

/**
 * Convert percentage to pages
 * @param percent - Percentage value (0-100)
 * @param totalPages - Total pages in the book
 * @param round - Whether to round the result (default: true)
 * @returns Number of pages
 */
export function percentToPages(
  percent: number,
  totalPages: number,
  round: boolean = true
): number {
  if (round) {
    return Math.round((percent / 100) * totalPages);
  }
  return (percent / 100) * totalPages;
}

/**
 * Convert percentage to pages (always round up)
 * @param percent - Percentage value (0-100)
 * @param totalPages - Total pages in the book
 * @returns Number of pages (rounded up)
 */
export function percentToPagesCeil(percent: number, totalPages: number): number {
  return Math.ceil((percent / 100) * totalPages);
}

/**
 * Convert pages to percentage
 * @param pages - Number of pages
 * @param totalPages - Total pages in the book
 * @returns Percentage (0-100)
 */
export function pagesToPercent(pages: number, totalPages: number): number {
  return calculatePagePercent(pages, totalPages);
}

/**
 * Calculate progress percentage (achieved / target)
 * @param achieved - Achieved value
 * @param target - Target value
 * @returns Percentage (0-100) or null if target is invalid
 */
export function calculateProgressPercent(
  achieved: number,
  target: number | null,
  options: { round?: boolean } = {}
): number | null {
  if (!target || target <= 0) return null;
  return calculatePercent(achieved, target, options);
}

/**
 * Calculate percentage from ratio with custom denominator
 * Used for plan progress calculations
 * @param numerator - Numerator value
 * @param denominator - Denominator value
 * @returns Percentage (0-100)
 */
export function calculateRatioPercent(
  numerator: number,
  denominator: number,
  options: { round?: boolean } = {}
): number {
  const denom = Math.max(1, denominator);
  const num = Math.max(0, numerator);
  return calculatePercent(num, denom, options);
}
