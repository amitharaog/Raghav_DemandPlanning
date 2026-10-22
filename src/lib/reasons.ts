// Step 4 (second half): plain-English reasons.
//
// Claude writes a 1-2 line reason per recommendation (and a short note for each
// "needs judgment" SKU). It only ever sees the finished rule result: it cannot set
// or change a flag, an action or a quantity. Every reason is checked: if it quotes
// a number that is not in the rule result, it is thrown away and a fixed template
// is used instead. The template path is also used when the LLM is switched off
// (LLM_REASONS=off), has no API key, or errors - so a run never depends on it.

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { RULES } from "./rules-config";
import { ACTION_LABEL, FLAG_LABEL, type Recommendation } from "./rules";
import type { SnapshotSku } from "./snapshot";

export type ReasonSource = "llm" | "template";
export type Reason = { text: string; source: ReasonSource };

export type ReasonsReport = {
  mode: "llm" | "template-only";
  /** Why the run did not (fully) use the LLM, if it didn't. */
  note: string | null;
  model: string | null;
  llmReasons: number;
  rejectedLlmReasons: { skuId: string; text: string; why: string }[];
  /** true when the AI kill switch tripped for this run. */
  killed: boolean;
};

/** If more than this share of LLM reasons fail the check, the whole run falls back to templates. */
export const AI_KILL_INVALID_SHARE = 0.1;
const BATCH_SIZE = 40;

const r1 = (n: number | null) => (n === null ? "n/a" : n.toFixed(1));

export function templateReason(rec: Recommendation, sku: SnapshotSku): string {
  const n = rec.numbers;
  const fest = n.isFestivalMonth ? ` (festival uplift x${RULES.festivalUplift} applied)` : "";
  switch (rec.flag) {
    case "HIGH_DEMAND":
      return (
        `Sales over the last 4 weeks (${r1(n.avg4)}/week) are ${r1((n.ratio4to12! - 1) * 100)}% above the 12-week average ` +
        `(${r1(n.avg12)}/week), so order ${RULES.highDemandQtyMultiplier}x the standard ${n.standardReorderQty}: ${rec.suggestedQty} units.` +
        (rec.alsoFlagged.includes("STOCKOUT") ? ` Stock covers only ${r1(n.weeksOfStock)} weeks${fest}.` : "")
      );
    case "STOCKOUT":
      return (
        `Stock covers only ${r1(n.weeksOfStock)} weeks at ${r1(n.forecastWeekly)} units/week expected demand${fest}, ` +
        `below the ${n.stockoutBelow}-week minimum; reorder the standard ${rec.suggestedQty} units now.`
      );
    case "OVERSTOCK":
      return (
        `Stock covers ${r1(n.weeksOfStock)} weeks at ${r1(n.forecastWeekly)} units/week${fest}, above the ` +
        `${n.overstockAbove}-week maximum${sku.perishability === "High" ? " for a perishable SKU" : ""}; pause the next order.`
      );
    case "OK":
      return `Stock covers ${r1(n.weeksOfStock)} weeks${fest}, inside the ${n.stockoutBelow}-${n.overstockAbove} week range; no order needed.`;
    case "JUDGMENT":
      return `Needs your call: ${rec.judgmentReasons.join("; ")}. Set a quantity or hold.`;
  }
}

/** Every number the reason is allowed to mention for this SKU. */
export function allowedNumbers(rec: Recommendation, sku: SnapshotSku): number[] {
  const n = rec.numbers;
  const out: number[] = [
    RULES.festivalUplift, RULES.highDemandQtyMultiplier, RULES.highDemandRatio, 20, 25, 50,
    RULES.shortWindowWeeks, RULES.longWindowWeeks, RULES.minHistoryWeeks,
    n.stockoutBelow, n.overstockAbove, n.standardReorderQty, n.weeksOfHistory, n.onOrder,
  ];
  for (const v of [n.avg4, n.avg12, n.stockOnHand, n.forecastWeekly, n.weeksOfStock, n.weeksOfStockRaw, n.coverAfterOrder, rec.suggestedQty]) {
    if (v !== null) out.push(v);
  }
  if (n.ratio4to12 !== null) out.push((n.ratio4to12 - 1) * 100, n.ratio4to12);
  if (n.stockOnHand !== null) out.push(n.stockOnHand + n.onOrder);
  for (const w of n.missingWeeks) out.push(...w.split("-W").map(Number));
  for (const m of sku.skuName.matchAll(/\d+(\.\d+)?/g)) out.push(Number(m[0]));
  return out;
}

