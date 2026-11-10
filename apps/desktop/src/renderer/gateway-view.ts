import {
  mdiChevronRight,
  mdiContentCopy,
  mdiPlay,
  mdiRestart,
  mdiStethoscope,
  mdiStop,
} from "@mdi/js";
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
  for (const platform of [
    { id: "claude-code", label: "Claude Code" },
    { id: "opencode", label: "OpenCode" },
    { id: "cline", label: "Cline" },
    { id: "cursor", label: "Cursor" },
    { id: "aider", label: "Aider" },
    { id: "curl", label: "curl" },
  ]) {
    const option = document.createElement("option");
    option.value = platform.id;
    option.textContent = platform.label;
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
  drawer.appendChild(recipeBar);
  container.appendChild(drawer);

  let currentState = initialState;
  let drawerOpen = readDrawerOpen();
  let pendingAction: LifecycleAction | null = null;
  let recipePending = false;
  let confirmingAction: "stop" | "restart" | null = null;
  let destroyed = false;

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
    if (pendingAction || destroyed) return;
    pendingAction = action;
    confirmingAction = null;
    confirmation.hidden = true;
    confirmation.classList.remove("motion-enter");
    feedback(`Gateway ${action} in progress…`);
    sync();
    void window.omp
      .gatewayAction(action)
      .then((result) => {
        feedback(
          result.success
            ? `Gateway ${action} completed`
            : `Gateway ${action} failed: ${result.message}`,
        );
      })
      .catch((error: unknown) => {
        feedback(
          `Gateway ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        pendingAction = null;
        sync();
      });
  };

  function sync(): void {
    const gateway = currentState.gateway ?? UNKNOWN_GATEWAY_PANEL_VIEW;
    container.dataset.state = gateway.state;
    container.setAttribute("aria-label", gateway.label);

    stateLabel.textContent =
      gateway.state === "active"
        ? "Active"
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
      const total = provider.rows.length;
      const degraded = provider.rows.filter(
        (row) => typeof row.health === "string" && row.health !== "ok",
      ).length;
      poolNum.textContent = `${total - degraded}/${total}`;
      poolCap.textContent = degraded > 0 ? "accounts · degraded" : "accounts up";
      poolCap.className = degraded > 0 ? "gw-pool-cap gw-pool-warn" : "gw-pool-cap";
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
    endpointLabel.textContent = `Endpoint: http://${gateway.endpoint}`;
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
      .writeText(`http://${gateway.endpoint}`)
      .then(() => feedback("Endpoint copied"))
      .catch(() => feedback("Could not copy the endpoint."));
  });

  copyRecipeBtn.addEventListener("click", () => {
    if (pendingAction || recipePending) return;
    recipePending = true;
    copyRecipeBtn.disabled = true;
    void window.omp
      .gatewayConnect(recipeSelect.value)
      .then((result) => {
        if (result.success && result.recipe?.snippet) {
          const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
          if (clipboard?.writeText) {
            void clipboard
              .writeText(result.recipe.snippet)
              .then(() => feedback(`Copied ${result.recipe?.title} setup snippet`))
              .catch(() => feedback("Could not copy the setup snippet."));
          } else {
            feedback("Clipboard is unavailable.");
          }
        } else {
          feedback(result.message || "Failed to generate the setup snippet.");
        }
      })
      .catch((error: unknown) => {
        feedback(
          `Failed to generate the setup snippet: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        recipePending = false;
        copyRecipeBtn.disabled = pendingAction !== null;
      });
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
