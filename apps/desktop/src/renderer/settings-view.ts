import type { DesktopSettings, DesktopTheme } from "../settings";
import { MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, validateDesktopSettings } from "../settings";
import { applyThemePreference } from "./tokens";

export interface SettingsViewController {
  element: HTMLElement;
  destroy(): void;
}

function buildCurrencyField(
  label: string,
  id: string,
  unit: string,
  value: number,
): { group: HTMLElement; input: HTMLInputElement } {
  const group = document.createElement("div");
  group.className = "form-group";
  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  labelEl.htmlFor = id;

  const wrapper = document.createElement("div");
  wrapper.className = "input-with-unit";
  const input = document.createElement("input");
  input.id = id;
  input.type = "number";
  input.min = "0";
  input.step = "1";
  input.value = String(value);
  const unitEl = document.createElement("span");
  unitEl.className = "unit-suffix";
  unitEl.textContent = unit;
  wrapper.appendChild(unitEl);
  wrapper.appendChild(input);

  group.appendChild(labelEl);
  group.appendChild(wrapper);
  return { group, input };
}

function buildBalanceSection(draft: DesktopSettings): {
  section: HTMLElement;
  cnyInput: HTMLInputElement;
  usdInput: HTMLInputElement;
} {
  const section = document.createElement("fieldset");
  section.className = "settings-section";

  const legend = document.createElement("legend");
  legend.textContent = "Low-Balance Alerts";
  section.appendChild(legend);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Show a red LOW indicator when provider balance falls to or below:";
  section.appendChild(help);

  const grid = document.createElement("div");
  grid.className = "form-grid-2";
  const cny = buildCurrencyField("Chinese Yuan (CNY)", "setting-cny", "¥", draft.balanceAlert.cny);
  const usd = buildCurrencyField("US Dollar (USD)", "setting-usd", "$", draft.balanceAlert.usd);
  grid.appendChild(cny.group);
  grid.appendChild(usd.group);
  section.appendChild(grid);

  return { section, cnyInput: cny.input, usdInput: usd.input };
}

function buildSystemSection(draft: DesktopSettings): {
  section: HTMLElement;
  toggleInput: HTMLInputElement;
} {
  const section = document.createElement("fieldset");
  section.className = "settings-section";

  const legend = document.createElement("legend");
  legend.textContent = "System";
  section.appendChild(legend);

  const toggleWrapper = document.createElement("label");
  toggleWrapper.className = "toggle-row";
  toggleWrapper.htmlFor = "setting-login";

  const toggleText = document.createElement("div");
  toggleText.className = "toggle-text";
  const toggleTitle = document.createElement("span");
  toggleTitle.className = "toggle-title";
  toggleTitle.textContent = "Start at login";
  const toggleDesc = document.createElement("span");
  toggleDesc.className = "form-help";
  toggleDesc.textContent = "Launch the widget automatically when signing in to OS";
  toggleText.appendChild(toggleTitle);
  toggleText.appendChild(toggleDesc);

  const toggleInput = document.createElement("input");
  toggleInput.id = "setting-login";
  toggleInput.type = "checkbox";
  toggleInput.className = "toggle-checkbox";
  toggleInput.checked = draft.openAtLogin;
  toggleInput.addEventListener("change", () => {
    draft.openAtLogin = toggleInput.checked;
  });

  const toggleTrack = document.createElement("span");
  toggleTrack.className = "toggle-track";
  const toggleThumb = document.createElement("span");
  toggleThumb.className = "toggle-thumb";
  toggleTrack.appendChild(toggleThumb);

  toggleWrapper.appendChild(toggleText);
  toggleWrapper.appendChild(toggleInput);
  toggleWrapper.appendChild(toggleTrack);
  section.appendChild(toggleWrapper);

  return { section, toggleInput };
}

