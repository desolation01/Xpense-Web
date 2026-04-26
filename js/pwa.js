(function () {
  const OFFLINE_CLASS = "is-offline";
  const AUTO_APPLY_UPDATE_DELAY_MS = 12000;
  const UPDATE_CHECK_INTERVAL_MS = 60 * 1000;
  const DEPLOY_CHECK_INTERVAL_MS = 60 * 1000;
  const DEPLOY_VERSION_KEY = "xpense_last_seen_deploy_version";
  const SW_BUILD_KEY = "xpense_sw_build_version";
  const INSTALL_BANNER_REFRESH_COOLDOWN_KEY = "xpense_install_banner_refresh_cooldown";
  const INSTALL_BANNER_REFRESH_DELAY = 3;
  const debugMode = new URLSearchParams(window.location.search).has("pwa-debug");
  let deferredPrompt = null;
  let installButton = null;
  let installUi = null;
  let pwaDebug = null;
  let updateTimer = null;
  let deployCheckTimer = null;
  let activeRegistration = null;
  let currentSwBuildVersion = null;

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isSafari = /safari/i.test(window.navigator.userAgent) && !/crios|fxios|edgios|chrome/i.test(window.navigator.userAgent);

  function isStandaloneMode() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  }

  function syncStandaloneClass() {
    document.body.classList.toggle("is-ios", isIos);
    document.body.classList.toggle("is-standalone", Boolean(isStandaloneMode()));
  }

  function showIosInstallHelp() {
    alert('In Safari: tap Share > Add to Home Screen.');
  }

  function showGenericInstallHelp() {
    alert("Install is not available yet in this browser session. Try: open in full Chrome (not in-app browser), reload once, wait 10 seconds, then check menu again.");
  }

  function setDebugLine(text) {
    if (!pwaDebug) return;
    pwaDebug.textContent = text;
  }

  function renderInstallAvailability() {
    if (!installUi) return;
    if (isStandaloneMode()) {
      installUi.banner.hidden = true;
      updateInstallButtonVisibility();
      return;
    }

    if (!deferredPrompt) {
      updateInstallButtonVisibility();
      return;
    }

    if (!shouldShowInstallBanner()) {
      updateInstallButtonVisibility();
      return;
    }

    installUi.text.textContent = "Install Xpense for a full-screen app experience.";
    installUi.action.textContent = "Install";
    installUi.action.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installUi.banner.hidden = true;
      updateInstallButtonVisibility();
      setDebugLine(`PWA debug | secure:${window.isSecureContext} | manifest:true | sw-api:${"serviceWorker" in navigator} | sw-controller:${Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)} | install-event:false`);
    };
    installUi.banner.hidden = false;
    updateInstallButtonVisibility();
  }

  function onBeforeInstallPrompt(event) {
    event.preventDefault();
    deferredPrompt = event;
    setDebugLine(`PWA debug | secure:${window.isSecureContext} | manifest:true | sw-api:${"serviceWorker" in navigator} | sw-controller:${Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)} | install-event:true`);
    renderInstallAvailability();
  }

  function onAppInstalled() {
    deferredPrompt = null;
    if (installUi) installUi.banner.hidden = true;
    updateInstallButtonVisibility();
    setDebugLine(`PWA debug | secure:${window.isSecureContext} | manifest:true | sw-api:${"serviceWorker" in navigator} | sw-controller:${Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)} | install-event:false`);
  }

  async function setupPwaDebug() {
    if (!debugMode || isStandaloneMode()) return;

    pwaDebug = document.createElement("div");
    pwaDebug.id = "pwa-debug-strip";
    pwaDebug.style.cssText = "position:fixed;left:10px;right:10px;bottom:10px;z-index:10000;padding:8px 10px;border-radius:10px;background:rgba(2,6,23,.92);border:1px solid rgba(148,163,184,.35);color:#e2e8f0;font:12px/1.35 system-ui,sans-serif;";
    pwaDebug.textContent = "PWA check running...";
    document.body.appendChild(pwaDebug);

    const httpsOk = window.isSecureContext;
    const swOk = "serviceWorker" in navigator;
    const manifestLink = document.querySelector('link[rel="manifest"]');
    let manifestOk = false;

    if (manifestLink && manifestLink.href) {
      try {
        const res = await fetch(manifestLink.href, { cache: "no-store" });
        manifestOk = res.ok;
      } catch {
        manifestOk = false;
      }
    }

    const controllerOk = Boolean(navigator.serviceWorker && navigator.serviceWorker.controller);
    setDebugLine(`PWA debug | secure:${httpsOk} | manifest:${manifestOk} | sw-api:${swOk} | sw-controller:${controllerOk} | install-event:${Boolean(deferredPrompt)}`);
  }

  function updateInstallButtonVisibility() {
    if (!installButton) return;
    if (isStandaloneMode()) {
      installButton.style.display = "none";
      return;
    }
    installButton.style.display = "";
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
      localStorage.setItem(INSTALL_BANNER_REFRESH_COOLDOWN_KEY, String(INSTALL_BANNER_REFRESH_DELAY));
      localStorage.removeItem("xpense_install_banner_dismissed");
    });

    return { banner, text, action };
  }

  function decrementInstallBannerCooldownOnRefresh() {
    const refreshesLeft = Number(localStorage.getItem(INSTALL_BANNER_REFRESH_COOLDOWN_KEY) || 0);
    if (refreshesLeft > 0) {
      localStorage.setItem(INSTALL_BANNER_REFRESH_COOLDOWN_KEY, String(refreshesLeft - 1));
    }
  }

  function shouldShowInstallBanner() {
    const refreshesLeft = Number(localStorage.getItem(INSTALL_BANNER_REFRESH_COOLDOWN_KEY) || 0);
    return refreshesLeft <= 0;
  }

  function setupInstallFlow() {
    decrementInstallBannerCooldownOnRefresh();
    const ui = createInstallBanner();
    installUi = ui;
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
          return;
        }

        showGenericInstallHelp();
      });
    }

    if (isIos && isSafari && !isStandaloneMode() && shouldShowInstallBanner()) {
      ui.text.textContent = 'Install Xpense: tap Share, then "Add to Home Screen".';
      ui.action.textContent = "How to install";
      ui.action.addEventListener("click", showIosInstallHelp);
      ui.banner.hidden = false;
    }

    renderInstallAvailability();
    updateInstallButtonVisibility();
  }

  function applyUpdate(worker) {
    if (!worker) return;
    worker.postMessage({ type: "SKIP_WAITING" });
  }

  function showUpdateToast(worker) {
    const existing = document.getElementById("pwa-update-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "pwa-update-toast";
    toast.innerHTML = `
      <span>New version available.</span>
      <button id="pwa-update-refresh" class="btn btn-small btn-primary" type="button">Refresh</button>
      <button id="pwa-update-later" class="btn btn-small btn-ghost" type="button">Later</button>
    `;
    document.body.appendChild(toast);

    const refreshBtn = toast.querySelector("#pwa-update-refresh");
    const laterBtn = toast.querySelector("#pwa-update-later");
    refreshBtn.addEventListener("click", () => {
      applyUpdate(worker);
    });
    laterBtn.addEventListener("click", () => {
      toast.remove();
    });

    if (updateTimer) window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(() => applyUpdate(worker), AUTO_APPLY_UPDATE_DELAY_MS);
  }

  async function fetchDeployVersion() {
    try {
      const response = await fetch("/api/api?action=build_info", {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;

      const data = await response.json();
      const deployVersion = String(data?.deploy_version || "").trim();
      return deployVersion || null;
    } catch {
      return null;
    }
  }

  function getSwBuildVersion(fetchedVersion) {
    if (fetchedVersion) return fetchedVersion;
    const rememberedVersion = localStorage.getItem(SW_BUILD_KEY);
    if (rememberedVersion) return rememberedVersion;
    return "dev";
  }

  async function registerVersionedServiceWorker(deployVersion) {
    const swBuildVersion = getSwBuildVersion(deployVersion);
    const registration = await navigator.serviceWorker.register(`/sw.js?build=${encodeURIComponent(swBuildVersion)}`, {
      scope: "/",
      updateViaCache: "none",
    });
    currentSwBuildVersion = swBuildVersion;
    localStorage.setItem(SW_BUILD_KEY, swBuildVersion);
    activeRegistration = registration;
    return registration;
  }

  async function onDeployVersionChanged(nextVersion) {
    const registration = await registerVersionedServiceWorker(nextVersion);
    const installing = registration.installing;
    if (installing) {
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateToast(registration.waiting || installing);
        }
      });
    }
    if (registration.waiting) {
      showUpdateToast(registration.waiting);
      return;
    }
    await registration.update();
    if (registration.waiting) {
      showUpdateToast(registration.waiting);
    }
  }

  async function checkDeploymentVersion() {
    try {
      const deployVersion = await fetchDeployVersion();
      if (!deployVersion) return;

      const previousVersion = localStorage.getItem(DEPLOY_VERSION_KEY);
      if (!previousVersion) {
        localStorage.setItem(DEPLOY_VERSION_KEY, deployVersion);
        if (!currentSwBuildVersion) {
          currentSwBuildVersion = deployVersion;
        }
        return;
      }

      if (previousVersion !== deployVersion) {
        localStorage.setItem(DEPLOY_VERSION_KEY, deployVersion);
        await onDeployVersionChanged(deployVersion);
      }
    } catch {
      // Ignore temporary network/server issues.
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    try {
      const deployVersion = await fetchDeployVersion();
      if (deployVersion) {
        localStorage.setItem(DEPLOY_VERSION_KEY, deployVersion);
      }
      const registration = await registerVersionedServiceWorker(deployVersion);

      // If no controller yet (first visit or after clear), wait for the SW
      // to activate and then reload once so clients.claim() takes effect.
      if (!navigator.serviceWorker.controller && !sessionStorage.getItem("sw_reload")) {
        sessionStorage.setItem("sw_reload", "1");
        const waitForActive = (sw) => {
          if (sw.state === "activated") {
            window.location.reload();
            return;
          }
          sw.addEventListener("statechange", () => {
            if (sw.state === "activated") {
              window.location.reload();
            }
          });
        };

        if (registration.active) {
          window.location.reload();
          return;
        } else if (registration.installing || registration.waiting) {
          waitForActive(registration.installing || registration.waiting);
          return;
        }
      } else {
        sessionStorage.removeItem("sw_reload");
      }

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
        if (activeRegistration) {
          activeRegistration.update().catch(() => {});
        }
      });

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          if (activeRegistration) {
            activeRegistration.update().catch(() => {});
          }
        }
      });

      window.setInterval(() => {
        if (activeRegistration) {
          activeRegistration.update().catch(() => {});
        }
      }, UPDATE_CHECK_INTERVAL_MS);

      checkDeploymentVersion().catch(() => {});
      deployCheckTimer = window.setInterval(() => {
        checkDeploymentVersion().catch(() => {});
      }, DEPLOY_CHECK_INTERVAL_MS);

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
    syncStandaloneClass();
    createOfflineIndicator();
    setupInstallFlow();
    registerServiceWorker();
    setupPwaDebug();
  });

  // Capture install prompt as early as possible (before DOMContentLoaded).
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
})();