/** Returns why the reason is unsafe, or null if it is fine. */
export function checkReason(text: string, rec: Recommendation, sku: SnapshotSku): string | null {
  const clean = text.trim();
  if (!clean) return "empty";
  if (clean.length > 400) return "longer than 2 lines";
  const allowed = allowedNumbers(rec, sku);
  const scrubbed = clean.replaceAll(sku.skuId, "");
  for (const m of scrubbed.matchAll(/\d[\d,]*(\.\d+)?/g)) {
    const value = Number(m[0].replaceAll(",", ""));
    const ok = allowed.some((a) => Math.abs(a - value) <= Math.max(0.051, Math.abs(a) * 0.02));
    if (!ok) return `mentions ${m[0]}, which is not in the rule result`;
  }
  return null;
}

const SYSTEM_PROMPT = `You write short reasons for Freshroots' demand planner, Raghav, explaining recommendations that a fixed rules engine has already made.

For each item, write 1-2 plain-English sentences (under 45 words) that explain why the rule result follows from the numbers.

Hard rules:
- The flag, action and suggested quantity are final. Never suggest a different action or quantity, and never invent a quantity.
- Only use numbers that appear in the item. Round to at most 1 decimal place. Do not compute new figures.
- For "Needs Raghav's judgment" items, write a short note saying what is unusual and what Raghav should check before deciding (for example: is this a new launch, did SAP drop weeks, is the sales jump a one-off scheme). Do not recommend a quantity.
- No greetings, no hedging, no markdown.

Return one entry per item, using the item's sku_id.`;

type LlmItem = { sku_id: string; text: string };

function llmPayload(rec: Recommendation, sku: SnapshotSku) {
  const n = rec.numbers;
  const r = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
  return {
    sku_id: rec.skuId,
    sku_name: sku.skuName,
    perishability: sku.perishability,
    flag: FLAG_LABEL[rec.flag],
    also_flagged: rec.alsoFlagged.map((f) => FLAG_LABEL[f]),
    action: ACTION_LABEL[rec.action],
    suggested_qty: rec.suggestedQty,
    rule_fired: rec.ruleFired,
    judgment_reasons: rec.judgmentReasons,
    numbers: {
      avg_weekly_sales_last_4_weeks: r(n.avg4),
      avg_weekly_sales_last_12_weeks: r(n.avg12),
      pct_4wk_vs_12wk: n.ratio4to12 === null ? null : r((n.ratio4to12 - 1) * 100),
      stock_on_hand: n.stockOnHand,
      stock_on_order: n.onOrder,
      festival_month: n.isFestivalMonth,
      expected_weekly_demand: r(n.forecastWeekly),
      weeks_of_stock: r(n.weeksOfStock),
      stockout_below_weeks: n.stockoutBelow,
      overstock_above_weeks: n.overstockAbove,
      standard_reorder_qty: n.standardReorderQty,
      weeks_of_history: n.weeksOfHistory,
      weeks_of_cover_after_order: r(n.coverAfterOrder),
    },
  };
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reasons: {
      type: "array",
      items: {
        type: "object",
        properties: { sku_id: { type: "string" }, text: { type: "string" } },
        required: ["sku_id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["reasons"],
  additionalProperties: false,
} as const;

export type LlmClient = (system: string, userJson: string) => Promise<LlmItem[]>;

export function claudeClient(model: string): LlmClient {
  const client = new Anthropic();
  return async (system, userJson) => {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: jsonSchemaOutputFormat(OUTPUT_SCHEMA) },
      system,
      messages: [{ role: "user", content: userJson }],
    });
    if (response.stop_reason === "refusal") throw new Error("model declined the request");
    if (!response.parsed_output) throw new Error(`no parsable output (stop_reason ${response.stop_reason})`);
    return response.parsed_output.reasons;
  };
}

