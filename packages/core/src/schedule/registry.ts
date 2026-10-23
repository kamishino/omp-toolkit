import { DEEPSEEK_POLICY } from "./deepseek-policy";
import type { TimeWindowPolicy } from "./types";

const registry = new Map<string, TimeWindowPolicy>();

// Initialize with built-in policies
registry.set(DEEPSEEK_POLICY.provider, DEEPSEEK_POLICY);

export function registerTimeWindowPolicy(policy: TimeWindowPolicy): void {
  registry.set(policy.provider, policy);
}

export function getTimeWindowPolicy(provider: string): TimeWindowPolicy | undefined {
  return registry.get(provider);
}

export function getAllTimeWindowPolicies(): TimeWindowPolicy[] {
  return Array.from(registry.values());
}
