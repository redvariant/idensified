import { IndexedDbVaultStore } from "./idb-store.ts";
import { VaultAlreadyExistsError, VaultConflictError, VaultUnlockError, ValidationError } from "./errors.ts";
import { makeIdentityRecord } from "./validation.ts";
import { createVault, saveVault, unlockVault } from "./vault.ts";
import type { IdentityRecord, VaultSession } from "./types.ts";

const store = new IndexedDbVaultStore();
const AUTO_LOCK_MS = 5 * 60 * 1_000;
let session: VaultSession | null = null;
let sessionEpoch = 0;
let autoLockTimer: number | undefined;
let editing = false;

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required UI element: ${id}`);
  return node as T;
}

const setupView = element<HTMLElement>("setup-view");
const unlockView = element<HTMLElement>("unlock-view");
const vaultView = element<HTMLElement>("vault-view");
const statusMessage = element<HTMLDivElement>("status-message");
const setupForm = element<HTMLFormElement>("setup-form");
const unlockForm = element<HTMLFormElement>("unlock-form");
const identityForm = element<HTMLFormElement>("identity-form");
const addPanel = element<HTMLElement>("add-panel");
const identityList = element<HTMLDivElement>("identity-list");
const emptyState = element<HTMLDivElement>("empty-state");

function showView(view: "setup" | "unlock" | "vault"): void {
  setupView.hidden = view !== "setup";
  unlockView.hidden = view !== "unlock";
  vaultView.hidden = view !== "vault";
}

function showStatus(message: string, kind: "success" | "error" = "success"): void {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", kind === "error");
  statusMessage.hidden = false;
}

function clearStatus(): void {
  statusMessage.textContent = "";
  statusMessage.hidden = true;
  statusMessage.classList.remove("error");
}

function readField(id: string): string {
  return element<HTMLInputElement | HTMLTextAreaElement>(id).value;
}

function writeField(id: string, value: string): void {
  element<HTMLInputElement | HTMLTextAreaElement>(id).value = value;
}

function clearIdentityForm(): void {
  for (const id of ["identity-origin", "identity-label", "identity-email", "identity-username", "identity-phone", "identity-address"]) {
    writeField(id, "");
  }
}

function showAddPanel(show: boolean): void {
  addPanel.hidden = !show;
  if (show) {
    element<HTMLInputElement>("identity-origin").focus();
  }
}

function startAutoLock(): void {
  if (autoLockTimer !== undefined) window.clearTimeout(autoLockTimer);
  autoLockTimer = window.setTimeout(() => lockVault("Your vault locked after five minutes of inactivity."), AUTO_LOCK_MS);
}

function lockVault(message = "Your vault is locked."): void {
  sessionEpoch += 1;
  session = null;
  if (autoLockTimer !== undefined) window.clearTimeout(autoLockTimer);
  autoLockTimer = undefined;
  showAddPanel(false);
  clearIdentityForm();
  identityList.replaceChildren();
  element<HTMLElement>("identity-count").textContent = "Vault locked";
  showView("unlock");
  showStatus(message);
  element<HTMLInputElement>("unlock-passphrase").value = "";
}

function createText(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function renderIdentity(record: IdentityRecord): HTMLElement {
  const card = document.createElement("article");
  card.className = "identity-card";

  const header = document.createElement("div");
  header.className = "identity-card-head";
  const site = document.createElement("div");
  site.className = "identity-site";
  site.append(
    createText("strong", "", record.label || new URL(record.origin).hostname),
    createText("span", "", record.origin),
  );

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete-button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => void removeIdentity(record.id));
  header.append(site, remove);
  card.append(header);

  const details = document.createElement("dl");
  details.className = "identity-details";
  const fields: Array<[string, string]> = [
    ["Email", record.emailAlias],
    ["Username", record.usernameAlias],
    ["Phone", record.phoneAlias],
    ["Address", record.addressAlias],
  ];
  for (const [label, value] of fields) {
    if (!value) continue;
    const row = document.createElement("div");
    row.className = "identity-detail";
    row.append(createText("dt", "", label), createText("dd", "", value));
    details.append(row);
  }
  card.append(details);
  return card;
}

function renderVault(): void {
  if (!session) return;
  const identities = [...session.payload.identities].sort((a, b) => b.updatedAt - a.updatedAt);
  element<HTMLElement>("identity-count").textContent = `${identities.length} saved ${identities.length === 1 ? "identity" : "identities"}`;
  emptyState.hidden = identities.length !== 0;
  identityList.replaceChildren(...identities.map(renderIdentity));
}

async function removeIdentity(id: string): Promise<void> {
  if (!session) return;
  const record = session.payload.identities.find((item) => item.id === id);
  if (!record) return;
  if (!window.confirm(`Remove the saved identity for ${record.origin}?`)) return;

  const operationEpoch = sessionEpoch;
  try {
    const nextPayload = {
      schemaVersion: 1 as const,
      identities: session.payload.identities.filter((item) => item.id !== id),
    };
    const saved = await saveVault(store, { ...session, payload: nextPayload });
    if (sessionEpoch !== operationEpoch) return;
    session = saved;
    renderVault();
    startAutoLock();
    showStatus("Identity removed from your encrypted vault.");
  } catch (error) {
    if (sessionEpoch === operationEpoch) {
      handleVaultError(error, "Could not remove that identity.");
    }
  }
}

function handleVaultError(error: unknown, fallback: string): void {
  if (error instanceof VaultUnlockError) {
    showStatus("That passphrase didn't unlock the vault. Check it and try again.", "error");
    return;
  }
  if (error instanceof VaultConflictError) {
    lockVault("The vault changed elsewhere. Unlock again before continuing.");
    return;
  }
  if (error instanceof VaultAlreadyExistsError) {
    showStatus("A vault was created in another window. Close this popup and reopen it.", "error");
    return;
  }
  if (error instanceof ValidationError) {
    showStatus(error.message, "error");
    return;
  }
  showStatus(fallback, "error");
}

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearStatus();
  const passphrase = readField("setup-passphrase");
  const confirmation = readField("setup-confirm");
  if (passphrase !== confirmation) {
    showStatus("Those passphrases don't match yet.", "error");
    return;
  }
  const submitButton = setupForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;
  const operationEpoch = sessionEpoch;

  void createVault(store, passphrase)
    .then((created) => {
      if (sessionEpoch !== operationEpoch) return;
      sessionEpoch += 1;
      session = created;
      writeField("setup-passphrase", "");
      writeField("setup-confirm", "");
      showView("vault");
      renderVault();
      startAutoLock();
      showStatus("Your encrypted vault is ready. Add an alias you already use.");
    })
    .catch((error: unknown) => {
      if (sessionEpoch === operationEpoch) {
        handleVaultError(error, "Couldn't create the local vault. Check that browser storage is available.");
      }
    })
    .finally(() => {
      writeField("setup-passphrase", "");
      writeField("setup-confirm", "");
      if (submitButton) submitButton.disabled = false;
    });
});

unlockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearStatus();
  const submitButton = unlockForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;
  const operationEpoch = sessionEpoch;
  const passphrase = readField("unlock-passphrase");
  void unlockVault(store, passphrase)
    .then((unlocked) => {
      if (sessionEpoch !== operationEpoch) return;
      sessionEpoch += 1;
      session = unlocked;
      writeField("unlock-passphrase", "");
      showView("vault");
      renderVault();
      startAutoLock();
      showStatus("Vault unlocked. Your saved aliases are ready.");
    })
    .catch((error: unknown) => {
      if (sessionEpoch === operationEpoch) {
        handleVaultError(error, "Couldn't unlock the vault.");
      }
    })
    .finally(() => {
      writeField("unlock-passphrase", "");
      if (submitButton) submitButton.disabled = false;
    });
});

identityForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearStatus();
  if (!session) {
    lockVault();
    return;
  }

  try {
    const record = makeIdentityRecord({
      origin: readField("identity-origin"),
      label: readField("identity-label"),
      emailAlias: readField("identity-email"),
      usernameAlias: readField("identity-username"),
      phoneAlias: readField("identity-phone"),
      addressAlias: readField("identity-address"),
    });

    if (session.payload.identities.length >= 250) {
      throw new ValidationError("The starter vault is limited to 250 identities for now.");
    }
    if (session.payload.identities.some((item) => item.origin === record.origin)) {
      throw new ValidationError("You already have an identity saved for this exact website origin.");
    }

    const nextPayload = {
      schemaVersion: 1 as const,
      identities: [...session.payload.identities, record],
    };
    const operationEpoch = sessionEpoch;

    void saveVault(store, { ...session, payload: nextPayload })
      .then((saved) => {
        if (sessionEpoch !== operationEpoch) return;
        session = saved;
        clearIdentityForm();
        showAddPanel(false);
        renderVault();
        startAutoLock();
        showStatus("Saved. That alias is now stored encrypted on this device.");
      })
      .catch((error: unknown) => {
        if (sessionEpoch === operationEpoch) {
          handleVaultError(error, "Couldn't save that identity.");
        }
      });
  } catch (error) {
    handleVaultError(error, "Check the details and try again.");
  }
});

element<HTMLButtonElement>("show-add-button").addEventListener("click", () => showAddPanel(true));
element<HTMLButtonElement>("empty-add-button").addEventListener("click", () => showAddPanel(true));
element<HTMLButtonElement>("cancel-add-button").addEventListener("click", () => {
  clearIdentityForm();
  showAddPanel(false);
});
element<HTMLButtonElement>("lock-button").addEventListener("click", () => lockVault("Vault locked."));

for (const eventName of ["pointerdown", "keydown", "input"] as const) {
  document.addEventListener(eventName, () => {
    if (session) startAutoLock();
  }, { passive: true });
}

window.addEventListener("pagehide", () => {
  sessionEpoch += 1;
  session = null;
  identityList.replaceChildren();
  if (autoLockTimer !== undefined) window.clearTimeout(autoLockTimer);
});

async function initialise(): Promise<void> {
  try {
    const saved = await store.read();
    showView(saved ? "unlock" : "setup");
  } catch {
    showView("setup");
    showStatus("Local encrypted storage isn't available. Your information has not been saved.", "error");
  }
}

void initialise();