export async function writeReasons(
  items: { rec: Recommendation; sku: SnapshotSku }[],
  opts: { client?: LlmClient | null; model?: string | null; disabledNote?: string | null } = {},
): Promise<{ reasons: Map<string, Reason>; report: ReasonsReport }> {
  const reasons = new Map<string, Reason>();
  for (const { rec, sku } of items) reasons.set(rec.skuId, { text: templateReason(rec, sku), source: "template" });

  const report: ReasonsReport = {
    mode: "template-only",
    note: opts.disabledNote ?? null,
    model: opts.model ?? null,
    llmReasons: 0,
    rejectedLlmReasons: [],
    killed: false,
  };
  if (!opts.client) return { reasons, report };

  report.mode = "llm";
  const accepted = new Map<string, string>();
  const errors: string[] = [];
  const batches: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));

  await Promise.all(
    batches.map(async (batch) => {
      try {
        const out = await opts.client!(SYSTEM_PROMPT, JSON.stringify({ items: batch.map((b) => llmPayload(b.rec, b.sku)) }));
        const byId = new Map(out.map((o) => [o.sku_id, o.text]));
        for (const { rec, sku } of batch) {
          const text = byId.get(rec.skuId);
          if (text === undefined) {
            report.rejectedLlmReasons.push({ skuId: rec.skuId, text: "", why: "no reason returned" });
            continue;
          }
          const why = checkReason(text, rec, sku);
          if (why) report.rejectedLlmReasons.push({ skuId: rec.skuId, text, why });
          else accepted.set(rec.skuId, text.trim());
        }
      } catch (err) {
        errors.push((err as Error).message);
        for (const { rec } of batch) {
          report.rejectedLlmReasons.push({ skuId: rec.skuId, text: "", why: `LLM call failed: ${(err as Error).message}` });
        }
      }
    }),
  );

  const invalidShare = items.length ? report.rejectedLlmReasons.length / items.length : 0;
  if (invalidShare > AI_KILL_INVALID_SHARE) {
    // AI kill switch: too many bad reasons this run, so don't trust any of them.
    report.killed = true;
    report.mode = "template-only";
    report.note =
      `AI kill switch tripped: ${report.rejectedLlmReasons.length} of ${items.length} LLM reasons failed the check ` +
      `(limit ${AI_KILL_INVALID_SHARE * 100}%). All reasons in this run are templates.` +
      (errors.length ? ` First error: ${errors[0]}` : "");
    return { reasons, report };
  }
  for (const [skuId, text] of accepted) reasons.set(skuId, { text, source: "llm" });
  report.llmReasons = accepted.size;
  if (report.rejectedLlmReasons.length) {
    report.note = `${report.rejectedLlmReasons.length} LLM reason(s) failed the check and were replaced by templates.`;
  }
  return { reasons, report };
}

/** Decides from the environment whether to use Claude for this run. */
export function reasonsClientFromEnv(): { client: LlmClient | null; model: string | null; note: string | null } {
  const model = process.env.CLAUDE_MODEL || "claude-opus-5-5";
  if ((process.env.LLM_REASONS ?? "on").toLowerCase() === "off") {
    return { client: null, model: null, note: "LLM switched off (LLM_REASONS=off): template reasons used." };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { client: null, model: null, note: "No ANTHROPIC_API_KEY set: template reasons used." };
  }
  return { client: claudeClient(model), model, note: null };
}
