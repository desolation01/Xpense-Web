(function () {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const PBKDF2_ITERATIONS = 250000;
  const SESSION_CACHE_PREFIX = "xpense_vault_session_v1";
  const SESSION_CACHE_TTL_MS = 30 * 60 * 1000;

  let cachedPassphrase = null;
  let activeVaultRequest = null;

  function ensureCryptoSupport() {
    return typeof window !== "undefined" &&
      window.crypto &&
      window.crypto.subtle;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function getSessionCacheKey() {
    const username = String(localStorage.getItem("auth_username") || "").trim().toLowerCase();
    return username ? `${SESSION_CACHE_PREFIX}_${username}` : SESSION_CACHE_PREFIX;
  }

  function clearSessionPassphrase() {
    cachedPassphrase = null;
    try {
      sessionStorage.removeItem(getSessionCacheKey());
    } catch {}
  }

  function persistSessionPassphrase(passphrase) {
    cachedPassphrase = passphrase;
    try {
      sessionStorage.setItem(getSessionCacheKey(), JSON.stringify({
        passphrase,
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      }));
    } catch {}
  }

  function restoreSessionPassphrase() {
    if (cachedPassphrase) return cachedPassphrase;

    try {
      const raw = sessionStorage.getItem(getSessionCacheKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.passphrase !== "string" || !parsed.passphrase) {
        sessionStorage.removeItem(getSessionCacheKey());
        return null;
      }
      if (!Number.isFinite(Number(parsed.expiresAt)) || Number(parsed.expiresAt) <= Date.now()) {
        sessionStorage.removeItem(getSessionCacheKey());
        return null;
      }

      cachedPassphrase = parsed.passphrase;
      persistSessionPassphrase(cachedPassphrase);
      return cachedPassphrase;
    } catch {
      try {
        sessionStorage.removeItem(getSessionCacheKey());
      } catch {}
      return null;
    }
  }

  async function deriveKey(passphrase, salt, iterations) {
    const passphraseKey = await window.crypto.subtle.importKey(
      "raw",
      textEncoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      passphraseKey,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptJSON(payload) {
    restoreSessionPassphrase();
    if (!cachedPassphrase) {
      throw new Error("Vault is locked.");
    }

    const salt = window.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = window.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(cachedPassphrase, salt, PBKDF2_ITERATIONS);
    const plaintext = textEncoder.encode(JSON.stringify(payload));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext
    );

    return {
      version: 1,
      algorithm: "AES-GCM",
      kdf: "PBKDF2",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
  }

  async function decryptJSON(envelope, passphraseOverride) {
    if (!envelope || typeof envelope !== "object") {
      throw new Error("Missing encrypted payload.");
    }

    const iterations = Number(envelope.iterations) || PBKDF2_ITERATIONS;
    const passphrase = passphraseOverride || restoreSessionPassphrase() || cachedPassphrase;
    if (!passphrase) {
      throw new Error("Vault is locked.");
    }

    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const ciphertext = base64ToBytes(envelope.ciphertext);
    const key = await deriveKey(passphrase, salt, iterations);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return JSON.parse(textDecoder.decode(decrypted));
  }

  function getVaultElements() {
    return {
      modal: document.getElementById("vaultModal"),
      title: document.getElementById("vaultModalTitle"),
      description: document.getElementById("vaultModalDescription"),
      message: document.getElementById("vaultModalMessage"),
      form: document.getElementById("vaultModalForm"),
      passphraseLabel: document.getElementById("vaultPassphraseLabel"),
      passphraseInput: document.getElementById("vaultPassphraseInput"),
      confirmField: document.getElementById("vaultConfirmField"),
      confirmInput: document.getElementById("vaultConfirmInput"),
      showPassphrase: document.getElementById("vaultShowPassphrase"),
      error: document.getElementById("vaultModalError"),
      warning: document.getElementById("vaultModalWarning"),
      submitBtn: document.getElementById("vaultSubmitBtn"),
      cancelBtn: document.getElementById("vaultCancelBtn"),
      closeButtons: Array.from(document.querySelectorAll("[data-vault-close]")),
    };
  }

  function closeVaultModal(elements) {
    if (!elements?.modal) return;
    elements.modal.classList.remove("is-open");
    elements.modal.setAttribute("aria-hidden", "true");
  }

  function openVaultModal(elements) {
    elements.modal.classList.add("is-open");
    elements.modal.setAttribute("aria-hidden", "false");
  }

  async function requestPassphrase(options) {
    const elements = getVaultElements();
    if (!elements.modal || !elements.form || !elements.passphraseInput || !elements.submitBtn) {
      throw new Error("Vault modal UI is missing from the page.");
    }

    if (activeVaultRequest) {
      return activeVaultRequest;
    }

    const {
      mode,
      title,
      description,
      message,
      warning,
      submitLabel,
      errorMessage,
    } = options;

    activeVaultRequest = new Promise((resolve) => {
      let settled = false;
      const isCreateMode = mode === "create";
      const isDismissible = false;

      const cleanup = () => {
        elements.form.removeEventListener("submit", handleSubmit);
        elements.showPassphrase?.removeEventListener("change", handleToggleVisibility);
        if (isDismissible) {
          elements.cancelBtn?.removeEventListener("click", handleCancel);
          elements.closeButtons.forEach((button) => button.removeEventListener("click", handleCancel));
          document.removeEventListener("keydown", handleKeydown);
        }
        closeVaultModal(elements);
        activeVaultRequest = null;
      };

      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const handleToggleVisibility = () => {
        const visible = Boolean(elements.showPassphrase?.checked);
        const nextType = visible ? "text" : "password";
        elements.passphraseInput.type = nextType;
        if (elements.confirmInput) {
          elements.confirmInput.type = nextType;
        }
      };

      const handleCancel = () => finish(null);

      const handleKeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          handleCancel();
        }
      };

      const handleSubmit = (event) => {
        event.preventDefault();
        const passphrase = String(elements.passphraseInput.value || "");
        const confirmation = String(elements.confirmInput?.value || "");

        if (!passphrase.trim()) {
          elements.error.textContent = "Enter a passphrase to continue.";
          elements.passphraseInput.focus();
          return;
        }

        if (isCreateMode && passphrase !== confirmation) {
          elements.error.textContent = "The confirmation passphrase does not match.";
          elements.confirmInput?.focus();
          return;
        }

        finish(passphrase);
      };

      elements.title.textContent = title;
      elements.description.textContent = description;
      elements.message.textContent = message;
      elements.warning.textContent = warning;
      elements.submitBtn.textContent = submitLabel;
      elements.passphraseLabel.textContent = isCreateMode ? "New passphrase" : "Passphrase";
      elements.passphraseInput.value = "";
      elements.passphraseInput.placeholder = isCreateMode ? "Example: mango river planet 204" : "Enter your passphrase";
      elements.passphraseInput.autocomplete = isCreateMode ? "new-password" : "current-password";
      elements.confirmField.hidden = !isCreateMode;
      elements.confirmInput.value = "";
      elements.confirmInput.required = isCreateMode;
      elements.confirmInput.placeholder = isCreateMode ? "Example: mango river planet-204" : elements.confirmInput.placeholder;
      elements.showPassphrase.checked = isCreateMode;
      elements.error.textContent = errorMessage || "";
      if (elements.cancelBtn) {
        elements.cancelBtn.hidden = !isDismissible;
      }
      elements.closeButtons.forEach((button) => {
        button.hidden = !isDismissible;
      });
      handleToggleVisibility();

      elements.form.addEventListener("submit", handleSubmit);
      elements.showPassphrase?.addEventListener("change", handleToggleVisibility);
      if (isDismissible) {
        elements.cancelBtn?.addEventListener("click", handleCancel);
        elements.closeButtons.forEach((button) => button.addEventListener("click", handleCancel));
        document.addEventListener("keydown", handleKeydown);
      }

      openVaultModal(elements);
      window.requestAnimationFrame(() => {
        elements.passphraseInput.focus();
        elements.passphraseInput.select();
      });
    });

    return activeVaultRequest;
  }

  async function unlock(options = {}) {
    const {
      existingEnvelope = null,
      createIfMissing = false,
      forcePrompt = false,
    } = options;

    if (!ensureCryptoSupport()) {
      throw new Error("This browser does not support the encryption features required by Xpense.");
    }

    const restoredPassphrase = restoreSessionPassphrase();

    if ((cachedPassphrase || restoredPassphrase) && !forcePrompt) {
      if (!existingEnvelope) return true;
      try {
        await decryptJSON(existingEnvelope);
        persistSessionPassphrase(cachedPassphrase || restoredPassphrase);
        return true;
      } catch {
        clearSessionPassphrase();
      }
    }

    const hasExistingData = Boolean(existingEnvelope);
    let lastErrorMessage = "";
    while (true) {
      const passphrase = await requestPassphrase(
        hasExistingData ? {
          mode: "unlock",
          title: "Unlock your encrypted finance data",
          description: "This passphrase stays in your browser session and unlocks your protected tracker data locally.",
          message: "Enter the passphrase you created for this account to view salary, budgets, and calendar entries.",
          warning: "If you forgot your passphrase, the encrypted data cannot be recovered by the developer or server.",
          submitLabel: "Unlock Vault",
          errorMessage: lastErrorMessage,
        } : {
          mode: "create",
          title: "Create your private vault",
          description: "We value your privacy so we decided to hide any data that the user inputs here, even the developers can not access your data in our database by using end-to-end encryption controlled only by you.",
          message: "Create a passphrase for this account. It is never stored on the server, so keep it somewhere safe.",
          warning: "Losing this passphrase means encrypted finance data cannot be recovered later.",
          submitLabel: "Create Vault",
          errorMessage: "",
        }
      );

      if (!passphrase) return false;

      if (!hasExistingData && !createIfMissing) {
        persistSessionPassphrase(passphrase);
        return true;
      }

      try {
        if (hasExistingData) {
          await decryptJSON(existingEnvelope, passphrase);
        }
        persistSessionPassphrase(passphrase);
        return true;
      } catch {
        lastErrorMessage = "That passphrase could not unlock your encrypted data. Please try again.";
      }
    }
  }

  function lock() {
    clearSessionPassphrase();
  }

  window.privateVault = {
    isSupported: ensureCryptoSupport,
    unlock,
    lock,
    encryptJSON,
    decryptJSON,
    hasPassphrase() {
      return Boolean(restoreSessionPassphrase() || cachedPassphrase);
    },
  };
})();
