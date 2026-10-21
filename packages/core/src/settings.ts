export interface BalanceAlertThresholds {
  cny: number;
  usd: number;
}

export const DEFAULT_BALANCE_ALERT: BalanceAlertThresholds = {
  cny: 10,
  usd: 10,
};
