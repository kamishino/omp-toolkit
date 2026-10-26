import type { DesktopSettings, DesktopTheme } from "../settings";
import { MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, validateDesktopSettings } from "../settings";
import { applyThemePreference } from "./tokens";

export function renderSettingsView(
  initialSettings: DesktopSettings,
  onSave: (settings: DesktopSettings) => void,
  onCancel: () => void,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "settings-view";

  const title = document.createElement("h2");
  title.className = "settings-title";
  title.textContent = "Widget Settings";
  container.appendChild(title);

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

  // 1. Refresh Interval
  const intervalGroup = document.createElement("div");
  intervalGroup.className = "form-group";
  const intervalLabel = document.createElement("label");
  intervalLabel.textContent = "Refresh Interval (seconds)";
  intervalLabel.htmlFor = "setting-interval";
  const intervalInput = document.createElement("input");
  intervalInput.id = "setting-interval";
  intervalInput.type = "number";
  intervalInput.min = String(MIN_INTERVAL_SECONDS);
  intervalInput.max = String(MAX_INTERVAL_SECONDS);
  intervalInput.value = String(draft.intervalSeconds);
  const intervalHelp = document.createElement("span");
  intervalHelp.className = "form-help";
  intervalHelp.textContent = `Between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS} seconds (default: 300)`;
  intervalGroup.appendChild(intervalLabel);
  intervalGroup.appendChild(intervalInput);
  intervalGroup.appendChild(intervalHelp);
  form.appendChild(intervalGroup);

  // 2. Balance Alert CNY
  const cnyGroup = document.createElement("div");
  cnyGroup.className = "form-group";
  const cnyLabel = document.createElement("label");
  cnyLabel.textContent = "DeepSeek Balance Alert (CNY)";
  cnyLabel.htmlFor = "setting-cny";
  const cnyInput = document.createElement("input");
  cnyInput.id = "setting-cny";
  cnyInput.type = "number";
  cnyInput.min = "0";
  cnyInput.step = "1";
  cnyInput.value = String(draft.balanceAlert.cny);
  const cnyHelp = document.createElement("span");
  cnyHelp.className = "form-help";
  cnyHelp.textContent = "Shows red LOW label when balance falls to or below this amount";
  cnyGroup.appendChild(cnyLabel);
  cnyGroup.appendChild(cnyInput);
  cnyGroup.appendChild(cnyHelp);
  form.appendChild(cnyGroup);

  // 3. Balance Alert USD
  const usdGroup = document.createElement("div");
  usdGroup.className = "form-group";
  const usdLabel = document.createElement("label");
  usdLabel.textContent = "DeepSeek Balance Alert (USD)";
  usdLabel.htmlFor = "setting-usd";
  const usdInput = document.createElement("input");
  usdInput.id = "setting-usd";
  usdInput.type = "number";
  usdInput.min = "0";
  usdInput.step = "1";
  usdInput.value = String(draft.balanceAlert.usd);
  const usdHelp = document.createElement("span");
  usdHelp.className = "form-help";
  usdHelp.textContent = "Shows red LOW label when USD balance falls to or below this amount";
  usdGroup.appendChild(usdLabel);
  usdGroup.appendChild(usdInput);
  usdGroup.appendChild(usdHelp);
  form.appendChild(usdGroup);

  // 4. Theme
  const themeGroup = document.createElement("div");
  themeGroup.className = "form-group";
  const themeLabel = document.createElement("label");
  themeLabel.textContent = "Appearance Theme";
  themeLabel.htmlFor = "setting-theme";
  const themeSelect = document.createElement("select");
  themeSelect.id = "setting-theme";

  const themeOptions: Array<{ value: DesktopTheme; label: string }> = [
    { value: "system", label: "System (follows OS)" },
    { value: "dark", label: "Dark mode" },
    { value: "light", label: "Light mode" },
  ];

  for (const opt of themeOptions) {
    const optEl = document.createElement("option");
    optEl.value = opt.value;
    optEl.textContent = opt.label;
    if (opt.value === draft.theme) {
      optEl.selected = true;
    }
    themeSelect.appendChild(optEl);
  }

  themeSelect.addEventListener("change", () => {
    draft.theme = themeSelect.value as DesktopTheme;
    applyThemePreference(draft.theme);
  });

  themeGroup.appendChild(themeLabel);
  themeGroup.appendChild(themeSelect);
  form.appendChild(themeGroup);

  // 5. Open at Login
  const loginGroup = document.createElement("div");
  loginGroup.className = "form-group form-checkbox";
  const loginLabel = document.createElement("label");
  loginLabel.htmlFor = "setting-login";
  const loginInput = document.createElement("input");
  loginInput.id = "setting-login";
  loginInput.type = "checkbox";
  loginInput.checked = draft.openAtLogin;
  loginInput.addEventListener("change", () => {
    draft.openAtLogin = loginInput.checked;
  });
  const loginText = document.createElement("span");
  loginText.textContent = "Start at login";
  loginLabel.appendChild(loginInput);
  loginLabel.appendChild(loginText);
  loginGroup.appendChild(loginLabel);
  form.appendChild(loginGroup);

  // Validation message container
  const errorContainer = document.createElement("div");
  errorContainer.className = "form-errors";
  errorContainer.style.display = "none";
  form.appendChild(errorContainer);

  // Actions
  const actionsGroup = document.createElement("div");
  actionsGroup.className = "form-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "button button-primary";
  saveBtn.textContent = "Save Settings";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "button button-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    // Revert theme preview on cancel
    applyThemePreference(initialSettings.theme);
    onCancel();
  });

  actionsGroup.appendChild(cancelBtn);
  actionsGroup.appendChild(saveBtn);
  form.appendChild(actionsGroup);

  function validate(): boolean {
    draft.intervalSeconds = Number(intervalInput.value);
    draft.balanceAlert.cny = Number(cnyInput.value);
    draft.balanceAlert.usd = Number(usdInput.value);
    draft.theme = themeSelect.value as DesktopTheme;
    draft.openAtLogin = loginInput.checked;

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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (validate()) {
      onSave(draft);
    }
  });

  container.appendChild(form);
  return container;
}
