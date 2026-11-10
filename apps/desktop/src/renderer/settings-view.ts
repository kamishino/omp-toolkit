import { type AccountSortOrder, isAccountSortOrder } from "@omp-toolkit/core";
import type { SettingsSaveResult } from "../ipc";
import type { DesktopSettings, DesktopTheme } from "../settings";
import { MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, validateDesktopSettings } from "../settings";
import { applyThemePreference } from "./tokens";

export interface SettingsViewController {
  element: HTMLElement;
  actions: HTMLElement;
  syncSettings(settings: DesktopSettings): void;
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

export function renderSettingsView(
  initialSettings: DesktopSettings,
  onSave: (settings: DesktopSettings) => Promise<SettingsSaveResult>,
  onClose: () => void,
): SettingsViewController {
  let baseline = initialSettings;
  let saved = false;
  let destroyed = false;
  let pending = false;

  const dirty = {
    interval: false,
    cny: false,
    usd: false,
    theme: false,
    login: false,
    sort: false,
  };

  const container = document.createElement("div");
  container.className = "settings-view";

  const form = document.createElement("form");
  form.className = "settings-form";
  form.id = "omp-panel-settings-form";

  // ── Timing & Appearance ────────────────────────────────────────────
  const timingSection = document.createElement("fieldset");
  timingSection.className = "settings-section";

  const timingLegend = document.createElement("legend");
  timingLegend.textContent = "Timing & Appearance";
  timingSection.appendChild(timingLegend);

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
  intervalInput.value = String(baseline.intervalSeconds);

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

  // Theme radios
  const themeGroup = document.createElement("div");
  themeGroup.className = "form-group";
  const themeLabel = document.createElement("span");
  themeLabel.className = "form-label";
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

  const themeInputs: HTMLInputElement[] = [];

  for (const theme of themes) {
    const optionLabel = document.createElement("label");
    optionLabel.className = "segmented-item";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "panel-theme";
    input.value = theme.value;
    input.className = "segmented-input";
    input.checked = theme.value === baseline.theme;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      dirty.theme = true;
      applyThemePreference(theme.value);
    });

    const text = document.createElement("span");
    text.textContent = theme.label;

