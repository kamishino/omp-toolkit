import { money } from "./format";
import type { UsageLimit, UsageReport } from "./types";

export type DeepSeekCurrency = "CNY" | "USD";

export interface DeepSeekBalance {
  currency: DeepSeekCurrency;
  total: number;
  granted: number;
  toppedUp: number;
}

export interface DeepSeekBalancePayload {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
}

function numberValue(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function pickDeepSeekBalance(payload: unknown): DeepSeekBalance | null {
  if (!payload || typeof payload !== "object") return null;
  const infos = (payload as DeepSeekBalancePayload).balance_infos;
  if (!Array.isArray(infos)) return null;

  const parsed: DeepSeekBalance[] = [];
  for (const info of infos) {
    if (!info || typeof info !== "object") continue;
    const currency = String(info.currency ?? "").toUpperCase();
    if (currency !== "CNY" && currency !== "USD") continue;
    const granted = numberValue(info.granted_balance) ?? 0;
    const toppedUp = numberValue(info.topped_up_balance) ?? 0;
    const total = numberValue(info.total_balance) ?? granted + toppedUp;
    if (!Number.isFinite(total)) continue;
    parsed.push({ currency, total, granted, toppedUp });
  }

  return (
    parsed.find((balance) => balance.currency === "CNY") ??
    parsed.find((balance) => balance.currency === "USD") ??
    null
  );
}

export function deepSeekUsageReport(
  payload: unknown,
  fetchedAt = Date.now(),
  account?: { email?: string; accountId?: string },
): UsageReport | null {
  const balance = pickDeepSeekBalance(payload);
  if (!balance) return null;

  const available = (payload as DeepSeekBalancePayload).is_available !== false;
  const unit = balance.currency.toLowerCase();
  const limits: UsageLimit[] = [
    {
      id: "deepseek:balance",
      label: "Balance",
      scope: { provider: "deepseek", windowId: "balance" },
      amount: { remaining: balance.total, unit },
      status: available ? "ok" : "exhausted",
      notes: [money(balance.total, balance.currency)],
    },
    {
      id: "deepseek:granted",
      label: "Granted",
      scope: { provider: "deepseek", windowId: "balance" },
      amount: { remaining: balance.granted, unit },
      status: "ok",
      notes: [money(balance.granted, balance.currency)],
    },
  ];

  const email = account?.email;
  const accountId = account?.accountId ?? (email ? undefined : "api_key");

  return {
    provider: "deepseek",
    fetchedAt,
    limits,
    metadata: {
      email,
      accountId,
      balance: { ...balance, available },
    },
  };
}
