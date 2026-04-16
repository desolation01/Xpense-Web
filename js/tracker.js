const STORAGE_SALARY = "expense_tracker_salary";
const STORAGE_BUDGET = "expense_tracker_budget";
const STORAGE_WEEKLY_BUDGET = "expense_tracker_weekly_budget";
const STORAGE_ENTRIES = "expense_tracker_entries_v2";

const TRACKER_STORAGE_DEFAULTS = {
  [STORAGE_SALARY]: null,
  [STORAGE_BUDGET]: null,
  [STORAGE_WEEKLY_BUDGET]: null,
  [STORAGE_ENTRIES]: {},
};

const AUTH_TOKEN_KEY = "auth_token";
const AUTH_USER_KEY = "auth_username";
const MINI_PRIVACY_STATE_KEY = "xpense_mini_privacy_state_v1";
const HERO_PRIVACY_STATE_KEY = "xpense_hero_privacy_state_v1";

// --- SECURITY & CSRF ---
let csrfToken = null;
async function fetchCsrfToken() {
  if (csrfToken) return csrfToken;
  try {
    const r = await fetch("/api/api?action=token");
    const data = await r.json();
    if (data.token) csrfToken = data.token;
    return csrfToken;
  } catch (e) {
    return null;
  }
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}
function getAuthHeaders() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function redirectToLogin() {
  const next = encodeURIComponent("/expense-tracker");
  window.location.replace(`/tracker-login?next=${next}`);
}

async function hydrateFromLocalStore() {
  if (!window.localDataStore) return;

  try {
    await window.localDataStore.seedDefaults(TRACKER_STORAGE_DEFAULTS);

    const keys = [STORAGE_SALARY, STORAGE_BUDGET, STORAGE_WEEKLY_BUDGET, STORAGE_ENTRIES];
    for (const key of keys) {
      const idbValue = await window.localDataStore.getData(key);
      const localRaw = localStorage.getItem(key);

      if ((typeof idbValue === "undefined" || idbValue === null) && localRaw !== null) {
        const migrated = key === STORAGE_ENTRIES ? JSON.parse(localRaw || "{}") : Number(localRaw);
        if (key === STORAGE_ENTRIES) {
          await window.localDataStore.saveData(key, migrated && typeof migrated === "object" ? migrated : {});
        } else if (Number.isFinite(migrated)) {
          await window.localDataStore.saveData(key, migrated);
        }
        continue;
      }

      if (typeof idbValue !== "undefined") {
        if (idbValue === null) {
          localStorage.removeItem(key);
        } else if (key === STORAGE_ENTRIES) {
          localStorage.setItem(key, JSON.stringify(idbValue));
        } else {
          localStorage.setItem(key, String(idbValue));
        }
      }
    }
  } catch (error) {
    console.warn("Local store hydration failed, continuing with localStorage fallback.", error);
  }
}

