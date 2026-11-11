import { type DataSource, defaultMonitorExec, type MonitorExecFn } from "./data";
import type { GatewayActionResult } from "./ipc";

export type GatewayLifecycleAction = "start" | "stop" | "restart" | "doctor";

const ALLOWED_ACTIONS: readonly GatewayLifecycleAction[] = ["start", "stop", "restart", "doctor"];

function capturedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Bounded adapter for gateway lifecycle/doctor actions; reuses the monitor exec seam. */
export async function executeGatewayAction(
  source: DataSource,
  action: string,
  deps: { execFn?: MonitorExecFn } = {},
): Promise<GatewayActionResult> {
  if (!(ALLOWED_ACTIONS as readonly string[]).includes(action)) {
    return { success: false, message: `unknown gateway action: ${action}` };
  }
  const execFn = deps.execFn ?? defaultMonitorExec;
  try {
    const { stdout } = await execFn(source.bun, [source.script, action], { timeoutMs: 60_000 });
    return { success: true, message: String(stdout).trim() };
  } catch (error) {
    const parts =
      error && typeof error === "object"
        ? [
            capturedText((error as { stdout?: unknown }).stdout),
            capturedText((error as { stderr?: unknown }).stderr),
          ].filter((part) => part.length > 0)
        : [];
    if (parts.length > 0) {
      return { success: false, message: parts.join("\n") };
    }
    const fallback = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Gateway ${action} failed with no output (${fallback})` };
  }
}
