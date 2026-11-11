import {
  mdiChevronRight,
  mdiContentCopy,
  mdiPlay,
  mdiRestart,
  mdiStethoscope,
  mdiStop,
} from "@mdi/js";
import { SUPPORTED_RECIPE_PLATFORMS } from "@omp-toolkit/core/gateway/recipes";
import type { PanelState } from "../ipc";
import { UNKNOWN_GATEWAY_PANEL_VIEW } from "../ipc";
import { icon } from "./icon";

const DRAWER_STORAGE_KEY = "omp.gatewayDrawerOpen";

type LifecycleAction = "start" | "stop" | "restart" | "doctor";

export interface GatewayViewController {
  element: HTMLElement;
  update(state: PanelState): void;
  destroy(): void;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readDrawerOpen(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" && localStorage.getItem(DRAWER_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function writeDrawerOpen(open: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DRAWER_STORAGE_KEY, String(open));
    }
  } catch {
    // headless fallback
  }
}

function actionButton(action: LifecycleAction, glyph: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gw-action-btn";
  button.dataset.action = action;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(icon(glyph));
  return button;
}

export function createGatewayView(
  initialState: PanelState,
  onFeedback: (message: string) => void,
): GatewayViewController {
  const container = el("section", "gateway-container");
  container.setAttribute("aria-label", "Gateway");

  const strip = el("div", "gateway-strip");
  const dot = el("span", "gw-dot");
  dot.setAttribute("aria-hidden", "true");
  strip.appendChild(dot);

  const main = el("div", "gw-main");
  const titleRow = el("div", "gw-title-row");
  titleRow.appendChild(el("span", "gw-name", "GATEWAY"));
  const stateLabel = el("span", "gw-state");
  titleRow.appendChild(stateLabel);
  main.appendChild(titleRow);

  const meta = el("p", "gw-meta");
  main.appendChild(meta);
  strip.appendChild(main);

  const pool = el("div", "gw-pool");
  const poolNum = el("span", "gw-pool-num");
  const poolCap = el("span", "gw-pool-cap");
  pool.appendChild(poolNum);
  pool.appendChild(poolCap);
  strip.appendChild(pool);

  const controls = el("div", "gw-controls");
  const startBtn = actionButton("start", mdiPlay, "Start Gateway");
  const restartBtn = actionButton("restart", mdiRestart, "Restart Gateway");
  const stopBtn = actionButton("stop", mdiStop, "Stop Gateway");
  const doctorBtn = actionButton("doctor", mdiStethoscope, "Run Gateway Doctor");
  controls.appendChild(startBtn);
  controls.appendChild(restartBtn);
  controls.appendChild(stopBtn);
  controls.appendChild(doctorBtn);

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "gw-toggle-btn";
  toggleBtn.appendChild(icon(mdiChevronRight));
  controls.appendChild(toggleBtn);
  strip.appendChild(controls);
  container.appendChild(strip);

  const confirmation = el("div", "gw-confirmation");
  confirmation.hidden = true;
  const confirmationText = el("p", "gw-confirmation-text");
  const confirmationActions = el("div", "gw-confirmation-actions");
  const cancelConfirmBtn = document.createElement("button");
  cancelConfirmBtn.type = "button";
  cancelConfirmBtn.className = "button button-secondary";
  cancelConfirmBtn.textContent = "Cancel";
  const acceptConfirmBtn = document.createElement("button");
  acceptConfirmBtn.type = "button";
  acceptConfirmBtn.className = "button button-primary";
  acceptConfirmBtn.textContent = "Confirm";
  confirmationActions.appendChild(cancelConfirmBtn);
  confirmationActions.appendChild(acceptConfirmBtn);
  confirmation.appendChild(confirmationText);
  confirmation.appendChild(confirmationActions);
  container.appendChild(confirmation);

  const drawer = el("div", "gw-drawer");
  drawer.hidden = true;
  const row1 = el("div", "gw-drawer-row");
  const endpointLabel = el("span", "gw-endpoint-label");
  const copyEndpointBtn = document.createElement("button");
  copyEndpointBtn.type = "button";
  copyEndpointBtn.className = "gw-endpoint-copy";
  copyEndpointBtn.appendChild(icon(mdiContentCopy));
  copyEndpointBtn.appendChild(document.createTextNode("Copy URL"));
  row1.appendChild(endpointLabel);
  row1.appendChild(copyEndpointBtn);
  drawer.appendChild(row1);

  const recipeBar = el("div", "gw-recipe-bar");
  const recipeLabel = document.createElement("label");
  recipeLabel.className = "gw-recipe-label";
  recipeLabel.htmlFor = "gw-recipe-select";
  recipeLabel.textContent = "Connect tool";
  const recipeSelect = document.createElement("select");
  recipeSelect.id = "gw-recipe-select";
  recipeSelect.className = "select-input gw-recipe-select";
  for (const platform of SUPPORTED_RECIPE_PLATFORMS) {
    const option = document.createElement("option");
    option.value = platform;
    option.textContent = platform;
    recipeSelect.appendChild(option);
  }
  const copyRecipeBtn = document.createElement("button");
  copyRecipeBtn.type = "button";
  copyRecipeBtn.className = "gw-recipe-copy-btn";
  copyRecipeBtn.appendChild(icon(mdiContentCopy));
  copyRecipeBtn.appendChild(document.createTextNode("Copy Setup Snippet"));
  recipeBar.appendChild(recipeLabel);
  recipeBar.appendChild(recipeSelect);
  recipeBar.appendChild(copyRecipeBtn);
  const clientRow = el("div", "gw-client-row");
  const clientNameLabel = document.createElement("label");
  clientNameLabel.className = "gw-recipe-label";
  clientNameLabel.htmlFor = "gw-client-name";
  clientNameLabel.textContent = "Client name";
  const clientNameInput = document.createElement("input");
  clientNameInput.id = "gw-client-name";
  clientNameInput.className = "text-input gw-client-name";
  clientNameInput.type = "text";
  clientNameInput.value = recipeSelect.value;
  clientNameInput.placeholder = "Use a separate name per machine, for example omp-pc2.";
  clientNameInput.title = "Use a separate name per machine, for example omp-pc2.";
  clientRow.appendChild(clientNameLabel);
  clientRow.appendChild(clientNameInput);
  drawer.appendChild(clientRow);
  drawer.appendChild(recipeBar);
  container.appendChild(drawer);

  const diagnostic = el("div", "gw-diagnostic");
  diagnostic.hidden = true;
  const diagnosticTitle = el("p", "gw-diagnostic-title", "Latest doctor result");
  const diagnosticOutput = el("pre", "gw-diagnostic-output");
  diagnosticOutput.setAttribute("aria-live", "polite");
  const dismissDiagnosticBtn = document.createElement("button");
  dismissDiagnosticBtn.type = "button";
  dismissDiagnosticBtn.className = "button button-secondary gw-diagnostic-dismiss";
  dismissDiagnosticBtn.textContent = "Dismiss";
  diagnostic.appendChild(diagnosticTitle);
  diagnostic.appendChild(diagnosticOutput);
  diagnostic.appendChild(dismissDiagnosticBtn);
  container.appendChild(diagnostic);

  let currentState = initialState;
  let drawerOpen = readDrawerOpen();
  let pendingAction: LifecycleAction | null = null;
  let recipePending = false;
  let confirmingAction: "stop" | "restart" | null = null;
  let destroyed = false;
  let lastDoctor: { ok: boolean; text: string } | null = null;
  let clientNameTouched = false;
  let cachedSetup: { platform: string; name: string; snippet: string } | null = null;

  const feedback = (message: string) => {
    if (!destroyed) onFeedback(message);
  };

  const syncToggle = () => {
    drawer.hidden = !drawerOpen;
    toggleBtn.title = drawerOpen ? "Collapse gateway details" : "Expand gateway details";
    toggleBtn.setAttribute(
      "aria-label",
      drawerOpen ? "Collapse gateway details" : "Expand gateway details",
    );
    toggleBtn.setAttribute("aria-expanded", String(drawerOpen));
  };

  const openConfirmation = (action: "stop" | "restart") => {
    if (pendingAction || confirmingAction) return;
    confirmingAction = action;
    confirmationText.textContent =
      action === "stop"
        ? "Stop the gateway? Connected clients will lose access until it is started again."
        : "Restart the gateway? Connected requests may be interrupted.";
    confirmation.hidden = false;
    confirmation.classList.add("motion-enter");
    acceptConfirmBtn.textContent = action === "stop" ? "Stop gateway" : "Restart gateway";
    cancelConfirmBtn.focus();
    sync();
  };

  const closeConfirmation = () => {
    confirmingAction = null;
    confirmation.hidden = true;
    confirmation.classList.remove("motion-enter");
    acceptConfirmBtn.textContent = "Confirm";
    sync();
  };

  const runAction = (action: LifecycleAction) => {
    if (pendingAction || recipePending || destroyed) return;
    pendingAction = action;
    confirmingAction = null;
    confirmation.hidden = true;
    confirmation.classList.remove("motion-enter");
    feedback(`Gateway ${action} in progress…`);
    sync();
    void window.omp
      .gatewayAction(action)
      .then((result) => {
        if (destroyed) return;
        if (action === "doctor") {
          lastDoctor = {
            ok: result.success,
            text: result.message === "" ? "(no output)" : result.message,
          };
        }
        feedback(
          result.success
            ? `Gateway ${action} completed`
            : `Gateway ${action} failed: ${result.message}`,
        );
      })
      .catch((error: unknown) => {
        if (destroyed) return;
        if (action === "doctor") {
          const text = error instanceof Error ? error.message : String(error);
          lastDoctor = { ok: false, text: text === "" ? "(no output)" : text };
        }
        feedback(
          `Gateway ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        pendingAction = null;
        if (!destroyed) sync();
      });
  };

  const writeSetupClipboard = (snippet: string, note: string): void => {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      feedback("Clipboard is unavailable.");
      recipePending = false;
      copyRecipeBtn.disabled = pendingAction !== null;
      return;
    }
    void clipboard
      .writeText(snippet)
      .then(() => {
        feedback(note);
      })
      .catch(() => {
        feedback("Could not copy the setup snippet. Retry to use the saved artifact.");
      })
      .finally(() => {
        recipePending = false;
        if (!destroyed) copyRecipeBtn.disabled = pendingAction !== null;
      });
  };

  function sync(): void {
    const gateway = currentState.gateway ?? UNKNOWN_GATEWAY_PANEL_VIEW;
    container.dataset.state = gateway.state;
    container.dataset.access = gateway.access;
    container.setAttribute("aria-label", gateway.label);

    stateLabel.textContent =
      gateway.state === "active"
        ? "Alive"
        : gateway.state === "off"
          ? "Off"
          : gateway.state === "error"
            ? gateway.label.replace("Gateway: ", "")
            : "Not checked";

    if (gateway.state === "active") {
      const parts = [gateway.endpoint];
      if (gateway.modelCount !== null) {
        parts.push(
          gateway.antigravityModelCount !== null
            ? `${gateway.modelCount} models · ${gateway.antigravityModelCount} Antigravity`
            : `${gateway.modelCount} models`,
        );
      }
      if (gateway.clientCount !== null) {
        parts.push(`${gateway.clientCount} client${gateway.clientCount === 1 ? "" : "s"}`);
      }
      parts.push(
        gateway.access === "ok"
          ? "access verified"
          : gateway.access === "denied"
            ? "access denied"
            : gateway.access === "error"
              ? "access unavailable"
              : "access not checked",
      );
      meta.textContent = parts.join(" · ");
    } else if (gateway.state === "off") {
      meta.textContent = "Start it to let gateway clients connect.";
    } else if (gateway.state === "error") {
      meta.textContent = `${gateway.endpoint} · run the doctor for details.`;
    } else {
      meta.textContent = gateway.endpoint;
    }

    const provider = currentState.data?.providers.find((p) => p.id === "google-antigravity");
    const showPool = Boolean(provider) && gateway.state === "active";
    pool.hidden = !showPool;
    if (provider && showPool) {
      poolNum.textContent = `${provider.rows.length}`;
      poolCap.textContent = "usage accounts observed";
      poolCap.className = "gw-pool-cap";
    }

    diagnostic.hidden = lastDoctor === null;
    if (lastDoctor) {
      diagnosticOutput.textContent = lastDoctor.text;
    }

    const showStart = gateway.state === "off" || gateway.state === "error";
    const showStop = gateway.state === "active";
    startBtn.hidden = !showStart;
    restartBtn.hidden = !showStop;
    stopBtn.hidden = !showStop;
    const busy = pendingAction !== null;
    for (const button of [startBtn, restartBtn, stopBtn, doctorBtn]) {
      button.disabled = busy;
    }
    copyEndpointBtn.disabled = busy;
    copyRecipeBtn.disabled = busy || recipePending;
    endpointLabel.textContent = `Endpoint: ${gateway.endpoint}`;
  }

  startBtn.addEventListener("click", () => runAction("start"));
  doctorBtn.addEventListener("click", () => runAction("doctor"));
  restartBtn.addEventListener("click", () => openConfirmation("restart"));
  stopBtn.addEventListener("click", () => openConfirmation("stop"));
  cancelConfirmBtn.addEventListener("click", closeConfirmation);
  acceptConfirmBtn.addEventListener("click", () => {
    if (confirmingAction) runAction(confirmingAction);
  });
  toggleBtn.addEventListener("click", () => {
    drawerOpen = !drawerOpen;
    writeDrawerOpen(drawerOpen);
    syncToggle();
    drawer.classList.toggle("motion-enter", drawerOpen);
  });

  copyEndpointBtn.addEventListener("click", () => {
    const gateway = currentState.gateway ?? UNKNOWN_GATEWAY_PANEL_VIEW;
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      feedback("Clipboard is unavailable.");
      return;
    }
    void clipboard
      .writeText(gateway.endpoint)
      .then(() => feedback("Endpoint copied"))
      .catch(() => feedback("Could not copy the endpoint."));
  });

  copyRecipeBtn.addEventListener("click", () => {
    if (pendingAction || recipePending || destroyed) return;
    const platform = recipeSelect.value;
    const typed = clientNameInput.value.trim();
    const name = typed === "" ? platform : typed;
    if (cachedSetup && cachedSetup.platform === platform && cachedSetup.name === name) {
      writeSetupClipboard(cachedSetup.snippet, "Copied saved setup snippet.");
      return;
    }
    recipePending = true;
    copyRecipeBtn.disabled = true;
    void window.omp
      .gatewayConnect(platform, name)
      .then((result) => {
        if (destroyed) return;
        const snippet = result.recipe?.snippet;
        const token = result.token;
        if (result.success && typeof snippet === "string" && snippet !== "") {
          cachedSetup = { platform, name, snippet };
          writeSetupClipboard(
            snippet,
            `Copied ${result.recipe?.title ?? platform} setup snippet — token shown once; keep it secure.`,
          );
        } else if (
          result.outcome === "applied" &&
          typeof snippet === "string" &&
          snippet !== "" &&
          typeof token === "string" &&
          token !== ""
        ) {
          cachedSetup = { platform, name, snippet };
          writeSetupClipboard(
            snippet,
            `Setup applied with a warning${result.message ? `: ${result.message}` : ""} — token shown once; keep it secure.`,
          );
        } else {
          feedback(result.message || "Failed to generate the setup snippet.");
          recipePending = false;
          copyRecipeBtn.disabled = pendingAction !== null;
        }
      })
      .catch((error: unknown) => {
        if (destroyed) return;
        feedback(
          `Failed to generate the setup snippet: ${error instanceof Error ? error.message : String(error)}`,
        );
        recipePending = false;
        copyRecipeBtn.disabled = pendingAction !== null;
      });
  });

  dismissDiagnosticBtn.addEventListener("click", () => {
    lastDoctor = null;
    sync();
  });

  recipeSelect.addEventListener("change", () => {
    if (!clientNameTouched) clientNameInput.value = recipeSelect.value;
  });

  clientNameInput.addEventListener("input", () => {
    clientNameTouched = true;
  });

  syncToggle();
  sync();

  return {
    element: container,
    update(state: PanelState): void {
      currentState = state;
      sync();
    },
    destroy(): void {
      destroyed = true;
    },
  };
}