function mirrorToPrimaryStore(key, value) {
  if (!window.localDataStore) return;

  if (value === null || typeof value === "undefined") {
    window.localDataStore.deleteData(key).catch(() => {});
    return;
  }

  window.localDataStore.saveData(key, value).catch(() => {});
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "--";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function parseMoney(s) {
  const cleaned = String(s).replace(/[^0-9.]/g, "");
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loadSalary() {
  const raw = localStorage.getItem(STORAGE_SALARY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function loadBudget() {
  const raw = localStorage.getItem(STORAGE_BUDGET);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function saveSalary(n) {
  if (!Number.isFinite(n)) {
    localStorage.removeItem(STORAGE_SALARY);
    mirrorToPrimaryStore(STORAGE_SALARY, null);
    return;
  }
  localStorage.setItem(STORAGE_SALARY, String(n));
  mirrorToPrimaryStore(STORAGE_SALARY, n);
}

function saveBudget(n) {
  if (!Number.isFinite(n)) {
    localStorage.removeItem(STORAGE_BUDGET);
    mirrorToPrimaryStore(STORAGE_BUDGET, null);
    return;
  }
  localStorage.setItem(STORAGE_BUDGET, String(n));
  mirrorToPrimaryStore(STORAGE_BUDGET, n);
}

function saveWeeklyBudget(n) {
  if (!Number.isFinite(n)) {
    localStorage.removeItem(STORAGE_WEEKLY_BUDGET);
    mirrorToPrimaryStore(STORAGE_WEEKLY_BUDGET, null);
    return;
  }
  localStorage.setItem(STORAGE_WEEKLY_BUDGET, String(n));
  mirrorToPrimaryStore(STORAGE_WEEKLY_BUDGET, n);
}

function loadWeeklyBudget() {
  const raw = localStorage.getItem(STORAGE_WEEKLY_BUDGET);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_ENTRIES);
    if (!raw) return {};
    let obj = JSON.parse(raw);

    // Ensure it's a standard object, not an array.
    if (Array.isArray(obj)) {
      const converted = {};
      Object.keys(obj).forEach(k => {
        if (isNaN(k)) converted[k] = obj[k];
      });
      return converted;
    }

    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveEntries(obj) {
  const safe = obj && typeof obj === "object" ? obj : {};
  localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(safe));
  mirrorToPrimaryStore(STORAGE_ENTRIES, safe);
}

async function main() {
  const salaryCard = document.getElementById("salaryCard");
  const calendarCard = document.getElementById("calendarCard");
  const trackerGrid = document.getElementById("trackerGrid");
  const chartCard = document.getElementById("chartCard");
  const salaryForm = document.getElementById("salaryForm");
  const salaryInput = document.getElementById("salaryInput");
  const budgetInput = document.getElementById("budgetInput");
  const weeklyBudgetInput = document.getElementById("weeklyBudgetInput");
  const salaryDisplay = document.getElementById("salaryDisplay");
  const budgetDisplay = document.getElementById("budgetDisplay");
  const weeklyBudgetDisplay = document.getElementById("weeklyBudgetDisplay");
  const remainingDisplay = document.getElementById("remainingDisplay");
  const editBudgetBtn = document.getElementById("editBudgetBtn");
  const resetBtn = document.getElementById("resetTrackerBtn");
  const syncBtn = document.getElementById("syncBtn");
  const loginOpenBtn = document.getElementById("loginOpenBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userStatus = document.getElementById("userStatus");
  const usernameDisplay = document.getElementById("usernameDisplay");
  const localModeBadge = document.getElementById("localModeBadge");
  const activeUsersIndicator = document.getElementById("activeUsersIndicator");
  const activeUsersCount = document.getElementById("activeUsersCount");
  const miniPrivacyButtons = Array.from(document.querySelectorAll("[data-mini-privacy-toggle]"));
  const heroPrivacyToggle = document.getElementById("heroPrivacyToggle");
  
  const trackerHeader = document.getElementById("trackerHeader");

  const monthLabel = document.getElementById("monthLabel");
  const daysGrid = document.getElementById("daysGrid");
  const prevBtn = document.getElementById("prevMonthBtn");
  const nextBtn = document.getElementById("nextMonthBtn");
  const todayBtn = document.getElementById("todayBtn");
  const monthSelect = document.getElementById("monthSelect");

  const searchInput = document.getElementById("searchInput");
  const exportBtn = document.getElementById("exportBtn");
  const exportJsonBtn = document.getElementById("exportJsonBtn");
  const importFile = document.getElementById("importFile");
  const importJsonFile = document.getElementById("importJsonFile");
  const weeklyBreakdownList = document.getElementById("weeklyBreakdownList");
  const monthlyTotalValue = document.getElementById("monthlyTotalValue");

  const navSalaryDisplay = document.getElementById("navSalaryDisplay");
  const navBudgetDisplay = document.getElementById("navBudgetDisplay");
  const navRemainingDisplay = document.getElementById("navRemainingDisplay");
  const trackerMain = document.getElementById("trackerMain");
  const trackerMainLayout = document.getElementById("trackerMainLayout");
  const activeMonthBadge = document.getElementById("activeMonthBadge");
  const savingsRateVal = document.getElementById("savingsRateVal");
  
  // Final Summary Elements
  const finalSummaryCard = document.getElementById("finalSummaryCard");
  const summaryTotalVal = document.getElementById("summaryTotalVal");
  const summaryMonthName = document.getElementById("summaryMonthName");
  const summaryTrendBadge = document.getElementById("summaryTrendBadge");
  const summaryTrendText = document.getElementById("summaryTrendText");
  const summaryDesc = document.getElementById("summaryDesc");
  const analyzeFinalBtn = document.getElementById("analyzeFinalBtn");
  
  let badgeMode = "percent"; // 'percent' or 'absolute'

  // Essential elements for app to start
  if (!salaryCard || !trackerGrid || !salaryForm || !salaryInput || !budgetInput || !trackerMain || !trackerMainLayout || !weeklyBudgetInput) {
    console.error("Critical tracker elements missing from HTML.");
    return;
  }

  await hydrateFromLocalStore();
  let entriesByDay = loadEntries();
  let salary = loadSalary();
  let budget = loadBudget();
  let weeklyBudget = loadWeeklyBudget();
  let viewDate = new Date();
  viewDate.setDate(1);
  let activeDateIso = null;
  let clearTargets = new Set();
  let isClearMode = false;
  let isDragging = false;
  let dragAction = "add"; // "add" or "remove"
  let chart = null;
  let currentChartType = "pie";
  let currentChartMetric = "all";
  let activeUsersPollTimer = null;
  let miniPrivacyState = {
    monthly: false,
    weekly: false,
    total: false,
  };
  let heroPrivacyMasked = false;

  const chartTypeSelect = document.getElementById("chartTypeSelect");
  const chartMetricSelect = document.getElementById("chartMetricSelect");
  const chartMetricLabel = document.getElementById("chartMetricLabel");

  const entryModal = document.getElementById("entryModal");
  const modalDateTitle = document.getElementById("modalDateTitle");
  const modalDaySummary = document.getElementById("modalDaySummary");
  const entryList = document.getElementById("entryList");
  const entryForm = document.getElementById("entryForm");
  const entryType = document.getElementById("entryType");
  const entryAmount = document.getElementById("entryAmount");
  const entryLabel = document.getElementById("entryLabel");
  const entryCategory = document.getElementById("entryCategory");
  const entryCategoryCustomWrap = document.getElementById("entryCategoryCustomWrap");
  const entryCategoryCustom = document.getElementById("entryCategoryCustom");
  const entryRecurring = document.getElementById("entryRecurring");

  const batchDeleteOpenBtn = document.getElementById("batchDeleteOpenBtn");
  const batchDeleteModal = document.getElementById("batchDeleteModal");
  const batchDeleteForm = document.getElementById("batchDeleteForm");
  const batchDeleteCategory = document.getElementById("batchDeleteCategory");
  const batchDeleteAmount = document.getElementById("batchDeleteAmount");
  const batchDeleteLabel = document.getElementById("batchDeleteLabel");

  const clearModeBtn = document.getElementById("clearModeBtn");
  const clearModeBtns = document.getElementById("clearModeBtns");
  const clearConfirmBtn = document.getElementById("clearConfirmBtn");
  const clearCancelBtn = document.getElementById("clearCancelBtn");
  const syncKeyInput = document.getElementById("syncKeyInput");

  if (chartTypeSelect) {
    chartTypeSelect.addEventListener("change", (e) => {
      currentChartType = e.target.value;
      if (chartMetricLabel) chartMetricLabel.style.display = currentChartType === "line" ? "block" : "none";
      updateChart();
    });
  }

  if (chartMetricSelect) {
    chartMetricSelect.addEventListener("change", (e) => {
      currentChartMetric = e.target.value;
      updateChart();
    });
  }

  const setAppVisible = () => {
    trackerHeader.style.display = "block";
    trackerMain.style.display = "block";
    setTimeout(() => {
      trackerHeader.classList.add("is-visible");
      trackerMain.classList.add("is-visible");
    }, 50);
  };

  function loadMiniPrivacyState() {
    try {
      const raw = localStorage.getItem(MINI_PRIVACY_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      miniPrivacyState = {
        monthly: Boolean(parsed?.monthly),
        weekly: Boolean(parsed?.weekly),
        total: Boolean(parsed?.total),
      };
    } catch {
      miniPrivacyState = { monthly: false, weekly: false, total: false };
    }
  }

  function saveMiniPrivacyState() {
    localStorage.setItem(MINI_PRIVACY_STATE_KEY, JSON.stringify(miniPrivacyState));
  }

  function maskValueText(value) {
    return String(value || "").replace(/[0-9]/g, "*");
  }

  function applyMiniCardMask(cardKey) {
    const card = document.querySelector(`[data-mini-card="${cardKey}"]`);
    if (!card) return;

    const isMasked = Boolean(miniPrivacyState[cardKey]);
    const targets = card.querySelectorAll("[data-maskable]");
    targets.forEach((target) => {
      if (isMasked) {
        const currentText = String(target.textContent || "");
        if (!currentText.includes("*")) {
          target.dataset.rawValue = currentText;
        }
        const baseValue = typeof target.dataset.rawValue === "string" ? target.dataset.rawValue : currentText;
        target.textContent = maskValueText(baseValue);
      } else if (String(target.textContent || "").includes("*") && typeof target.dataset.rawValue === "string") {
        target.textContent = target.dataset.rawValue;
      }
    });

    const toggle = card.querySelector("[data-mini-privacy-toggle]");
    if (toggle) {
      toggle.classList.toggle("is-masked", isMasked);
      toggle.setAttribute("aria-pressed", String(isMasked));
      toggle.setAttribute("title", isMasked ? "Show values" : "Hide values");
    }
  }

  function applyAllMiniCardMasks() {
    applyMiniCardMask("monthly");
    applyMiniCardMask("weekly");
    applyMiniCardMask("total");
  }

  function initMiniPrivacyToggles() {
    loadMiniPrivacyState();
    miniPrivacyButtons.forEach((button) => {
      const key = button.getAttribute("data-mini-privacy-toggle");
      if (!key) return;
      button.addEventListener("click", () => {
        miniPrivacyState[key] = !miniPrivacyState[key];
        saveMiniPrivacyState();
        applyMiniCardMask(key);
      });
    });
    applyAllMiniCardMasks();
  }

  function loadHeroPrivacyState() {
    heroPrivacyMasked = localStorage.getItem(HERO_PRIVACY_STATE_KEY) === "1";
  }

  function saveHeroPrivacyState() {
    localStorage.setItem(HERO_PRIVACY_STATE_KEY, heroPrivacyMasked ? "1" : "0");
  }

  function applyHeroMask() {
    const heroCard = document.querySelector("[data-hero-card='summary']");
    if (!heroCard) return;

    const targets = heroCard.querySelectorAll("[data-hero-maskable]");
    targets.forEach((target) => {
      if (heroPrivacyMasked) {
        const currentText = String(target.textContent || "");
        if (!currentText.includes("*")) {
          target.dataset.rawValue = currentText;
        }
        const baseValue = typeof target.dataset.rawValue === "string" ? target.dataset.rawValue : currentText;
        target.textContent = maskValueText(baseValue);
      } else if (String(target.textContent || "").includes("*") && typeof target.dataset.rawValue === "string") {
        target.textContent = target.dataset.rawValue;
      }
    });

    if (heroPrivacyToggle) {
      heroPrivacyToggle.classList.toggle("is-masked", heroPrivacyMasked);
      heroPrivacyToggle.setAttribute("aria-pressed", String(heroPrivacyMasked));
      heroPrivacyToggle.setAttribute("title", heroPrivacyMasked ? "Show values" : "Hide values");
    }
  }

  function initHeroPrivacyToggle() {
    loadHeroPrivacyState();
    if (heroPrivacyToggle) {
      heroPrivacyToggle.addEventListener("click", () => {
        heroPrivacyMasked = !heroPrivacyMasked;
        saveHeroPrivacyState();
        applyHeroMask();
      });
    }
    applyHeroMask();
  }

  function setLoggedOutUI() {
    if (localModeBadge) localModeBadge.style.display = "none";
    if (loginOpenBtn) loginOpenBtn.style.display = "inline-flex";
    if (userStatus) userStatus.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (syncBtn) syncBtn.style.display = "none";
    if (activeUsersIndicator) activeUsersIndicator.hidden = true;
    if (activeUsersPollTimer) clearInterval(activeUsersPollTimer);
    setAppVisible();
  }

  function setLoggedInUI(username) {
    if (localModeBadge) localModeBadge.style.display = "none";
    if (loginOpenBtn) loginOpenBtn.style.display = "none";
    if (userStatus) userStatus.style.display = "flex";
    if (logoutBtn) logoutBtn.style.display = "inline-flex";
    if (syncBtn) syncBtn.style.display = "inline-flex";
    if (usernameDisplay) usernameDisplay.textContent = username || localStorage.getItem(AUTH_USER_KEY) || "User";
    if (username) localStorage.setItem(AUTH_USER_KEY, username);
    if (activeUsersIndicator) activeUsersIndicator.hidden = false;
    setAppVisible();
  }

  function setActiveUsersCount(value) {
    if (!activeUsersCount) return;
    const safeCount = Number.isFinite(Number(value)) ? Math.max(1, Number(value)) : 1;
    activeUsersCount.textContent = String(safeCount);
  }

  async function refreshActiveUsersCount() {
    try {
      const authHeaders = getAuthHeaders();
      if (!authHeaders.Authorization) {
        if (activeUsersIndicator) activeUsersIndicator.hidden = true;
        return;
      }

      const response = await fetch(`/api/api?action=active_users&t=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...authHeaders,
        },
      });

      if (response.status === 401) {
        if (activeUsersIndicator) activeUsersIndicator.hidden = true;
        return;
      }
      if (!response.ok) return;

      const data = await response.json();
      setActiveUsersCount(data.active_users);
      if (activeUsersIndicator) activeUsersIndicator.hidden = false;
    } catch (error) {
      console.warn("Active user counter refresh failed.", error);
    }
  }

  function startActiveUsersPolling() {
    if (activeUsersPollTimer) clearInterval(activeUsersPollTimer);
    refreshActiveUsersCount();
    activeUsersPollTimer = setInterval(refreshActiveUsersCount, 10000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshActiveUsersCount();
      }
    });
    window.addEventListener("online", refreshActiveUsersCount);
  }

  function countEntries(entries) {
    return Object.values(entries || {}).reduce((sum, dayItems) => sum + (Array.isArray(dayItems) ? dayItems.length : 0), 0);
  }

  async function initialSync() {
    const authHeaders = getAuthHeaders();
    if (!authHeaders.Authorization) return;

    try {
      const response = await fetch("/api/api?action=sync", {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...authHeaders,
        },
      });

      if (response.status === 401) {
        clearAuthToken();
        setLoggedOutUI();
        return;
      }

      if (!response.ok) return;

      const data = await response.json();
      salary = Number.isFinite(Number(data.salary)) ? Number(data.salary) : null;
      budget = Number.isFinite(Number(data.budget)) ? Number(data.budget) : null;
      weeklyBudget = Number.isFinite(Number(data.weeklyBudget)) ? Number(data.weeklyBudget) : null;
      entriesByDay = data.entriesByDay && typeof data.entriesByDay === "object" ? data.entriesByDay : {};

      saveSalary(salary);
      saveBudget(budget);
      saveWeeklyBudget(weeklyBudget);
      saveEntries(entriesByDay);
    } catch (error) {
      console.warn("Initial sync skipped due to connection issue.", error);
    }
  }

  const triggerSync = async () => {
    const authHeaders = getAuthHeaders();
    if (!authHeaders.Authorization) return;

    try {
      const token = await fetchCsrfToken();
      if (!token) return;

      const response = await fetch("/api/api?action=sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          ...authHeaders,
        },
        body: JSON.stringify({
          salary,
          budget,
          weeklyBudget,
          entriesByDay,
          entriesCount: countEntries(entriesByDay),
        }),
      });

      if (response.status === 401) {
        clearAuthToken();
        setLoggedOutUI();
      }
    } catch (error) {
      console.warn("Background sync failed.", error);
    }
  };

  async function initializeAuthMode() {
    if (loginOpenBtn) {
      loginOpenBtn.addEventListener("click", () => {
        window.location.href = "/tracker-login";
      });
    }

    const authHeaders = getAuthHeaders();
    if (!authHeaders.Authorization) {
      redirectToLogin();
      return;
    }

    try {
      const response = await fetch("/api/api?action=status", {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...authHeaders,
        },
      });

      if (!response.ok) {
        clearAuthToken();
        redirectToLogin();
        return;
      }

      const data = await response.json();
      if (data.logged_in) {
        setLoggedInUI(data.username || localStorage.getItem(AUTH_USER_KEY) || "User");
        await initialSync();
      } else {
        clearAuthToken();
        redirectToLogin();
      }
    } catch (error) {
      console.warn("Auth status check failed.", error);
      redirectToLogin();
    }
  }

  await initializeAuthMode();
  initMiniPrivacyToggles();
  initHeroPrivacyToggle();
  startActiveUsersPolling();

  salaryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    let sVal = parseMoney(salaryInput.value);
    let bVal = parseMoney(budgetInput.value);
    let wbVal = parseMoney(weeklyBudgetInput.value);
    
    if (isNaN(sVal)) return;
    
    // Default budget to 0 if empty/invalid instead of failing silently
    if (isNaN(bVal)) bVal = 0;
    if (isNaN(wbVal)) wbVal = 0;

    if (bVal > sVal) {
      alert("Monthly budget cannot be greater than your monthly salary.");
      budgetInput.focus();
      return;
    }

    salary = sVal;
    budget = bVal;
    weeklyBudget = wbVal;
    
    saveSalary(salary);
    saveBudget(budget);
    saveWeeklyBudget(weeklyBudget);
    
    ensureSetupState();
    triggerSync();
  });

  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleString(undefined, { month: "long" })
  );

  function saveAndRefresh() {
    saveEntries(entriesByDay);
    renderCalendar();
    updateHeaderTotals();
    updateChart();
    updateRecentTransactions();
    triggerSync();
  }

  function updateHeaderTotals() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const monthExp = sumMonthExpenses(entriesByDay, y, m);
    const monthGain = sumMonthGains(entriesByDay, y, m);
    
    // Determine Current Week Logic
    const now = new Date();
    const isThisMonth = (now.getFullYear() === y && now.getMonth() === m);
    let weeklyExp = 0;
    
    if (isThisMonth) {
      const todayDate = now.getDate();
      const lastDay = new Date(y, m + 1, 0).getDate();
      const weeksArr = [
        { start: 1, end: 7 },
        { start: 8, end: 14 },
        { start: 15, end: 21 },
        { start: 22, end: 28 },
        { start: 29, end: lastDay }
      ];
      const currentWeek = weeksArr.find(w => todayDate >= w.start && todayDate <= w.end);
      if (currentWeek) {
        for (let d = currentWeek.start; d <= currentWeek.end; d++) {
          const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const dayItems = entriesByDay[iso] || [];
          weeklyExp += dayItems.reduce((acc, it) => acc + (it.type === "expense" ? it.amount : 0), 0);
        }
      }
    }

    const net = monthGain - monthExp;
    const rem = salary == null ? 0 : (salary + net);
    const monthBudgetRemain = budget ? (budget - monthExp) : 0;
    const weekBudgetRemain = weeklyBudget ? (weeklyBudget - weeklyExp) : 0;

    if (salaryDisplay) salaryDisplay.textContent = salary == null ? "--" : fmtMoney(salary);
    
    if (budgetDisplay) {
      budgetDisplay.textContent = budget ? fmtMoney(monthBudgetRemain) : "--";
      budgetDisplay.classList.toggle("negative", budget && monthBudgetRemain < 0);
    }
    
    if (weeklyBudgetDisplay) {
      weeklyBudgetDisplay.textContent = weeklyBudget ? fmtMoney(weekBudgetRemain) : "--";
      weeklyBudgetDisplay.classList.toggle("negative", weeklyBudget && weekBudgetRemain < 0);
    }

    if (remainingDisplay) {
      remainingDisplay.textContent = fmtMoney(rem);
      remainingDisplay.classList.toggle("negative", rem < 0);
    }
    
    const monthExpDisplayHero = document.getElementById("monthExpDisplayHero");
    const weekExpDisplayHero = document.getElementById("weekExpDisplayHero");
    if (monthExpDisplayHero) {
      monthExpDisplayHero.textContent = fmtMoney(monthExp);
    }
    if (weekExpDisplayHero) {
      weekExpDisplayHero.textContent = fmtMoney(weeklyExp);
    }

    // ── New C2 Hero Banner displays ──
    const _heroBudgetBar = document.getElementById('heroBudgetBar');
    const _heroSpentLabel = document.getElementById('heroSpentLabel');
    const _heroPctLabel = document.getElementById('heroPctLabel');
    const _savingsDisplay = document.getElementById('savingsDisplay');
    const _totalSpentDisplay = document.getElementById('totalSpentDisplay');
    const _weekBudgetMiniDisplay = document.getElementById('weekBudgetMiniDisplay');
    const _weekBudgetBar = document.getElementById('weekBudgetBar');
    const _weekSpentLabel = document.getElementById('weekSpentLabel');
    const _weekPctLabel = document.getElementById('weekPctLabel');

    if (_heroBudgetBar || _heroSpentLabel || _heroPctLabel || _savingsDisplay || _totalSpentDisplay || _weekBudgetMiniDisplay) {
      const _pct = budget > 0 ? Math.min(100, Math.round((monthExp / budget) * 100)) : 0;
      if (_heroBudgetBar) _heroBudgetBar.style.width = _pct + '%';
      if (_heroSpentLabel) _heroSpentLabel.textContent = fmtMoney(monthExp) + ' spent';
      if (_heroPctLabel) _heroPctLabel.textContent = _pct + '% used';
      if (_savingsDisplay) {
        _savingsDisplay.textContent = fmtMoney(monthBudgetRemain);
        _savingsDisplay.classList.toggle("negative", monthBudgetRemain < 0);
      }
      if (_totalSpentDisplay) {
        let lifetimeSpent = 0;
        for (const items of Object.values(entriesByDay)) {
          items.forEach(it => { if (it.type === "expense") lifetimeSpent += it.amount; });
        }
        _totalSpentDisplay.textContent = fmtMoney(lifetimeSpent);
      }
      if (_weekBudgetMiniDisplay) {
        _weekBudgetMiniDisplay.textContent = weeklyBudget ? fmtMoney(weekBudgetRemain) : "--";
        _weekBudgetMiniDisplay.classList.toggle("negative", weekBudgetRemain < 0);
      }
      const _weekPct = weeklyBudget > 0 ? Math.min(100, Math.round((weeklyExp / weeklyBudget) * 100)) : 0;
      if (_weekBudgetBar) _weekBudgetBar.style.width = _weekPct + '%';
      if (_weekSpentLabel) _weekSpentLabel.textContent = fmtMoney(weeklyExp) + ' spent';
      if (_weekPctLabel) _weekPctLabel.textContent = _weekPct + '% used';
    }
    applyAllMiniCardMasks();
    applyHeroMask();
  }

  function sumMonthExpenses(entries, year, month) {
    let sum = 0;
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    for (const [date, items] of Object.entries(entries)) {
      if (date.startsWith(prefix)) {
        items.forEach(it => { if (it.type === "expense") sum += it.amount; });
      }
    }
    return sum;
  }

  function sumMonthGains(entries, year, month) {
    let sum = 0;
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    for (const [date, items] of Object.entries(entries)) {
      if (date.startsWith(prefix)) {
        items.forEach(it => { if (it.type === "gain") sum += it.amount; });
      }
    }
    return sum;
  }

  function updateChart() {
    const chartEl = document.getElementById("categoryChart");
    if (!chartEl) return;
    const ctx = chartEl.getContext("2d");
    if (chart) {
      chart.destroy();
      chart = null;
    }

    if (typeof Chart === "undefined") {
      console.warn("Chart.js not loaded. Skipping chart rendering.");
      renderWeeklyBreakdown();
      return;
    }

    try {
      if (currentChartType === "pie") {
        renderPieChart(ctx);
      } else {
        renderTrendChart(ctx);
      }
    } catch (err) {
      console.error("Error rendering chart:", err);
    }
    
    // Always render weekly breakdown regardless of chart success
    renderWeeklyBreakdown();
  }

  function getThemeColor(tokenName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
    return value || fallback;
  }

  function isLightThemeActive() {
    return document.documentElement.getAttribute("data-theme") === "light";
  }

  function renderPieChart(ctx) {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;

    const totals = {};
    for (const [date, items] of Object.entries(entriesByDay)) {
      if (date.startsWith(prefix)) {
        items.forEach(it => {
          if (it.type === "expense") {
            totals[it.category] = (totals[it.category] || 0) + it.amount;
          }
        });
      }
    }

    const labels = Object.keys(totals);
    const data = Object.values(totals);

    if (labels.length === 0) return;

    const isLightTheme = isLightThemeActive();
    const legendColor = getThemeColor("--color-background-foreground", isLightTheme ? "#263143" : "#F8FAFC");
    const piePalette = isLightTheme
      ? ["#6f8199", "#7ca18f", "#bd7d86", "#8a97bb", "#9d8cb5", "#8fa0ac", "#b59e7f", "#829ec4"]
      : ["#7c5cff", "#5ae4ff", "#ff4d6d", "#2dd4bf", "#facc15", "#8b5cf6", "#ec4899", "#3b82f6"];

    chart = new Chart(ctx, {
      type: "pie",
      plugins: [ChartDataLabels],
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: piePalette
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: legendColor } },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.parsed;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const pct = ((val / total) * 100).toFixed(1) + "%";
                return ` ${context.label}: ${fmtMoney(val)} (${pct})`;
              }
            }
          },
          datalabels: {
            display: !isLightTheme,
            color: isLightTheme ? "#2b3648" : "#fff",
            formatter: (value, ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((value / total) * 100).toFixed(1) + "%";
              return pct;
            },
            font: { weight: 'bold' }
          }
        }
      }
    });
  }

  function renderTrendChart(ctx) {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const labels = Array.from({ length: lastDay }, (_, i) => String(i + 1));
    
    const datasets = [];
    const metric = currentChartMetric;

    // Build data arrays
    const dailyExpenses = new Array(lastDay).fill(0);
    const dailyGains = new Array(lastDay).fill(0);
    
    for (let d = 1; d <= lastDay; d++) {
      const dIso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const items = entriesByDay[dIso] || [];
      items.forEach(it => {
        if (it.type === "expense") dailyExpenses[d - 1] += it.amount;
        else if (it.type === "gain") dailyGains[d - 1] += it.amount;
      });
    }

    // Cumulative sums
    const cumExpenses = [];
    const cumGains = [];
    const cumBalance = [];
    let curExp = 0, curGain = 0;
    
    for (let i = 0; i < lastDay; i++) {
      curExp += dailyExpenses[i];
      curGain += dailyGains[i];
      cumExpenses.push(curExp);
      cumGains.push(curGain);
      cumBalance.push((salary || 0) + curGain - curExp);
    }

    const isLightTheme = isLightThemeActive();
    const axisColor = getThemeColor("--color-muted-foreground", "#5f6d80");
    const gridColor = isLightTheme ? "rgba(95, 109, 128, 0.14)" : "rgba(0,0,0,0.05)";
    const legendColor = getThemeColor("--color-background-foreground", isLightTheme ? "#263143" : "#F8FAFC");

    const colors = {
      expense: { stroke: isLightTheme ? "#b35f69" : "#ff4d6d", fill: isLightTheme ? "rgba(179,95,105,0.14)" : "rgba(255,77,109,0.2)" },
      gain: { stroke: isLightTheme ? "#4b8f71" : "#2dd4bf", fill: isLightTheme ? "rgba(75,143,113,0.14)" : "rgba(45,212,191,0.2)" },
      budget: { stroke: isLightTheme ? "#ab8742" : "#facc15", fill: isLightTheme ? "rgba(171,135,66,0.16)" : "rgba(250,204,21,0.2)" },
      balance: { stroke: isLightTheme ? "#6a79a7" : "#7c5cff", fill: isLightTheme ? "rgba(106,121,167,0.15)" : "rgba(124,92,255,0.2)" }
    };

    if (metric === "expense" || metric === "all") {
      datasets.push({
        label: "Daily Expense",
        data: dailyExpenses,
        borderColor: colors.expense.stroke,
        backgroundColor: colors.expense.fill,
        fill: true,
        tension: 0.1
      });
    }
    if (metric === "gain" || metric === "all") {
      datasets.push({
        label: "Daily Gain",
        data: dailyGains,
        borderColor: colors.gain.stroke,
        backgroundColor: colors.gain.fill,
        fill: true,
        tension: 0.1
      });
    }
    if (metric === "budget" || metric === "all") {
      const cumBudgetRemaining = cumExpenses.map((exp, i) => (budget || 0) + cumGains[i] - exp);
      datasets.push({
        label: "Remaining Budget",
        data: cumBudgetRemaining,
        borderColor: colors.budget.stroke,
        backgroundColor: colors.budget.fill,
        fill: true,
        tension: 0.3
      });
    }
    if (metric === "balance" || metric === "all") {
      datasets.push({
        label: "Remaining Balance",
        data: cumBalance,
        borderColor: colors.balance.stroke,
        backgroundColor: colors.balance.fill,
        fill: true,
        tension: 0.3
      });
    }

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: axisColor } },
          y: { grid: { color: gridColor }, ticks: { color: axisColor, callback: value => "PHP " + value.toLocaleString() } }
        },
        plugins: {
          legend: { position: "top", labels: { color: legendColor } },
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.dataset.label}: ${fmtMoney(context.parsed.y)}`
            }
          },
          datalabels: { display: false }
        }
      }
    });
  }

  function renderWeeklyBreakdown() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const monthName = viewDate.toLocaleString(undefined, { month: "short" });
    const lastDay = new Date(y, m + 1, 0).getDate();
    
    if (activeMonthBadge) {
      activeMonthBadge.textContent = viewDate.toLocaleString(undefined, { month: "long" });
    }

    weeklyBreakdownList.innerHTML = "";
    
    // Define weeks
    const weeks = [
      { start: 1, end: 7, label: "Week 1" },
      { start: 8, end: 14, label: "Week 2" },
      { start: 15, end: 21, label: "Week 3" },
      { start: 22, end: 28, label: "Week 4" },
      { start: 29, end: lastDay, label: "Week 5" }
    ].filter(w => w.start <= lastDay);

    // Calculate totals
    let monthlyExp = 0;
    let monthlyGain = 0;
    const weekTotals = [];

    // First pass: get all week totals
    weeks.forEach(w => {
      let weekExp = 0;
      for (let d = w.start; d <= w.end; d++) {
        const dIso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const items = entriesByDay[dIso] || [];
        items.forEach(it => { 
          if (it.type === "expense") weekExp += it.amount; 
          else if (it.type === "gain") monthlyGain += it.amount;
        });
      }
      weekTotals.push(weekExp);
      monthlyExp += weekExp;
    });

    const avgWeek = monthlyExp / weekTotals.length || 0;

    // Second pass: render
    weeks.forEach((w, idx) => {
      const exp = weekTotals[idx];
      const diff = avgWeek > 0 ? ((exp - avgWeek) / avgWeek) * 100 : 0;
      
      let changeClass = "neutral";
      let changeText = "at avg";
      if (diff > 1) {
        changeClass = "up";
        changeText = `+${diff.toFixed(0)}% vs avg`;
      } else if (diff < -1) {
        changeClass = "down";
        changeText = `${diff.toFixed(0)}% vs avg`;
      }

      const item = document.createElement("div");
      item.className = "weekly-item";
      item.innerHTML = `
        <div class="weekly-badge">${String(idx + 1).padStart(2, '0')}</div>
        <div class="weekly-info">
          <span class="weekly-label">${w.label}</span>
          <span class="weekly-dates">${monthName} ${String(w.start).padStart(2, '0')} - ${monthName} ${String(w.end).padStart(2, '0')}</span>
        </div>
        <div class="weekly-stats">
          <span class="weekly-amount">${fmtMoney(exp)}</span>
          <span class="weekly-change ${changeClass}">${changeText}</span>
        </div>
      `;
      weeklyBreakdownList.appendChild(item);
    });

    // Savings Rate
    const totalIncome = (salary || 0) + monthlyGain;
    const savings = totalIncome - monthlyExp;
    const rate = totalIncome > 0 ? (savings / totalIncome) * 100 : 0;

    if (savingsRateVal) {
      savingsRateVal.textContent = (rate > 0 ? rate.toFixed(1) : "0") + "%";
      savingsRateVal.style.color = "#ffffff";
    }

    updateFinalSummary(monthlyExp, y, m);
  }

  function updateRecentTransactions() {
    const listEl = document.getElementById("recentTransactionsList");
    const avgEl = document.getElementById("dailyAvgVal");
    const badgeEl = document.getElementById("currentMonthBadge");
    if (!listEl) return;

    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const monthName = viewDate.toLocaleString(undefined, { month: "long" }).toUpperCase();
    if (badgeEl) badgeEl.textContent = monthName;

    const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;
    const allRecent = [];
    const spendingDays = new Set();
    const gainDays = new Set();
    let monthTotalExp = 0;
    let monthTotalGain = 0;

    for (const [date, items] of Object.entries(entriesByDay)) {
      if (date.startsWith(prefix)) {
        let hasDayExpense = false;
        let hasDayGain = false;
        items.forEach(it => {
          if (it.type === "expense") {
            monthTotalExp += it.amount;
            hasDayExpense = true;
          } else if (it.type === "gain") {
            monthTotalGain += it.amount;
            hasDayGain = true;
          }
          allRecent.push({ ...it, date });
        });
        if (hasDayExpense) spendingDays.add(date);
        if (hasDayGain) gainDays.add(date);
      }
    }

    // Daily average calculations by type.
    const dailyAvgExpense = spendingDays.size > 0 ? (monthTotalExp / spendingDays.size) : 0;
    const dailyAvgGain = gainDays.size > 0 ? (monthTotalGain / gainDays.size) : 0;
    if (avgEl) avgEl.textContent = fmtMoney(dailyAvgExpense);

    // Sort by timestamp or date descending
    allRecent.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const latest = allRecent.slice(0, 5);

    const EMOJIS = {
      "Food": "🍔", "Transport": "🚗", "Rent": "🏠", "Bills": "💳",
      "Entertainment": "🎬", "Health": "🏥", "Salary": "💰", "General": "📦", "Other": "📦"
    };

    listEl.innerHTML = latest.map(it => {
      const safeCategory = escapeHtml(it.category || "Other");
      const safeLabel = escapeHtml(it.label || "Entry");
      const emoji = EMOJIS[it.category] || "💸";
      const typeAvg = it.type === "gain" ? dailyAvgGain : dailyAvgExpense;
      const diff = typeAvg > 0 ? ((it.amount - typeAvg) / typeAvg) * 100 : 0;
      const diffText = typeAvg > 0
        ? `${diff > 0 ? "+" : ""}${diff.toFixed(0)}% vs ${it.type} avg`
        : `No ${it.type} avg`;
      const diffClass = diff === 0
        ? "neutral"
        : (it.type === "gain"
          ? (diff > 0 ? "down" : "up")
          : (diff > 0 ? "up" : "down"));
      const amountClass = it.type === "gain" ? "gain" : "expense";
      const amountPrefix = it.type === "gain" ? "+" : "-";
      
      const dateObj = new Date(it.date);
      const dateStr = dateObj.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" });

      return `
        <div class="transaction-item">
          <div class="transaction-icon-box">${emoji}</div>
          <div class="transaction-info">
            <span class="transaction-category">${safeCategory}</span>
            <span class="transaction-label">${safeLabel}</span>
            <span class="transaction-date">${dateStr}</span>
          </div>
          <div class="transaction-stats">
            <span class="transaction-amount ${amountClass}">${amountPrefix}${fmtMoney(it.amount)}</span>
            <span class="transaction-comparison ${diffClass}">${diffText}</span>
          </div>
        </div>
      `;
    }).join("");

    if (latest.length === 0) {
      listEl.innerHTML = `<p class="card-p" style="text-align:center; opacity:0.6;">No recent transactions.</p>`;
    }
  }

  function updateFinalSummary(currentTotal, y, m) {
    if (!finalSummaryCard || !summaryMonthName || !summaryTotalVal || !summaryTrendBadge || !summaryTrendText) return;

    // Previous Month Total
    const prevDate = new Date(y, m - 1, 1);
    const prevY = prevDate.getFullYear();
    const prevM = prevDate.getMonth();
    const prevTotal = sumMonthExpenses(entriesByDay, prevY, prevM);

    summaryMonthName.textContent = viewDate.toLocaleString(undefined, { month: "long", year: "numeric" });
    summaryTotalVal.textContent = new Intl.NumberFormat("en-US").format(Math.floor(currentTotal));
    
    // Check for decimals (if any)
    const decimals = (currentTotal % 1).toFixed(2).substring(2);
    const decimalEl = finalSummaryCard.querySelector(".summary-decimal");
    if (decimalEl) decimalEl.textContent = "." + decimals;

    // Trend Calculation
    const diff = currentTotal - prevTotal;
    const percent = prevTotal > 0 ? (diff / prevTotal) * 100 : 0;

    summaryTrendBadge.className = "trend-badge";
    if (diff > 0) {
      summaryTrendBadge.classList.add("up");
    } else if (diff < 0) {
      summaryTrendBadge.classList.add("down");
    } else {
      summaryTrendBadge.classList.add("neutral");
    }

    updateTrendBadgeText(diff, percent);
    updateOfflineSummary(currentTotal, y, m);

    // Budget Warning Glow
    finalSummaryCard.classList.remove("budget-warning", "budget-critical");
    if (budget > 0) {
      const usage = currentTotal / budget;
      if (usage >= 1) {
        finalSummaryCard.classList.add("budget-critical");
      } else if (usage >= 0.8) {
        finalSummaryCard.classList.add("budget-warning");
      }
    }
  }

  function updateTrendBadgeText(diff, percent) {
    if (badgeMode === "percent") {
      summaryTrendText.textContent = `${Math.abs(percent).toFixed(1)}% ${diff >= 0 ? 'Increase' : 'Decrease'} vs Last Month`;
    } else {
      summaryTrendText.textContent = `${fmtMoney(Math.abs(diff))} ${diff >= 0 ? 'more' : 'less'} than Last Month`;
    }
  }

  function updateOfflineSummary(currentTotal, y, m) {
    if (!summaryDesc) return;
    
    // Only update if not currently typing or loading AI summary
    if (summaryDesc.classList.contains("is-typing") || summaryDesc.classList.contains("is-loading")) return;

    const monthName = viewDate.toLocaleString(undefined, { month: "long" });
    const budgetPct = budget > 0 ? (currentTotal / budget * 100).toFixed(1) : 0;
    const salaryPct = salary > 0 ? (currentTotal / salary * 100).toFixed(1) : 0;

    let text = `For <b>${monthName} ${y}</b>, you've spent a total of <span class="summary-highlight">${fmtMoney(currentTotal)}</span>. `;
    
    if (budget > 0) {
      if (currentTotal > budget) {
        text += `You are <b>${(currentTotal - budget).toFixed(0)}</b> over your budget (<b>${budgetPct}%</b> utilization). `;
      } else {
        text += `You've used <b>${budgetPct}%</b> of your <b>${fmtMoney(budget)}</b> budget. `;
      }
    }

    if (salary > 0) {
      text += `This accounts for <b>${salaryPct}%</b> of your monthly salary. `;
    }

    text += `<br><br><i>Click "Analyze Financials" for a deeper AI-powered breakdown and smart saving tips.</i>`;
    summaryDesc.innerHTML = text;
  }

  function sumMonthExpenses(data, y, m) {
    let total = 0;
    const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;
    for (const [date, items] of Object.entries(data)) {
      if (date.startsWith(prefix)) {
        items.forEach(it => { if (it.type === "expense") total += it.amount; });
      }
    }
    return total;
  }

  if (summaryTrendBadge) {
    summaryTrendBadge.addEventListener("click", () => {
      badgeMode = badgeMode === "percent" ? "absolute" : "percent";
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      const currentItems = sumMonthExpenses(entriesByDay, y, m);
      const prevDate = new Date(y, m - 1, 1);
      const prevTotal = sumMonthExpenses(entriesByDay, prevDate.getFullYear(), prevDate.getMonth());
      updateTrendBadgeText(currentItems - prevTotal, prevTotal > 0 ? ((currentItems - prevTotal) / prevTotal) * 100 : 0);
    });
  }

  async function generateFinancialSummary() {
    if (!analyzeFinalBtn || !summaryDesc) return;

    analyzeFinalBtn.disabled = true;
    analyzeFinalBtn.innerHTML = "Analyzing...";
    summaryDesc.classList.add("is-loading");
    summaryDesc.innerHTML = "";

    try {
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      const monthName = viewDate.toLocaleString(undefined, { month: "long" });
      
      // Build Data Context
      const categoryMap = {};
      let maxDayVal = 0;
      let maxDayStr = "";
      let total = 0;

      const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;
      for (const [date, items] of Object.entries(entriesByDay)) {
        if (date.startsWith(prefix)) {
          let daySum = 0;
          items.forEach(it => {
            if (it.type === "expense") {
              total += it.amount;
              daySum += it.amount;
              categoryMap[it.category] = (categoryMap[it.category] || 0) + it.amount;
            }
          });
          if (daySum > maxDayVal) {
            maxDayVal = daySum;
            maxDayStr = date;
          }
        }
      }

	      const topCategory = Object.entries(categoryMap).sort((a, b) => b[1] - a[1])[0] || ["N/A", 0];
	      const topCategoryAmount = Number(topCategory[1] || 0);
	      const totalSpentText = total.toLocaleString("en-US", { maximumFractionDigits: 2 });
	      const topCategoryText = topCategoryAmount.toLocaleString("en-US", { maximumFractionDigits: 2 });
	      const maxDaySpentText = maxDayVal.toLocaleString("en-US", { maximumFractionDigits: 2 });
	      const monthlyBudgetText = Number.isFinite(budget) ? Number(budget).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "Not set";
	      const monthlySalaryText = Number.isFinite(salary) ? Number(salary).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "Not set";
	      
	      const prompt = `
	        Analyze my ${monthName} ${y} financials in detail:
	        - Total Spent: PHP ${totalSpentText}
	        - Top Category: ${topCategory[0]} (PHP ${topCategoryText})
	        - Highest Spending Day: ${maxDayStr || "N/A"} (PHP ${maxDaySpentText})
	        - Monthly Budget: PHP ${monthlyBudgetText}
	        - Monthly Salary: PHP ${monthlySalaryText}

        Provide a structured financial review:
        1. Performance Summary: Include specific percentages (e.g., "% of budget utilized", "% of salary spent", and "Top category share %").
        2. Spending Insights: Mention the impact of the highest spending day.
        3. Smart Tips: Provide exactly 3 distinct, actionable "Smart Tips" to improve financial health for next month.

        CRITICAL FORMATTING: 
        1. Use NO markdown (no **). 
        2. Wrap all amounts (PHP, percentages (%), dates (YYYY-MM-DD), and the words "Smart Tip:" in <b> tags.
        3. Use <br><br> to separate the summary section from the tips section.
        4. Keep the total response under 6 sentences plus the 3 tips.
      `;

      const token = await fetchCsrfToken();
      const res = await fetch("/api/api?action=chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await res.json();
      const result = data.content || "I couldn't analyze the data right now. Please try again later.";
      
      summaryDesc.classList.remove("is-loading");
      summaryDesc.classList.add("is-typing");
      
      // Multi-layer formatting for robustness
      let formattedResult = result
        .replace(/\*\*\s*(.*?)\s*\*\*/g, '<b>$1</b>') // Robust ** bolding
        .replace(/"(.*?)"/g, '<b>"$1"</b>')           // Bold any quoted text
        .replace(/(₱\s*[0-9,.]+)/g, '<span class="summary-highlight">$1</span>') // Highlighting amounts
        .replace(/(\d+%\s*)/g, '<b>$1</b>')          // Bold percentages
        .replace(/(\d{4}-\d{2}-\d{2})/g, '<b>$1</b>'); // Bold dates

      const safeSummary = sanitizeLimitedHtml(formattedResult);
      summaryDesc.innerHTML = safeSummary;
      summaryDesc.classList.remove("is-typing");

    } catch (err) {
      console.error(err);
      summaryDesc.classList.remove("is-loading");
      summaryDesc.textContent = "Error connecting to AI assistant. Ensure server is online.";
    } finally {
      analyzeFinalBtn.disabled = false;
      analyzeFinalBtn.innerHTML = "<span class='ai-spark'>AI</span> Analyze Financials";
    }
  }

  analyzeFinalBtn.addEventListener("click", () => generateFinancialSummary());

  function renderCalendar() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const monthName = viewDate.toLocaleString(undefined, { month: "long", year: "numeric" });
    monthLabel.textContent = monthName;
    monthSelect.value = String(m);

    daysGrid.innerHTML = "";
    const first = new Date(y, m, 1);
    const startDay = first.getDay();
    const gridStart = new Date(y, m, 1 - startDay);
    const todayIso = isoDate(new Date());

    const searchQuery = searchInput.value.toLowerCase();

    let maxAbsNet = 0;
    for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        const dIso = isoDate(d);
        let items = entriesByDay[dIso] || [];
        if (searchQuery) {
            items = items.filter(it =>
                it.label.toLowerCase().includes(searchQuery) ||
                it.category.toLowerCase().includes(searchQuery)
            );
        }
        const net = items.reduce((acc, it) => acc + (it.type === "gain" ? it.amount : -it.amount), 0);
        if (Math.abs(net) > maxAbsNet) maxAbsNet = Math.abs(net);
    }

    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const dIso = isoDate(d);
      const inMonth = d.getMonth() === m;
      const isToday = dIso === todayIso;

      let items = entriesByDay[dIso] || [];
      if (searchQuery) {
        items = items.filter(it =>
          it.label.toLowerCase().includes(searchQuery) ||
          it.category.toLowerCase().includes(searchQuery)
        );
      }

      const net = items.reduce((acc, it) => acc + (it.type === "gain" ? it.amount : -it.amount), 0);
      const btn = createDayButton({
        dateObj: d,
        inMonth,
        isToday,
        dayNet: net,
        maxAbsNet,
        hasEntries: items.length > 0
      });

      if (isClearMode && clearTargets.has(dIso)) {
        btn.classList.add("is-clear-target");
      }

      if (searchQuery && items.length === 0) btn.style.opacity = "0.2";

      daysGrid.appendChild(btn);
    }
    updateHeaderTotals();
  }

  function createDayButton({ dateObj, inMonth, isToday, dayNet, maxAbsNet, hasEntries = false }) {
    const btn = document.createElement("button");
    const hasNonZeroNet = dayNet !== 0;
    btn.type = "button";
    btn.className = `tracker-day${inMonth ? "" : " is-out"}${isToday ? " is-today" : ""}${hasNonZeroNet ? " has-expense" : ""}${hasEntries ? " has-entry" : ""}`;
    btn.dataset.date = isoDate(dateObj);
    btn.setAttribute("role", "gridcell");

    if (maxAbsNet && maxAbsNet > 0 && dayNet !== 0) {
      const pct = (Math.abs(dayNet) / maxAbsNet) * 100;
      const color = dayNet > 0 ? "rgba(34, 197, 94, 0.4)" : "rgba(239, 68, 68, 0.4)";
      btn.style.background = `linear-gradient(to top, ${color} ${pct}%, transparent ${pct}%)`;
      btn.style.backgroundSize = "100% 100%";
    }

    const top = document.createElement("div");
    top.className = "tracker-day-top";
    top.textContent = String(dateObj.getDate());

    const bottom = document.createElement("div");
    bottom.className = "tracker-day-bottom";
    if (dayNet > 0) {
      bottom.textContent = `+${fmtMoney(dayNet)}`;
      bottom.classList.add("is-gain");
    } else if (dayNet < 0) {
      bottom.textContent = `-${fmtMoney(Math.abs(dayNet))}`;
    } else if (hasEntries) {
      bottom.textContent = "BREAKEVEN";
      bottom.classList.add("is-breakeven");
    }

    btn.appendChild(top);
    btn.appendChild(bottom);
    return btn;
  }

  function ensureSetupState() {
    const hasSalary = salary != null && Number.isFinite(salary);
    salaryCard.hidden = hasSalary;
    trackerMainLayout.hidden = !hasSalary;
    trackerGrid.classList.toggle("is-ready", hasSalary);
    if (hasSalary) {
      renderCalendar();
      updateChart();
      updateRecentTransactions();
    }
  }

  searchInput.addEventListener("input", () => renderCalendar());

  exportBtn.addEventListener("click", () => {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const monthName = viewDate.toLocaleString(undefined, { month: "long", year: "numeric" });
    
    // Calculate Monthly Totals for header
    const monthExp = sumMonthExpenses(entriesByDay, y, m);
    const monthGain = sumMonthGains(entriesByDay, y, m);
    const net = monthGain - monthExp;
    const rem = salary == null ? 0 : (salary + net);
    
    let html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <style>
          table { border-collapse: collapse; width: 100%; border: 1px solid #000; font-family: sans-serif; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; font-weight: bold; }
          .summary-header { background-color: #1a1a1a; color: #ffffff; font-weight: bold; }
          .summary-val { background-color: #f9f9f9; font-weight: bold; }
          .date-row { background-color: #fafafa; font-weight: bold; }
          .is-gain { color: #2dd4bf; }
          .is-expense { color: #ff4d6d; }
          .negative { color: #ff4d6d; }
        </style>
      </head>
      <body>
        <h2>Monthly Report: ${monthName}</h2>
        <table>
          <tr class="summary-header">
            <th>Salary</th>
            <th>Budget</th>
            <th>Total Gains</th>
            <th>Total Expenses</th>
            <th>Net</th>
            <th>Remaining Balance</th>
          </tr>
          <tr class="summary-val">
            <td>${salary || 0}</td>
            <td>${budget || 0}</td>
            <td>${monthGain}</td>
            <td>${monthExp}</td>
            <td class="${net < 0 ? 'negative' : ''}">${net}</td>
            <td class="${rem < 0 ? 'negative' : ''}">${rem}</td>
          </tr>
        </table>
        <br>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Label</th>
              <th>Category</th>
              <th>Type</th>
              <th>Amount (PHP)</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    const lastDay = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const dateIso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const items = entriesByDay[dateIso] || [];
      
      if (items.length > 0) {
        items.forEach((it, idx) => {
          html += `
            <tr>
              ${idx === 0 ? `<td rowspan="${items.length}">${dateIso}</td>` : ''}
              <td>${it.label}</td>
              <td>${it.category}</td>
              <td class="is-${it.type}">${it.type}</td>
              <td class="is-${it.type}">${it.type === 'gain' ? '+' : '-'}${it.amount}</td>
            </tr>
          `;
        });
      } else {
        html += `
          <tr>
            <td>${dateIso}</td>
            <td colspan="3" style="color: #ccc; text-align: center;">--- No activity ---</td>
            <td>0</td>
          </tr>
        `;
      }
    }
    
    html += `
          </tbody>
        </table>
      </body>
      </html>
    `;
    
    // Use application/vnd.ms-excel so it opens in Excel directly
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${monthName.replace(/\s/g, "_")}.xls`;
    a.click();
  });

  importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const rows = event.target.result.split("\n").slice(1);
      rows.forEach(row => {
        const [date, label, cat, type, amount] = row.split(",").map(s => s?.trim().replace(/^"|"$/g, ""));
        if (!date || !amount) return;
        if (!entriesByDay[date]) entriesByDay[date] = [];
        entriesByDay[date].push({
          label: label || "Imported",
          category: cat || "Other",
          type: type === "gain" ? "gain" : "expense",
          amount: Number(amount) || 0,
          ts: Date.now()
        });
      });
      saveAndRefresh();
    };
    reader.readAsText(file);
  });
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener("click", async () => {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
          salary,
          budget,
          weeklyBudget,
          entriesByDay
        }
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `xpense-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (importJsonFile) {
    importJsonFile.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (readEvent) => {
        try {
          const parsed = JSON.parse(readEvent.target.result);
          const data = parsed && parsed.data ? parsed.data : parsed;

          if (!data || typeof data !== "object") {
            throw new Error("Invalid backup file.");
          }

          salary = Number.isFinite(Number(data.salary)) ? Number(data.salary) : null;
          budget = Number.isFinite(Number(data.budget)) ? Number(data.budget) : null;
          weeklyBudget = Number.isFinite(Number(data.weeklyBudget)) ? Number(data.weeklyBudget) : null;
          entriesByDay = data.entriesByDay && typeof data.entriesByDay === "object" ? data.entriesByDay : {};

          saveSalary(salary);
          saveBudget(budget);
          saveWeeklyBudget(weeklyBudget);
          saveEntries(entriesByDay);
          ensureSetupState();
          saveAndRefresh();
        } catch (error) {
          alert("Unable to import JSON backup.");
          console.error(error);
        } finally {
          importJsonFile.value = "";
        }
      };

      reader.readAsText(file);
    });
  }

  resetBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure? This will permanently delete your local tracker data on this device.")) return;

    entriesByDay = {};
    salary = null;
    budget = null;
    weeklyBudget = null;

    saveSalary(null);
    saveBudget(null);
    saveWeeklyBudget(null);
    saveEntries({});

    if (window.localDataStore) {
      await Promise.all([
        window.localDataStore.deleteData(STORAGE_SALARY),
        window.localDataStore.deleteData(STORAGE_BUDGET),
        window.localDataStore.deleteData(STORAGE_WEEKLY_BUDGET),
        window.localDataStore.deleteData(STORAGE_ENTRIES)
      ]).catch(() => {});
    }

    alert("Local data reset successful.");
    window.location.reload();
  });

  if (syncBtn) syncBtn.addEventListener("click", triggerSync);
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try {
        const token = await fetchCsrfToken();
        await fetch("/api/api?action=logout", {
          method: "POST",
          headers: {
            "X-CSRF-Token": token || "",
            ...getAuthHeaders(),
          },
        });
      } catch {}

      clearAuthToken();
      if (activeUsersPollTimer) clearInterval(activeUsersPollTimer);
      redirectToLogin();
    };
  }

  function updateCategoryCustomVisibility() {
    const isCustom = entryCategory && entryCategory.value === "__custom__";
    if (entryCategoryCustomWrap) {
      entryCategoryCustomWrap.style.display = isCustom ? "" : "none";
    }
    if (!isCustom && entryCategoryCustom) {
      entryCategoryCustom.value = "";
    }
  }

  if (entryCategory) {
    entryCategory.addEventListener("change", updateCategoryCustomVisibility);
    updateCategoryCustomVisibility();
  }

  entryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeDateIso) return;
    const sanitizedLabel = entryLabel.value.trim() || "Entry";
    const isCustomCategory = entryCategory.value === "__custom__";
    const customCategoryValue = (entryCategoryCustom && entryCategoryCustom.value ? entryCategoryCustom.value.trim() : "");
    if (isCustomCategory && !customCategoryValue) {
      if (entryCategoryCustom) entryCategoryCustom.focus();
      return;
    }

    const item = {
      type: entryType.value,
      amount: parseMoney(entryAmount.value),
      label: sanitizedLabel,
      category: isCustomCategory ? customCategoryValue : entryCategory.value,
      recurring: entryRecurring.value,
      ts: Date.now()
    };
    if (!item.amount) return;

    if (!entriesByDay[activeDateIso]) entriesByDay[activeDateIso] = [];
    entriesByDay[activeDateIso].push(item);
    
    // Auto-populate based on frequency
    if (item.recurring !== "none") {
      let firstDate = new Date(activeDateIso);
      let nextDate = new Date(activeDateIso);
      const startMonth = firstDate.getMonth();
      
      // Monthly still adds 12 months, daily/weekly limited to current month
      const count = item.recurring === "monthly" ? 12 : 31; // Safety cap
      
      for (let i = 1; i <= count; i++) {
        if (item.recurring === "daily") {
          nextDate.setDate(nextDate.getDate() + 1);
        } else if (item.recurring === "weekly") {
          nextDate.setDate(nextDate.getDate() + 7);
        } else if (item.recurring === "monthly") {
          nextDate.setMonth(nextDate.getMonth() + 1);
        }
        
        // Check if we exited the current month for daily/weekly
        if (item.recurring !== "monthly" && nextDate.getMonth() !== startMonth) {
          break;
        }

        const iso = isoDate(nextDate);
        if (!entriesByDay[iso]) entriesByDay[iso] = [];
        entriesByDay[iso].push({ ...item, ts: Date.now() + i });
      }
    }

    entryAmount.value = "";
    entryLabel.value = "";
    if (entryCategoryCustom) entryCategoryCustom.value = "";
    if (entryCategory) entryCategory.value = "General";
    updateCategoryCustomVisibility();
    saveAndRefresh();
    renderEntriesModal(activeDateIso);
  });

  // Wiring up navigation and calendar interaction
  prevBtn.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); renderCalendar(); updateChart(); });
  nextBtn.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); renderCalendar(); updateChart(); });
  todayBtn.addEventListener("click", () => { viewDate = new Date(); viewDate.setDate(1); renderCalendar(); updateChart(); });
  monthSelect.addEventListener("change", () => { viewDate.setMonth(Number(monthSelect.value)); renderCalendar(); updateChart(); });

  daysGrid.addEventListener("click", (e) => {
    const target = e.target.closest("button.tracker-day");
    if (!target) return;
    
    if (isClearMode) return; // Handled by mousedown/mousemove for multi-select

    const clickedIso = target.dataset.date;
    activeDateIso = clickedIso;
    renderEntriesModal(activeDateIso);
    entryModal.classList.add("is-open");
    entryAmount.focus();
  });

  daysGrid.addEventListener("mousedown", (e) => {
    if (!isClearMode) return;
    const target = e.target.closest("button.tracker-day");
    if (!target) return;

    isDragging = true;
    const iso = target.dataset.date;
    if (clearTargets.has(iso)) {
      dragAction = "remove";
      clearTargets.delete(iso);
    } else {
      dragAction = "add";
      clearTargets.add(iso);
    }
    renderCalendar();
    e.preventDefault();
  });

  daysGrid.addEventListener("mouseover", (e) => {
    if (!isClearMode || !isDragging) return;
    const target = e.target.closest("button.tracker-day");
    if (!target) return;

    const iso = target.dataset.date;
    if (dragAction === "add") {
      clearTargets.add(iso);
    } else {
      clearTargets.delete(iso);
    }
    renderCalendar();
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Batch Delete Handling
  batchDeleteOpenBtn.addEventListener("click", () => {
    batchDeleteModal.classList.add("is-open");
  });

  batchDeleteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const cat = batchDeleteCategory.value;
    const amt = parseMoney(batchDeleteAmount.value);
    const label = batchDeleteLabel.value.trim().toLowerCase();

    if (!cat && !Number.isFinite(amt) && !label) {
      alert("Please provide at least one filter.");
      return;
    }

    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;
    let count = 0;

    if (!confirm(`Are you sure you want to delete all entries in ${viewDate.toLocaleString(undefined, { month: "long" })} matching these filters?`)) return;

    for (const [date, items] of Object.entries(entriesByDay)) {
      if (date.startsWith(prefix)) {
        const remaining = items.filter(it => {
          const matchCat = !cat || it.category === cat;
          const matchAmt = !Number.isFinite(amt) || it.amount === amt;
          const matchLabel = !label || (it.label && it.label.toLowerCase().includes(label));
          const isMatch = matchCat && matchAmt && matchLabel;
          if (isMatch) count++;
          return !isMatch;
        });

        if (remaining.length === 0) {
          delete entriesByDay[date];
        } else {
          entriesByDay[date] = remaining;
        }
      }
    }

    if (count > 0) {
      alert(`Deleted ${count} matching entries.`);
      saveAndRefresh();
      batchDeleteModal.classList.remove("is-open");
      // Reset form
      batchDeleteForm.reset();
    } else {
      alert("No matching entries found in the current month.");
    }
  });

  batchDeleteAmount.addEventListener("input", formatInputWithCommas);

  document.querySelectorAll("[data-close-batch]").forEach(el => el.onclick = () => batchDeleteModal.classList.remove("is-open"));

  function renderEntriesModal(dateIso) {
    modalDateTitle.textContent = `Entries for ${dateIso}`;
    const items = entriesByDay[dateIso] || [];
    modalDaySummary.textContent = `Total Net: ${fmtMoney(items.reduce((acc, it) => acc + (it.type === "gain" ? it.amount : -it.amount), 0))}`;
    entryList.innerHTML = "";
    items.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "tracker-entry";
      row.innerHTML = `
        <div class="tracker-entry-main">
          <div class="tracker-entry-label">${escapeHtml(it.label || "Entry")} ${it.recurring && it.recurring !== "none" ? "🔄" : ""}</div>
          <div class="tracker-entry-meta">${escapeHtml(it.category || "Other")} · ${escapeHtml(it.type || "expense")}${it.recurring && it.recurring !== "none" ? ` · ${escapeHtml(it.recurring || "none")}` : ""}</div>
        </div>
        <div class="tracker-entry-actions">
           <div class="tracker-entry-amt ${escapeHtml(it.type || "expense")}">${it.type === "gain" ? "+" : "-"}${fmtMoney(it.amount)}</div>
           <button class="tracker-icon-btn" onclick="deleteEntry(decodeURIComponent('${encodeURIComponent(dateIso)}'), ${idx})">🗑</button>
        </div>
      `;
      entryList.appendChild(row);
    });
  }

  window.deleteEntry = (dateIso, idx) => {
    entriesByDay[dateIso].splice(idx, 1);
    if (entriesByDay[dateIso].length === 0) delete entriesByDay[dateIso];
    saveAndRefresh();
    renderEntriesModal(dateIso);
  };

  // Formatting input fields in real-time
  function formatInputWithCommas(e) {
    const el = e.target;
    let cursor = el.selectionStart;
    const oldLen = el.value.length;
    
    // Remove non-digits/decimals
    let val = el.value.replace(/[^0-9.]/g, "");
    if (!val) {
      el.value = "";
      return;
    }
    
    // Split decimal
    const parts = val.split(".");
    if (parts.length > 2) parts.length = 2; // only one decimal point
    
    // Format integer part
    parts[0] = new Intl.NumberFormat("en-US").format(parts[0].replace(/,/g, ""));
    const newVal = parts.join(".");
    el.value = newVal;
    
    // Adjust cursor position
    const newLen = newVal.length;
    cursor = cursor + (newLen - oldLen);
    el.setSelectionRange(cursor, cursor);
  }

  salaryInput.addEventListener("input", formatInputWithCommas);
  budgetInput.addEventListener("input", formatInputWithCommas);
  entryAmount.addEventListener("input", formatInputWithCommas);

  // Close modals
  document.querySelectorAll("[data-close]").forEach(el => el.onclick = () => entryModal.classList.remove("is-open"));

  const monthNamesInit = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString(undefined, { month: "long" }));
  monthSelect.innerHTML = monthNamesInit.map((n, i) => `<option value="${i}">${n}</option>`).join("");

  // Clear Mode Logic
  function exitClearMode() {
    isClearMode = false;
    clearTargets.clear();
    daysGrid.classList.remove("is-selecting-clear");
    clearModeBtns.style.display = "none";
    clearModeBtn.style.display = "inline-block";
    renderCalendar();
  }

  clearModeBtn.addEventListener("click", () => {
    isClearMode = true;
    daysGrid.classList.add("is-selecting-clear");
    clearModeBtn.style.display = "none";
    clearModeBtns.style.display = "flex";
  });

  clearCancelBtn.addEventListener("click", exitClearMode);

  clearConfirmBtn.addEventListener("click", () => {
    if (clearTargets.size === 0) {
      alert("Please select at least one day to clear.");
      return;
    }
    const count = clearTargets.size;
    if (confirm(`Remove all entries for the ${count} selected day(s)?`)) {
      clearTargets.forEach(iso => delete entriesByDay[iso]);
      saveAndRefresh();
      exitClearMode();
    }
  });
  
  // AI Financial Assistant Integration
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function escapeHtml(s) {
    return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function sanitizeLimitedHtml(input) {
    const template = document.createElement("template");
    template.innerHTML = String(input || "");

    const allowedTags = new Set(["B", "STRONG", "I", "EM", "BR", "SPAN"]);
    const blockedTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META"]);

    const walk = (node) => {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toUpperCase();
          if (blockedTags.has(tag)) {
            child.remove();
            continue;
          }
          if (!allowedTags.has(tag)) {
            const textNode = document.createTextNode(child.textContent || "");
            child.replaceWith(textNode);
            continue;
          }

          for (const attr of Array.from(child.attributes)) {
            const name = attr.name.toLowerCase();
            if (tag === "SPAN" && name === "class" && child.classList.contains("summary-highlight")) {
              continue;
            }
            child.removeAttribute(attr.name);
          }
          walk(child);
        } else if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
        }
      }
    };

    walk(template.content);
    return template.innerHTML;
  }

  function renderChatText(text) {
    let s = escapeHtml(text);
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\n/g, "<br>");
    return sanitizeLimitedHtml(s);
  }

  function initMobileNav() {
    const toggle = document.querySelector(".nav-toggle");
    const nav = document.querySelector(".site-nav");
    if (!toggle || !nav) return;
    const navItems = nav.querySelectorAll("button, a, input");

    const setOpenState = (isOpen) => {
      nav.classList.toggle("is-open", isOpen);
      toggle.classList.toggle("is-active", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
      document.body.style.overflow = isOpen ? "hidden" : "";
    };

    toggle.addEventListener("click", () => {
      const isOpen = !nav.classList.contains("is-open");
      setOpenState(isOpen);
    });

    navItems.forEach(item => {
      item.addEventListener("click", () => {
        if (item.id === "syncKeyInput") return;
        setOpenState(false);
      });
    });
  }

  initMobileNav();

  function initFinancialChatbot() {
    const fab = document.querySelector(".chatbot .chatbot-fab");
    const panel = document.getElementById("chatbot-panel");
    const closeBtn = document.querySelector("#chatbot-panel .chatbot-close");
    const form = document.querySelector("#chatbot-panel .chatbot-form");
    const input = document.querySelector("#chatbot-panel .chatbot-input");
    const log = document.querySelector("#chatbot-panel .chatbot-messages");

    console.log("Chatbot elements:", { fab: !!fab, panel: !!panel, closeBtn: !!closeBtn, form: !!form, input: !!input, log: !!log });

    if (!fab || !panel || !closeBtn || !form || !input || !log) {
      console.warn("Chatbot initialization skipped - missing elements");
      return;
    }

    const apiUrl = "/api/api?action=chat";
    const messages = [];

    function buildFinancialContext() {
      const parts = [
        `Today's Date: ${new Date().toISOString().split('T')[0]}`,
        `Currency: Philippine Peso (PHP)`,
        `Monthly Salary: PHP ${salary || "Not set"}`,
        `Monthly Budget: PHP ${budget || "Not set"}`,
        "RECENT TRANSACTIONS (Last 60 days):"
      ];
      
      const sortedDates = Object.keys(entriesByDay).sort().reverse().slice(0, 60);
      sortedDates.forEach(date => {
        entriesByDay[date].forEach(it => {
          const freqInfo = (it.recurring && it.recurring !== 'none') ? ` (${it.recurring})` : '';
          parts.push(`- ${date}: ${it.type === 'gain' ? '+' : '-'}${it.amount} PHP [${it.category}] "${it.label}"${freqInfo}`);
        });
      });
      
      return parts.join("\n").slice(0, 8000); // Guard rails
    }

    function processChatCommands(text) {
      const addRegex = /\[\[ADD:\s*([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\]\]/g;
      const delRegex = /\[\[DELETE:\s*([^|]+)\|([^|]+)\]\]/g;
      const updRegex = /\[\[UPDATE:\s*([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\]\]/g;

      let match;
      let changed = false;

      // Process ADD
      while ((match = addRegex.exec(text)) !== null) {
        const [_, date, label, amount, cat, type] = match;
        if (!entriesByDay[date]) entriesByDay[date] = [];
        entriesByDay[date].push({
          label: label.trim(),
          amount: parseFloat(amount) || 0,
          category: cat.trim(),
          type: type.trim().toLowerCase() === "gain" ? "gain" : "expense",
          ts: Date.now()
        });
        changed = true;
      }

      // Process DELETE
      while ((match = delRegex.exec(text)) !== null) {
        const [_, date, label] = match;
        if (entriesByDay[date]) {
          const l = label.trim().toLowerCase();
          const initialLen = entriesByDay[date].length;
          entriesByDay[date] = entriesByDay[date].filter(it => it.label.toLowerCase() !== l);
          if (entriesByDay[date].length === 0) delete entriesByDay[date];
          if (initialLen !== (entriesByDay[date]?.length || 0)) changed = true;
        }
      }

      // Process UPDATE
      while ((match = updRegex.exec(text)) !== null) {
        const [_, date, oldLabel, newLabel, newAmt, newCat] = match;
        if (entriesByDay[date]) {
          const ol = oldLabel.trim().toLowerCase();
          entriesByDay[date] = entriesByDay[date].map(it => {
            if (it.label.toLowerCase() === ol) {
              changed = true;
              return {
                ...it,
                label: newLabel.trim() || it.label,
                amount: parseFloat(newAmt) || it.amount,
                category: newCat.trim() || it.category,
                ts: Date.now()
              };
            }
            return it;
          });
        }
      }

      if (changed) {
        saveAndRefresh();
        // If the entries modal is open for the changed date, refresh it
        if (typeof activeDateIso !== "undefined" && entriesByDay[activeDateIso]) {
           renderEntriesModal(activeDateIso);
        }
      }
      
      // Return cleaned text (remove commands before showing to user)
      return text.replace(/\[\[.*?\]\]/g, "").trim();
    }

    const systemPrompt = {
      role: "system",
      content: "You are the official Financial Assistant for the Xpense platform. " +
               "Your ONLY purpose is to discuss the Xpense website features and provide financial advice/analysis based on the user's data. " +
               "STRICT RULE: Do NOT answer questions about unrelated topics (e.g., general knowledge, jokes, other websites, or unrelated programming). " +
               "If a user asks something non-financial or unrelated to Xpense, politely decline and offer to help with their expenses or budget instead. " +
               "The currency is Philippine Peso (PHP). Use the provided spending data to answer user questions. Be precise with calculations. " +
               "ALWAYS use the PHP symbol when mentioning money. If they ask about spending, sum up the relevant categories/dates from the log. " +
               "If they are over budget, give friendly advice. Keep responses concise and use bold for numbers.\n\n" +
               "NEW CAPABILITY: You can now modify the user's data! " +
               "To take an action, append ONE of these commands at the VERY END of your response (it will be parsed internally):\n" +
               "1. Add: [[ADD: YYYY-MM-DD|label|amount|category|type]]\n" +
               "   - type: 'expense' or 'gain'.\n" +
               "2. Delete: [[DELETE: YYYY-MM-DD|label]]\n" +
               "3. Update: [[UPDATE: YYYY-MM-DD|old_label|new_label|new_amount|new_category]]\n\n" +
               "USER FINANCIAL DATA:\n" + buildFinancialContext()
    };
    messages.push(systemPrompt);

    function setOpen(open) {
      console.log("setOpen called with:", open);
      panel.hidden = !open;
      fab.setAttribute("aria-expanded", String(open));
      if (open) { input.focus(); log.scrollTop = log.scrollHeight; }
    }

    function addMessage(role, text) {
      messages.push({ role, content: text });
      const row = el("div", `chatbot-row ${role}`);
      const bubble = el("div", "chatbot-bubble");
      bubble.innerHTML = renderChatText(text);
      row.appendChild(bubble);
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    fab.addEventListener("click", (e) => {
      console.log("FAB clicked");
      e.stopPropagation();
      setOpen(panel.hidden);
    });
    
    closeBtn.addEventListener("click", (e) => {
      console.log("Close button clicked");
      e.stopPropagation();
      setOpen(false);
    });

    addMessage("assistant", "Hi! I'm your Financial Assistant. I've analyzed your spending logs in PHP. How can I help you today?");

    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      
      input.value = "";
      input.disabled = true;
      addMessage("user", text);

      try {
        // Refresh context in system prompt with latest data before sending
        messages[0].content = "You are the official Financial Assistant for Xpense. You ONLY discuss Xpense features and finance. " +
                              "You can modify data using: [[ADD: YYYY-MM-DD|label|amount|category|type]], [[DELETE: YYYY-MM-DD|label]], or [[UPDATE: YYYY-MM-DD|old_label|new_label|new_amount|new_category]]. " +
                              "USER FINANCIAL DATA:\n" + buildFinancialContext();

        const token = await fetchCsrfToken();
        const r = await fetch("/api/api?action=chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": token,
            ...getAuthHeaders()
          },
          body: JSON.stringify({ model: "openai/gpt-oss-120b", messages })
        });
        const data = await r.json();
        const cleanedText = processChatCommands(data.content || "Sorry, I couldn't process that.");
        addMessage("assistant", cleanedText);
      } catch (err) {
        addMessage("assistant", "Connection error. Ensure the server is running.");
      } finally {
        input.disabled = false;
        input.focus();
      }
    };
  }

  initFinancialChatbot();
  editBudgetBtn.onclick = () => {
    salaryInput.value = salary || "";
    budgetInput.value = budget || "";
    weeklyBudgetInput.value = weeklyBudget || "";
    salaryCard.hidden = false;
    trackerMainLayout.hidden = true;
    trackerGrid.classList.remove("is-ready");
    salaryInput.focus();
  };

  ensureSetupState();
}

main().catch((error) => {
  console.error("Failed to initialize tracker.", error);
});