    optionLabel.appendChild(input);
    optionLabel.appendChild(text);
    themeInputs.push(input);
    segmented.appendChild(optionLabel);
  }

  themeGroup.appendChild(segmented);
  timingSection.appendChild(themeGroup);

  // Account Ordering
  const sortGroup = document.createElement("div");
  sortGroup.className = "form-group";
  const sortLabel = document.createElement("label");
  sortLabel.textContent = "Account Ordering";
  sortLabel.htmlFor = "setting-account-sort";

  const sortSelect = document.createElement("select");
  sortSelect.id = "setting-account-sort";
  sortSelect.className = "select-input";
  const sortOptions: Array<{ value: AccountSortOrder; label: string }> = [
    { value: "weekly-reset", label: "Weekly Reset Counting (soonest first)" },
    { value: "weekly-usage", label: "Weekly Quota Usage (highest first)" },
  ];
  for (const option of sortOptions) {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    sortSelect.appendChild(optionEl);
  }
  sortSelect.value = baseline.accountSort;
  sortSelect.addEventListener("change", () => {
    dirty.sort = true;
  });

  const sortHelp = document.createElement("span");
  sortHelp.className = "form-help";
  sortHelp.textContent =
    "Weekly Reset Counting puts accounts that reset soonest on top; Weekly Quota Usage puts the most-used accounts first";

  sortGroup.appendChild(sortLabel);
  sortGroup.appendChild(sortSelect);
  sortGroup.appendChild(sortHelp);
  timingSection.appendChild(sortGroup);
  form.appendChild(timingSection);

  const { section: balanceSection, cnyInput, usdInput } = buildBalanceSection(baseline);
  form.appendChild(balanceSection);

  // System section
  const systemSection = document.createElement("fieldset");
  systemSection.className = "settings-section";
  const systemLegend = document.createElement("legend");
  systemLegend.textContent = "System";
  systemSection.appendChild(systemLegend);

  const toggleWrapper = document.createElement("label");
  toggleWrapper.className = "toggle-row";
  toggleWrapper.htmlFor = "setting-login";

  const toggleText = document.createElement("span");
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
  toggleInput.checked = baseline.openAtLogin;
  toggleInput.addEventListener("change", () => {
    dirty.login = true;
  });

  const toggleTrack = document.createElement("span");
  toggleTrack.className = "toggle-track";
  const toggleThumb = document.createElement("span");
  toggleThumb.className = "toggle-thumb";
  toggleTrack.appendChild(toggleThumb);

  toggleWrapper.appendChild(toggleText);
  toggleWrapper.appendChild(toggleInput);
  toggleWrapper.appendChild(toggleTrack);
  systemSection.appendChild(toggleWrapper);
  form.appendChild(systemSection);

  // Validation errors
  const errorContainer = document.createElement("div");
  errorContainer.className = "form-errors";
  errorContainer.setAttribute("role", "alert");
  errorContainer.setAttribute("aria-live", "assertive");
  errorContainer.hidden = true;
  form.appendChild(errorContainer);

  // Footer actions
  const actions = document.createElement("div");
  actions.className = "settings-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "button button-secondary";
  cancelBtn.textContent = "Cancel";

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.setAttribute("form", form.id);
  saveBtn.className = "button button-primary";
  saveBtn.textContent = "Save";

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  container.appendChild(form);

  const setEnabled = (enabled: boolean) => {
    const controls: Array<HTMLInputElement | HTMLSelectElement> = [
      intervalInput,
      cnyInput,
      usdInput,
      sortSelect,
      toggleInput,
      ...themeInputs,
    ];
    for (const control of controls) {
      control.disabled = !enabled;
    }
    cancelBtn.disabled = !enabled;
    saveBtn.disabled = !enabled;
  };

  const numberValue = (raw: string): number => {
    const trimmed = raw.trim();
    return trimmed.length === 0 ? Number.NaN : Number(trimmed);
  };

  const readDraft = (): DesktopSettings => ({
    intervalSeconds: numberValue(intervalInput.value),
    balanceAlert: {
      cny: numberValue(cnyInput.value),
      usd: numberValue(usdInput.value),
    },
    theme: (themeInputs.find((input) => input.checked)?.value ?? baseline.theme) as DesktopTheme,
    openAtLogin: toggleInput.checked,
    accountSort: isAccountSortOrder(sortSelect.value) ? sortSelect.value : baseline.accountSort,
  });

  const showErrors = (errors: readonly string[]) => {
    errorContainer.textContent = errors.join(". ");
    errorContainer.hidden = errors.length === 0;
  };

  const validateDraft = (draft: DesktopSettings): boolean => {
    const result = validateDesktopSettings(draft);
    showErrors(result.errors);
    return result.valid;
  };

  const markDirty = (field: keyof typeof dirty, predicate: (draft: DesktopSettings) => boolean) => {
    dirty[field] = predicate(readDraft());
  };

  intervalInput.addEventListener("input", () => {
    markDirty("interval", (draft) => draft.intervalSeconds !== baseline.intervalSeconds);
  });
  cnyInput.addEventListener("input", () => {
    markDirty("cny", (draft) => draft.balanceAlert.cny !== baseline.balanceAlert.cny);
  });
  usdInput.addEventListener("input", () => {
    markDirty("usd", (draft) => draft.balanceAlert.usd !== baseline.balanceAlert.usd);
  });

  cancelBtn.addEventListener("click", () => {
    if (pending) return;
    applyThemePreference(baseline.theme);
    onClose();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pending || destroyed) return;
    const draft = readDraft();
    if (!validateDraft(draft)) return;

    pending = true;
    setEnabled(false);
    const snapshot = { ...draft, balanceAlert: { ...draft.balanceAlert } };
    void onSave(snapshot)
      .then((result) => {
        if (!result.valid) {
          showErrors(result.errors.length > 0 ? result.errors : ["Settings were not saved."]);
          return;
        }
        saved = true;
        baseline = snapshot;
        onClose();
      })
      .catch((error: unknown) => {
        showErrors([
          `Settings were not saved: ${error instanceof Error ? error.message : String(error)}`,
        ]);
      })
      .finally(() => {
        pending = false;
        if (!destroyed) setEnabled(true);
      });
  });

  return {
    element: container,
    actions,
    syncSettings(settings: DesktopSettings): void {
      if (destroyed || pending) return;
      baseline = settings;
      if (!dirty.interval) intervalInput.value = String(settings.intervalSeconds);
      if (!dirty.cny) cnyInput.value = String(settings.balanceAlert.cny);
      if (!dirty.usd) usdInput.value = String(settings.balanceAlert.usd);
      if (!dirty.login) toggleInput.checked = settings.openAtLogin;
      if (!dirty.sort) sortSelect.value = settings.accountSort;
      if (!dirty.theme) {
        for (const input of themeInputs) {
          input.checked = input.value === settings.theme;
        }
        applyThemePreference(settings.theme);
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (!saved) applyThemePreference(baseline.theme);
    },
  };
}
