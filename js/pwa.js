(function () {
  const OFFLINE_CLASS = "is-offline";
  let deferredPrompt = null;
  let installButton = null;

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isSafari = /safari/i.test(window.navigator.userAgent) && !/crios|fxios|edgios|chrome/i.test(window.navigator.userAgent);

  function isStandaloneMode() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  }

  function showIosInstallHelp() {
    alert('In Safari: tap Share > Add to Home Screen.');
  }

  function updateInstallButtonVisibility() {
    if (!installButton) return;
    if (isStandaloneMode()) {
      installButton.style.display = "none";
      return;
    }
    const canInstallFromPrompt = Boolean(deferredPrompt);
    const canInstallFromIos = isIos && isSafari;
    installButton.style.display = canInstallFromPrompt || canInstallFromIos ? "" : "none";
  }

  function createOfflineIndicator() {
    const indicator = document.createElement("div");
    indicator.id = "offline-indicator";
    indicator.textContent = "Offline mode";
    document.body.appendChild(indicator);

    function updateStatus() {
      if (navigator.onLine) {
        document.body.classList.remove(OFFLINE_CLASS);
      } else {
        document.body.classList.add(OFFLINE_CLASS);
      }
    }

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    updateStatus();
  }

  function createInstallBanner() {
    const banner = document.createElement("div");
    banner.id = "pwa-install-banner";
    banner.hidden = true;
    banner.innerHTML = `
      <div class="pwa-install-content">
        <p id="pwa-install-text"></p>
        <div class="pwa-install-actions">
          <button id="pwa-install-action" class="btn btn-small btn-primary" type="button"></button>
          <button id="pwa-install-close" class="btn btn-small btn-ghost" type="button">Not now</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    const text = banner.querySelector("#pwa-install-text");
    const action = banner.querySelector("#pwa-install-action");
    const close = banner.querySelector("#pwa-install-close");

    close.addEventListener("click", () => {
      banner.hidden = true;
      localStorage.setItem("xpense_install_banner_dismissed", String(Date.now()));
    });

    return { banner, text, action };
  }

  function shouldShowInstallBanner() {
    const dismissedAt = Number(localStorage.getItem("xpense_install_banner_dismissed") || 0);
    const oneDay = 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt > oneDay;
  }

  function setupInstallFlow() {
    const ui = createInstallBanner();
    installButton = document.getElementById("pwaInstallBtn");

    if (installButton) {
      installButton.addEventListener("click", async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null;
          ui.banner.hidden = true;
          updateInstallButtonVisibility();
          return;
        }

        if (isIos && isSafari && !isStandaloneMode()) {
          showIosInstallHelp();
        }
      });
    }

    if (isIos && isSafari && !isStandaloneMode() && shouldShowInstallBanner()) {
      ui.text.textContent = 'Install Xpense: tap Share, then "Add to Home Screen".';
      ui.action.textContent = "How to install";
      ui.action.addEventListener("click", showIosInstallHelp);
      ui.banner.hidden = false;
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredPrompt = event;

      if (isStandaloneMode() || !shouldShowInstallBanner()) {
        updateInstallButtonVisibility();
        return;
      }

      ui.text.textContent = "Install Xpense for a full-screen app experience.";
      ui.action.textContent = "Install";
      ui.action.onclick = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        ui.banner.hidden = true;
        updateInstallButtonVisibility();
      };
      ui.banner.hidden = false;
      updateInstallButtonVisibility();
    });

    updateInstallButtonVisibility();
  }

  function showUpdateToast(worker) {
    const existing = document.getElementById("pwa-update-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "pwa-update-toast";
    toast.innerHTML = `
      <span>New version available.</span>
      <button id="pwa-update-refresh" class="btn btn-small btn-primary" type="button">Refresh</button>
    `;
    document.body.appendChild(toast);

    const refreshBtn = toast.querySelector("#pwa-update-refresh");
    refreshBtn.addEventListener("click", () => {
      worker.postMessage({ type: "SKIP_WAITING" });
    });
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.register("/sw.js");

      const listenForUpdate = () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateToast(registration.waiting || installing);
          }
        });
      };

      if (registration.waiting) {
        showUpdateToast(registration.waiting);
      }

      registration.addEventListener("updatefound", listenForUpdate);
      listenForUpdate();

      window.addEventListener("online", () => {
        registration.update().catch(() => {});
      });

      let hasRefreshed = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hasRefreshed) return;
        hasRefreshed = true;
        window.location.reload();
      });
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    createOfflineIndicator();
    setupInstallFlow();
    registerServiceWorker();
  });
})();
