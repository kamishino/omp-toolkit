import { OMP_VERSION_CHECKPOINT, type OmpBuildView, type PanelState } from "../ipc";

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(label: string, value: string, valueClass?: string): HTMLElement {
  const row = document.createElement("p");
  row.className = "provider-access-field";
  const key = document.createElement("span");
  key.className = "provider-access-label";
  key.textContent = `${label}: `;
  const val = document.createElement("span");
  if (valueClass) val.className = valueClass;
  val.textContent = value;
  row.appendChild(key);
  row.appendChild(val);
  return row;
}

function step(parts: Array<string | { code: string }>): HTMLElement {
  const item = document.createElement("li");
  for (const part of parts) {
    if (typeof part === "string") {
      item.appendChild(document.createTextNode(part));
    } else {
      const code = document.createElement("code");
      code.textContent = part.code;
      item.appendChild(code);
    }
  }
  return item;
}

export function providerAccessSummary(build?: OmpBuildView): string {
  if (!build) return "Provider access details are unavailable for this OMP build.";
  return build.builtInAntigravityPolicy === "documented-pause"
    ? "Antigravity: built-in OMP safety pause (Google-account restriction risk)."
    : "Antigravity policy is unverified for this OMP build.";
}

function buildBody(build: OmpBuildView): HTMLElement {
  const body = el("div", "provider-access-body");

  const comparisonText =
    build.comparison === "same"
      ? "Same as checkpoint"
      : build.comparison === "changed"
        ? "Changed since checkpoint"
        : "Cannot compare";

  const version = build.version ?? "Unavailable";
  const sha256 = build.sha256 ?? "Unavailable";

  body.appendChild(
    el(
      "p",
      "provider-access-lead",
      "This is OMP's built-in default for the recorded reference, not an inspection of extension overrides, credential validity, or effective session access.",
    ),
  );

  body.appendChild(el("h3", "provider-access-heading", "Recorded provider policy"));
  if (build.builtInAntigravityPolicy === "documented-pause") {
    body.appendChild(field("State", "Paused by this OMP build"));
    body.appendChild(el("p", "provider-access-reason", OMP_VERSION_CHECKPOINT.reason));
  } else {
    body.appendChild(field("State", "Unverified for this OMP build"));
    body.appendChild(
      el(
        "p",
        "provider-access-reason",
        `Recorded ${OMP_VERSION_CHECKPOINT.version} reason: ${OMP_VERSION_CHECKPOINT.reason}`,
      ),
    );
  }
  body.appendChild(field("Reference", OMP_VERSION_CHECKPOINT.policyUrl));

  body.appendChild(el("h3", "provider-access-heading", "OMP build comparison"));
  body.appendChild(field("Current version", version));
  body.appendChild(field("Checkpoint version", OMP_VERSION_CHECKPOINT.version));
  body.appendChild(field("Current SHA-256", sha256, "provider-access-sha"));
  body.appendChild(
    field("Checkpoint SHA-256", OMP_VERSION_CHECKPOINT.sha256, "provider-access-sha"),
  );
  body.appendChild(field("Captured", `${OMP_VERSION_CHECKPOINT.capturedAt} (UTC)`));
  body.appendChild(field("Comparison", comparisonText));
  if (build.inspectionError) {
    body.appendChild(el("p", "provider-access-error", build.inspectionError));
  }

  body.appendChild(el("h3", "provider-access-heading", "Gemini route status"));
  body.appendChild(
    el(
      "p",
      "provider-access-text",
      "Gemini CLI (google-gemini-cli) is a separate provider and is not paused by this Antigravity rule.",
    ),
  );
  body.appendChild(
    el(
      "p",
      "provider-access-text",
      `Toolkit health checks: ${build.healthProbesEnabled ? "enabled" : "paused"}. GEMINI_HEALTH_ENABLED=1 neither enables the provider nor is required for Gemini CLI.`,
    ),
  );

  body.appendChild(el("h3", "provider-access-heading", "Supported route: Gemini CLI (manual)"));
  body.appendChild(
    el(
      "p",
      "provider-access-warning",
      "Gemini CLI is a distinct Google service and provider with separate account eligibility and quota. Google terms and any plan-specific charges apply; OMP support does not promise access or immunity from restrictions. Native login opens a browser, stores credentials in the selected profile or store, and can refresh the model catalog online. This panel performs none of those actions.",
    ),
  );
  const steps = document.createElement("ol");
  steps.className = "provider-access-steps";
  steps.appendChild(
    step([
      "In the OMP session or profile intended for use, run ",
      { code: "/login google-gemini-cli" },
      "; alternatively use ",
      { code: "omp login google-gemini-cli" },
      " from a terminal with the intended profile.",
    ]),
  );
  steps.appendChild(
    step([
      "Complete OMP's native browser consent flow. Do not route it through this widget or copy tokens. Cloud Code Assist project eligibility is account-dependent; if the OAuth callback cannot bind, port 8085 must be available.",
    ]),
  );
  steps.appendChild(
    step([
      "Open ",
      { code: "/model" },
      " or ",
      { code: "/models" },
      " and choose an available entry whose provider is ",
      { code: "google-gemini-cli" },
      ". Do not hardcode an Antigravity model ID or assume a particular roster.",
    ]),
  );
  body.appendChild(steps);

  body.appendChild(el("h3", "provider-access-heading", "Not implemented here"));
  body.appendChild(
    el(
      "p",
      "provider-access-text",
      "Custom models under paused google-antigravity stay blocked; renaming is not equivalent transport or protection. Removing the source rule and rebuilding, or overriding with a same-ID extension OAuth registration, are possible technical opt-outs but retain the original account risk. This panel only explains the supported Gemini CLI route.",
    ),
  );

  return body;
}

export function buildProviderAccessSection(
  state: PanelState,
  expanded: boolean,
  onExpandedChange: (expanded: boolean) => void,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "provider-access";

  const heading = document.createElement("h2");
  heading.id = "provider-access-heading";
  heading.className = "provider-access-title";
  heading.tabIndex = -1;
  heading.textContent = "Provider access";
  section.appendChild(heading);

  const summaryLine = el("p", "provider-access-summary", providerAccessSummary(state.ompBuild));
  section.appendChild(summaryLine);

  const build = state.ompBuild;
  if (!build) {
    section.appendChild(
      el(
        "p",
        "provider-access-text",
        "Build identity and provider-policy details are not available in this session.",
      ),
    );
    return section;
  }

  const details = document.createElement("details");
  details.className = "provider-access-details";
  details.open = expanded;

  const summary = document.createElement("summary");
  summary.className = "provider-access-toggle";
  summary.textContent = "Policy, build, and setup details";
  const body = buildBody(build);
  let wasOpen = details.open;
  details.addEventListener("toggle", () => {
    if (details.open && !wasOpen) {
      body.classList.add("motion-enter");
    } else if (!details.open) {
      body.classList.remove("motion-enter");
    }
    wasOpen = details.open;
    onExpandedChange(details.open);
  });

  details.appendChild(summary);
  details.appendChild(body);
  section.appendChild(details);
  return section;
}