export function renderSettingsView(
  initialSettings: DesktopSettings,
  onSave: (settings: DesktopSettings) => void,
  onCancel: () => void,
): SettingsViewController {
  const container = document.createElement("div");
  container.className = "settings-view";

  const titleRow = document.createElement("div");
  titleRow.className = "settings-header-row";

  const title = document.createElement("h2");
  title.className = "settings-title";
  title.textContent = "Settings";
  titleRow.appendChild(title);

  const escHint = document.createElement("span");
  escHint.className = "esc-hint";
  escHint.textContent = "Esc to cancel";
  titleRow.appendChild(escHint);

  container.appendChild(titleRow);

  const form = document.createElement("form");
  form.className = "settings-form";

  // State draft
  const draft: DesktopSettings = {
    intervalSeconds: initialSettings.intervalSeconds,
    balanceAlert: {
      cny: initialSettings.balanceAlert.cny,
      usd: initialSettings.balanceAlert.usd,
    },
    theme: initialSettings.theme,
    openAtLogin: initialSettings.openAtLogin,
  };

  // ── Section 1: Display & Timing ───────────────────────────────────
  const timingSection = document.createElement("fieldset");
  timingSection.className = "settings-section";

  const timingLegend = document.createElement("legend");
  timingLegend.textContent = "Timing & Appearance";
  timingSection.appendChild(timingLegend);

  // Interval
  const intervalGroup = document.createElement("div");
  intervalGroup.className = "form-group";
  const intervalLabel = document.createElement("label");
  intervalLabel.textContent = "Refresh Interval";
  intervalLabel.htmlFor = "setting-interval";

  const intervalInputWrapper = document.createElement("div");
  intervalInputWrapper.className = "input-with-unit";

  const intervalInput = document.createElement("input");
  intervalInput.id = "setting-interval";
  intervalInput.type = "number";
  intervalInput.min = String(MIN_INTERVAL_SECONDS);
  intervalInput.max = String(MAX_INTERVAL_SECONDS);
  intervalInput.value = String(draft.intervalSeconds);

  const intervalUnit = document.createElement("span");
  intervalUnit.className = "unit-suffix";
  intervalUnit.textContent = "seconds";

  intervalInputWrapper.appendChild(intervalInput);
  intervalInputWrapper.appendChild(intervalUnit);

  const intervalHelp = document.createElement("span");
  intervalHelp.className = "form-help";
  intervalHelp.textContent = `Auto-refresh frequency (${MIN_INTERVAL_SECONDS}s – ${MAX_INTERVAL_SECONDS}s, default: 300s)`;

  intervalGroup.appendChild(intervalLabel);
  intervalGroup.appendChild(intervalInputWrapper);
  intervalGroup.appendChild(intervalHelp);
  timingSection.appendChild(intervalGroup);

  // Theme Segmented Control
  const themeGroup = document.createElement("div");
  themeGroup.className = "form-group";
  const themeLabel = document.createElement("label");
  themeLabel.textContent = "Theme";
  themeGroup.appendChild(themeLabel);

  const segmented = document.createElement("div");
  segmented.className = "segmented-control";
  segmented.setAttribute("role", "radiogroup");
  segmented.setAttribute("aria-label", "Theme preference");

  const themes: Array<{ value: DesktopTheme; label: string }> = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  const themeButtons: HTMLButtonElement[] = [];

  for (const t of themes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `segmented-item${t.value === draft.theme ? " active" : ""}`;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(t.value === draft.theme));
    btn.textContent = t.label;

    btn.addEventListener("click", () => {
      draft.theme = t.value;
      for (const b of themeButtons) {
        b.className = "segmented-item";
        b.setAttribute("aria-checked", "false");
      }
      btn.className = "segmented-item active";
      btn.setAttribute("aria-checked", "true");
      applyThemePreference(draft.theme);
    });

    themeButtons.push(btn);
    segmented.appendChild(btn);
  }

  themeGroup.appendChild(segmented);
  timingSection.appendChild(themeGroup);
  form.appendChild(timingSection);

  const { section: balanceSection, cnyInput, usdInput } = buildBalanceSection(draft);
  form.appendChild(balanceSection);

  const { section: systemSection, toggleInput } = buildSystemSection(draft);
  form.appendChild(systemSection);

  // ── Validation Errors ──────────────────────────────────────────────
  const errorContainer = document.createElement("div");
  errorContainer.className = "form-errors";
  errorContainer.style.display = "none";
  form.appendChild(errorContainer);

  // ── Action Buttons ─────────────────────────────────────────────────
  const actionsGroup = document.createElement("div");
  actionsGroup.className = "form-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "button button-secondary";
  cancelBtn.textContent = "Cancel";

  let saved = false;
  let destroyed = false;

  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("keydown", keyHandler);
    if (!saved) {
      applyThemePreference(initialSettings.theme);
    }
  };

  const handleCancel = () => {
    cleanup();
    onCancel();
  };

  cancelBtn.addEventListener("click", handleCancel);

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "button button-primary";
  saveBtn.textContent = "Save Changes";

  actionsGroup.appendChild(cancelBtn);
  actionsGroup.appendChild(saveBtn);
  form.appendChild(actionsGroup);

  function validate(): boolean {
    draft.intervalSeconds = Number(intervalInput.value);
    draft.balanceAlert.cny = Number(cnyInput.value);
    draft.balanceAlert.usd = Number(usdInput.value);
    draft.openAtLogin = toggleInput.checked;

    const res = validateDesktopSettings(draft);
    if (!res.valid) {
      errorContainer.textContent = res.errors.join(". ");
      errorContainer.style.display = "block";
      saveBtn.disabled = true;
      return false;
    }

    errorContainer.textContent = "";
    errorContainer.style.display = "none";
    saveBtn.disabled = false;
    return true;
  }

  intervalInput.addEventListener("input", validate);
  cnyInput.addEventListener("input", validate);
  usdInput.addEventListener("input", validate);

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };
  window.addEventListener("keydown", keyHandler);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (validate()) {
      saved = true;
      cleanup();
      onSave(draft);
    }
  });

  container.appendChild(form);
  return {
    element: container,
    destroy: cleanup,
  };
}
