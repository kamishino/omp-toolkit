// Pure control-plane domain for the gateway app (ADR-0010).
// No I/O: callers fetch facts (processes, HTTP payloads, files) and pass them in.

export const MIN_OMP_VERSION: readonly [number, number, number] = [18, 16, 0];

// ---------------------------------------------------------------- version

export function parseOmpVersion(text: string): [number, number, number] | null {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function versionAtLeast(
  version: readonly [number, number, number],
  floor: readonly [number, number, number],
): boolean {
  for (let i = 0; i < 3; i++) {
    if ((version[i] ?? 0) !== (floor[i] ?? 0)) return (version[i] ?? 0) > (floor[i] ?? 0);
  }
  return true;
}

// ----------------------------------------------------------------- doctor

export type EndpointHealth = "ok" | "down" | "unknown";

export interface DoctorFacts {
  ompPath: string | null;
  versionText: string | null;
  brokerHelp: string | null;
  gatewayHelp: string | null;
  brokerTokenPresent: boolean;
  gatewayTokenPresent: boolean;
  brokerHealth: EndpointHealth;
  gatewayHealth: EndpointHealth;
  /** Full command line of a running auth-gateway serve process, if any. */
  gatewayArgv: string | null;
  expectedGatewayBind: string;
  expectedClientsPath: string;
  requireRunning: boolean;
  /** True when the operator asked for remote access (start --with-tunnel). */
  tunnelRequested: boolean;
  cloudflaredPath: string | null;
  tunnelConfigPath: string;
  tunnelConfigPresent: boolean;
  tunnelHealth: EndpointHealth;
}

export interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export function evaluateDoctorChecks(facts: DoctorFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const pass = (id: string, detail: string) => checks.push({ id, status: "pass", detail });
  const warn = (id: string, detail: string) => checks.push({ id, status: "warn", detail });
  const fail = (id: string, detail: string) => checks.push({ id, status: "fail", detail });

  if (!facts.ompPath) {
    fail("omp-binary", "omp not found on PATH; install Oh My Pi >= 18.16.0 first");
    fail("omp-version", "cannot check version without the omp binary");
    fail("broker-capabilities", "cannot check auth-broker without the omp binary");
    fail("gateway-capabilities", "cannot check auth-gateway without the omp binary");
  } else {
    pass("omp-binary", facts.ompPath);
    const parsed = facts.versionText ? parseOmpVersion(facts.versionText) : null;
    if (!parsed)
      fail("omp-version", `could not parse version from: ${facts.versionText ?? "no output"}`);
    else if (!versionAtLeast(parsed, MIN_OMP_VERSION))
      fail(
        "omp-version",
        `omp ${parsed.join(".")} is below the verified floor ${MIN_OMP_VERSION.join(".")}; upgrade omp`,
      );
    else pass("omp-version", `omp ${parsed.join(".")}`);

    const brokerOk =
      facts.brokerHelp !== null &&
      ["serve", "token", "status", "list"].every((a) => facts.brokerHelp?.includes(a));
    if (brokerOk) pass("broker-capabilities", "auth-broker serve/token/status/list present");
    else
      fail(
        "broker-capabilities",
        "omp auth-broker is missing serve/token/status/list; upgrade omp",
      );

    const gatewayOk =
      facts.gatewayHelp !== null &&
      ["serve", "stdio", "token", "status", "check", "--clients"].every((a) =>
        facts.gatewayHelp?.includes(a),
      );
    if (gatewayOk)
      pass("gateway-capabilities", "auth-gateway serve/token/status/check + --clients present");
    else
      fail(
        "gateway-capabilities",
        "omp auth-gateway is missing serve/token/status/check or --clients; upgrade omp",
      );
  }

  if (facts.brokerTokenPresent && facts.gatewayTokenPresent)
    pass("token-files", "broker and gateway token files are readable (values not shown)");
  else
    fail(
      "token-files",
      `missing token file(s):${facts.brokerTokenPresent ? "" : " auth-broker.token"}${facts.gatewayTokenPresent ? "" : " auth-gateway.token"}; start the broker/gateway once via omp to create them`,
    );

  const healthCheck = (id: string, label: string, state: EndpointHealth) => {
    if (state === "ok") pass(id, `${label} healthy`);
    else if (facts.requireRunning) fail(id, `${label} not reachable; run: gateway:ctl start`);
    else warn(id, `${label} not running; start will launch it`);
  };
  healthCheck("broker-health", "broker", facts.brokerHealth);
  healthCheck("gateway-health", "gateway", facts.gatewayHealth);

  if (!facts.tunnelRequested) {
    pass("tunnel", "remote access not requested; start --with-tunnel to enable it");
  } else if (!facts.cloudflaredPath) {
    fail("tunnel-binary", "cloudflared not found on PATH; install cloudflared first");
    fail("tunnel-config", "cannot check tunnel config without the cloudflared binary");
    fail("tunnel-health", "cannot check tunnel health without the cloudflared binary");
  } else {
    pass("tunnel-binary", facts.cloudflaredPath);
    if (facts.tunnelConfigPresent)
      pass("tunnel-config", `tunnel config present: ${facts.tunnelConfigPath}`);
    else
      fail(
        "tunnel-config",
        `tunnel config missing: ${facts.tunnelConfigPath}; run cloudflared tunnel login, create the tunnel, and write the config first`,
      );
    if (facts.tunnelHealth === "ok") pass("tunnel-health", "tunnel metrics healthy");
    else if (facts.requireRunning)
      fail("tunnel-health", "tunnel not reachable; run: gateway:ctl start --with-tunnel");
    else warn("tunnel-health", "tunnel not running; start --with-tunnel will launch it");
  }

  if (facts.gatewayArgv === null) {
    pass("gateway-argv", "no running gateway process to drift-check");
  } else {
    const argv = normalizePath(facts.gatewayArgv);
    const bindOk = argv.includes(`--bind=${facts.expectedGatewayBind.toLowerCase()}`);
    const clientsOk = argv.includes(`--clients=${normalizePath(facts.expectedClientsPath)}`);
    if (bindOk && clientsOk)
      pass("gateway-argv", "running gateway bind and --clients match the expected deployment");
    else
      fail(
        "gateway-argv",
        `running gateway drift:${bindOk ? "" : ` bind is not ${facts.expectedGatewayBind};`}${clientsOk ? "" : ` --clients does not point at ${facts.expectedClientsPath};`} scoped client tokens will not work until it is restarted by the daemon manager`,
      );
  }

  return checks;
}

export function doctorPassed(checks: readonly DoctorCheck[]): boolean {
  return checks.every((c) => c.status !== "fail");
}
