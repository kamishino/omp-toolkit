import { describe, expect, test } from "bun:test";
import { launchDetached } from "./widget";

describe("detached widget launch", () => {
  test("spawns Electron detached and hidden, unrefs, and resolves on spawn", async () => {
    const calls: Array<{ bin: string; args: string[]; opts: Record<string, unknown> }> = [];
    let unrefCount = 0;
    const handlers = new Map<string, () => void>();

    const fakeChild = {
      on: (event: string, cb: () => void) => {
        handlers.set(event, cb);
        return fakeChild;
      },
      unref: () => {
        unrefCount++;
      },
    };

    const fakeSpawn = ((bin: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ bin, args, opts });
      queueMicrotask(() => handlers.get("spawn")?.());
      return fakeChild;
    }) as never;

    await launchDetached(fakeSpawn, "electron.exe", "C:/app", ["--preview"]);

    expect(calls).toHaveLength(1);
    expect(calls[0].bin).toBe("electron.exe");
    expect(calls[0].args).toEqual(["C:/app", "--preview"]);
    expect(calls[0].opts.detached).toBe(true);
    expect(calls[0].opts.stdio).toBe("ignore");
    expect(calls[0].opts.windowsHide).toBe(true);
    expect(unrefCount).toBe(1);
  });

  test("rejects when the child fails to spawn", async () => {
    const handlers = new Map<string, (err: Error) => void>();
    const fakeChild = {
      on: (event: string, cb: (err: Error) => void) => {
        handlers.set(event, cb);
        return fakeChild;
      },
      unref: () => {},
    };
    const fakeSpawn = (() => {
      queueMicrotask(() => handlers.get("error")?.(new Error("spawn ENOENT")));
      return fakeChild;
    }) as never;

    await expect(launchDetached(fakeSpawn, "missing.exe", "C:/app", [])).rejects.toThrow("ENOENT");
  });
});
