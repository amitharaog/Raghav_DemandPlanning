// Raghav's documented rules, as numbers. Change a threshold here and only here.

export const RULES = {
  shortWindowWeeks: 4,
  longWindowWeeks: 12,
  /** a. Festival months multiply expected demand before any threshold check. */
  festivalUplift: 1.25,
  /** b. 4-week average more than 20% above the 12-week average. */
  highDemandRatio: 1.2,
  highDemandQtyMultiplier: 1.5,
  /** c. Standard SKUs (weeks of stock). */
  standard: { stockoutBelow: 6, overstockAbove: 14 },
  /** d. High-perishability SKUs (weeks of stock). */
  highPerishability: { stockoutBelow: 3, overstockAbove: 4 },
  /** e. Fewer weeks than this goes to Raghav. */
  minHistoryWeeks: 12,
} as const;
