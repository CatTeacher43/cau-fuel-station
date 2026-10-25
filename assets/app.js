(function () {
  "use strict";

  const data = window.CAU_DATA;
  const engine = window.CAUEngine;
  if (!data || !engine) return;

  const STORAGE_KEY = "cau-fuel-favorites-v1";
  const ROLE_LABELS = { staple: "主食", protein: "蛋白", side: "配菜" };
  const GOAL_LABELS = engine.LABELS.goal;
  const CAMPUS_LABELS = engine.LABELS.campus;

  const state = {
    form: {
      campus: "east",
      goal: "gain",
      exercise: "strength",
      duration: "mid",
      restrictions: [],
      taste: "normal"
    },
    result: null,
    variant: 0,
    dirty: false,
    loading: false,
    favorites: loadFavorites(),
    lastFocus: null
  };

  const refs = {
    form: document.getElementById("dinner-form"),
    generateButton: document.getElementById("generate-button"),
    buttonLabel: document.querySelector("#generate-button .button-label"),
    formHint: document.getElementById("form-hint"),
    results: document.getElementById("results"),
    resultsEmpty: document.getElementById("results-empty"),
    resultsOutput: document.getElementById("results-output"),
    favoritesTrigger: document.getElementById("favorites-trigger"),
    favoritesCount: document.getElementById("favorites-count"),
    drawer: document.getElementById("favorites-drawer"),
    drawerOverlay: document.getElementById("drawer-overlay"),
    favoritesClose: document.getElementById("favorites-close"),
    favoritesList: document.getElementById("favorites-list"),
    liveStatus: document.getElementById("live-status-text"),
    liveDot: document.querySelector(".live-dot"),
    toast: document.getElementById("toast"),
    heroGoal: document.getElementById("hero-goal-label"),
    heroProtein: document.getElementById("hero-protein-label"),
    heroCarbs: document.getElementById("hero-carbs-label")
  };

  let toastTimer = null;
  let drawAnimationTimer = null;

  /* ----------------------------------------------------------------------- */
  /* Helpers                                                                 */
  /* ----------------------------------------------------------------------- */

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function icon(name, className) {
    const classes = className ? ` class="${className}"` : "";
    return `<svg${classes} aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function formatFavoriteDate(iso) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).format(new Date(iso));
    } catch (error) {
      return "";
    }
  }

  function isFavorite(id) {
    return state.favorites.some((favorite) => favorite.id === id);
  }

  function loadFavorites() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((favorite) => {
        return (
          favorite &&
          typeof favorite.id === "string" &&
          typeof favorite.label === "string" &&
          favorite.total &&
          typeof favorite.total.protein === "number"
        );
      });
    } catch (error) {
      return [];
    }
  }

  function persistFavorites() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.favorites));
    } catch (error) {
      showToast("浏览器阻止了本地保存，这次收藏只在当前页面有效");
    }
  }

  function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      refs.toast.classList.remove("is-visible");
    }, 2400);
  }

  function getRestrictionLabels() {
    return state.form.restrictions
      .map((restriction) => engine.LABELS.restriction[restriction])
      .filter(Boolean);
  }

  /* ----------------------------------------------------------------------- */
  /* Form state                                                              */
  /* ----------------------------------------------------------------------- */

  function syncFormUI() {
    document.querySelectorAll("[data-group]").forEach((button) => {
      const group = button.dataset.group;
      const value = button.dataset.value;
      let active = false;

      if (group === "restriction") {
        active =
          value === "none"
            ? state.form.restrictions.length === 0
            : state.form.restrictions.includes(value);
      } else {
        active = state.form[group] === value;
      }

      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    updateHeroTarget();
    updateLiveStatus();
  }

  function updateHeroTarget() {
    const target = engine.getMacroTargets(state.form);
    refs.heroGoal.textContent = GOAL_LABELS[state.form.goal];
    refs.heroProtein.textContent = `${target.protein[0]}g+`;
    refs.heroCarbs.textContent = `${target.carbs[0]}g+`;
  }

  function updateLiveStatus() {
    const time = engine.getBeijingTime(new Date());
    const openCount = engine.getCampusOpenCount(data, state.form.campus, new Date());
    const campus = CAMPUS_LABELS[state.form.campus];
    if (openCount > 0) {
      refs.liveStatus.textContent = `${time.timeLabel} · ${campus} ${openCount} 个餐区营业`;
      refs.liveDot.classList.remove("is-off");
    } else {
      refs.liveStatus.textContent = `${time.timeLabel} · ${campus} 当前非供餐时段`;
      refs.liveDot.classList.add("is-off");
    }
  }

  function updateFormCopy() {
    if (state.loading) return;
    refs.generateButton.disabled = false;
    refs.buttonLabel.textContent = state.result
      ? "更新我的晚餐方案"
      : "生成我的晚餐方案";

    refs.formHint.classList.toggle("is-dirty", state.dirty);
    const hintText = state.dirty
      ? "条件有更新，重新生成会让推荐更准确。"
      : state.result
        ? "营业状态会随当前时间重新计算。"
        : "已按常见情况预填，直接生成也 OK。";
    refs.formHint.innerHTML = `${icon("info")}<span>${hintText}</span>`;
  }

  function setDirty() {
    if (state.result) {
      state.dirty = true;
      updateFormCopy();
    }
  }

  function handleOptionClick(event) {
    const button = event.target.closest("[data-group]");
    if (!button) return;
    const group = button.dataset.group;
    const value = button.dataset.value;

    if (group === "restriction") {
      if (value === "none") {
        state.form.restrictions = [];
      } else {
        const index = state.form.restrictions.indexOf(value);
        if (index >= 0) {
          state.form.restrictions.splice(index, 1);
        } else {
          state.form.restrictions.push(value);
        }
      }
    } else if (group === "goal") {
      state.form.goal = value;
    } else if (group === "exercise") {
      state.form.exercise = value;
    } else if (group === "duration") {
      state.form.duration = value;
    } else if (group === "taste") {
      state.form.taste = value;
    } else if (group === "campus") {
      state.form.campus = value;
    }

    syncFormUI();
    setDirty();
  }

  function setLoading(loading) {
    state.loading = loading;
    refs.generateButton.disabled = loading;
    refs.results.setAttribute("aria-busy", loading ? "true" : "false");
    if (loading) {
      refs.buttonLabel.textContent = "正在翻今晚的菜单…";
    } else {
      updateFormCopy();
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (state.loading) return;
    state.variant = 0;
    setLoading(true);

    window.setTimeout(() => {
      try {
        const result = engine.getRecommendations(
          data,
          state.form,
          state.variant,
          new Date()
        );
        state.result = result;
        state.dirty = false;
        renderResult(result);
        updateFormCopy();
        updateLiveStatus();

        if (window.matchMedia("(max-width: 980px)").matches) {
          refs.results.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } catch (error) {
        showToast("配餐时出了点问题，请再试一次");
        console.error(error);
      } finally {
        setLoading(false);
      }
    }, 520);
  }

  /* ----------------------------------------------------------------------- */
  /* Rendering results                                                       */
  /* ----------------------------------------------------------------------- */

  function renderResult(result) {
    refs.resultsEmpty.hidden = true;
    refs.resultsOutput.hidden = false;

    if (!result.combos.length) {
      renderNoResult(result);
      return;
    }

    refs.resultsOutput.innerHTML = `
      ${renderResultHead(result)}
      ${renderStatusBanner(result)}
      <div class="combo-list">
        ${result.combos.map((combo, index) => renderCombo(combo, index)).join("")}
      </div>
      ${result.limited ? `<p class="result-limited">符合全部条件的完整搭配有限，已把最稳的 ${result.combos.length} 套先给你。</p>` : ""}
      ${renderExtras(result)}
      <p class="result-disclaimer">
        ${icon("info")}
        <span>${escapeHTML(data.meta.disclaimer)}</span>
      </p>
    `;

    replayResultAnimation();
    bindDynamicEvents();
    updateFavoriteButtons();
  }

  function renderResultHead(result) {
    const restrictions = getRestrictionLabels();
    const context = [
      CAMPUS_LABELS[result.form.campus],
      `${engine.LABELS.exercise[result.form.exercise]} · ${engine.LABELS.duration[result.form.duration]}`,
      GOAL_LABELS[result.form.goal],
      restrictions.length ? restrictions.join(" / ") : "无忌口",
      state.form.taste !== "normal" ? engine.LABELS.taste[state.form.taste] : ""
    ].filter(Boolean);

    const headline =
      result.combos.length === 1
        ? "找到 1 套能落地的晚餐。"
        : `<em>${result.combos.length} 套</em>都能落地，<span class="headline-tail">从第 1 套开始看。</span>`;

    return `
      <div class="result-head">
        <div>
          <span class="section-kicker">02 / 今晚的盘子</span>
          <h2>${headline}</h2>
          <div class="result-context">
            ${context.map((item) => `<span>${escapeHTML(item)}</span>`).join("")}
          </div>
        </div>
        <button class="shuffle-button" id="shuffle-button" type="button">
          ${icon("refresh")}<span>换一批</span>
        </button>
      </div>
    `;
  }

  function renderStatusBanner(result) {
    let message = "";
    let warning = false;

    if (result.dinnerReadyCount > 0) {
      message = `现在是 ${result.timeLabel}，${result.dinnerReadyCount} 套所在的档口正在供餐。其余档口的具体时段标在卡片上。`;
    } else if (result.openCount > 0) {
      warning = true;
      message = `现在是 ${result.timeLabel}，还没到晚餐供餐时段。下面按今晚菜单搭配，开餐后可直接去。`;
    } else {
      warning = true;
      message = `现在是 ${result.timeLabel}，当前不在晚餐供餐时段。先把方案存好，开餐后照着吃。`;
    }

    return `
      <div class="status-banner${warning ? " is-warning" : ""}">
        ${icon("clock")}
        <span>${escapeHTML(message)}</span>
      </div>
    `;
  }

  function renderCombo(combo, index) {
    const saved = isFavorite(combo.id);
    const statusClass = combo.status.open ? "" : "is-closed";
    const macroCalories =
      combo.total.protein * 4 + combo.total.carbs * 4 + combo.total.fat * 9;
    const proteinPct = macroCalories
      ? ((combo.total.protein * 4) / macroCalories) * 100
      : 33;
    const carbsPct = macroCalories
      ? ((combo.total.carbs * 4) / macroCalories) * 100
      : 34;
    const fatPct = Math.max(0, 100 - proteinPct - carbsPct);
    const dishNames = combo.dishes.map((dish) => dish.name).join(" · ");

    return `
      <article class="combo-card${index === 0 ? " is-top" : ""}" data-combo-id="${escapeHTML(combo.id)}">
        <div class="combo-topline">
          <div class="combo-id">
            <span>${String(index + 1).padStart(2, "0")}</span>
            ${index === 0 ? '<span class="best-flag">最贴合</span>' : ""}
          </div>
          <div class="combo-actions">
            <button
              class="save-button${saved ? " is-saved" : ""}"
              type="button"
              data-save-id="${escapeHTML(combo.id)}"
              aria-label="${saved ? "取消收藏这套晚餐" : "收藏这套晚餐"}"
              aria-pressed="${saved ? "true" : "false"}"
              title="${saved ? "取消收藏" : "收藏这套晚餐"}"
            >${icon("heart")}</button>
            <div class="match-badge" style="--match: ${combo.match}" aria-label="综合适配 ${combo.match} 分" title="按目标、忌口和营业状态综合排序">
              <strong>${combo.match}</strong>
              <span>适配分</span>
            </div>
          </div>
        </div>

        <h3 class="combo-title">${escapeHTML(combo.label)}</h3>
        <p class="combo-dishes">${escapeHTML(dishNames)}</p>

        <div class="combo-meta">
          <span class="canteen-line">${icon("pin")}${escapeHTML(combo.canteen.name)}</span>
          <span class="canteen-loc">${escapeHTML(combo.canteen.location)} · ${escapeHTML(combo.dishes[0].stall)}</span>
          <span class="status-tag ${statusClass}"><i></i>${escapeHTML(combo.status.statusText)}</span>
          <span class="combo-price">约 ¥${combo.total.price}</span>
        </div>

        <div class="dish-stack">
          ${combo.dishes
            .map(
              (dish) => `
                <div class="dish-cell">
                  <span>${ROLE_LABELS[dish.role]}</span>
                  <strong title="${escapeHTML(dish.name)}">${escapeHTML(dish.name)}</strong>
                  <small>${escapeHTML(dish.portion)} · ${dish.kcal} kcal</small>
                </div>
              `
            )
            .join("")}
        </div>

        <div class="macro-row">
          <div class="macro-item is-protein"><span>蛋白质</span><strong>${combo.total.protein}<small>g</small></strong></div>
          <div class="macro-item is-carbs"><span>碳水</span><strong>${combo.total.carbs}<small>g</small></strong></div>
          <div class="macro-item is-fat"><span>脂肪</span><strong>${combo.total.fat}<small>g</small></strong></div>
          <div class="macro-item is-kcal"><span>整餐热量</span><strong>${combo.total.kcal}<small>kcal</small></strong></div>
        </div>
        <div class="macro-bar" aria-hidden="true">
          <i class="bar-protein" style="width:${proteinPct.toFixed(1)}%"></i>
          <i class="bar-carbs" style="width:${carbsPct.toFixed(1)}%"></i>
          <i class="bar-fat" style="width:${fatPct.toFixed(1)}%"></i>
        </div>

        <p class="combo-why">${icon("spark")}<span>${escapeHTML(combo.why)}</span></p>
        <div class="combo-tags">
          ${combo.tags.map((tag) => `<span># ${escapeHTML(tag)}</span>`).join("")}
        </div>
      </article>
    `;
  }

  function renderExtras(result) {
    const warnings = engine.getWarnings(data, state.form, 3);
    const tips = engine.getTips(state.form);

    return `
      <div class="result-extras">
        <section class="avoid-card" aria-label="避雷提示">
          <div class="extras-head">
            ${icon("warning")}
            <strong>今晚先放放</strong>
            <small>高油 / 高糖 / 重口</small>
          </div>
          <div class="avoid-list">
            ${
              warnings.length
                ? warnings
                    .map(
                      (warning) => `
                        <div class="avoid-item">
                          <i></i>
                          <div>
                            <strong>${escapeHTML(warning.name)}</strong>
                            <small>${escapeHTML(warning.canteenName)} · ${escapeHTML(warning.reason)}</small>
                          </div>
                        </div>
                      `
                    )
                    .join("")
                : '<div class="avoid-item"><i></i><div><strong>没有特别需要避开的菜品</strong><small>按自己的份量吃就好。</small></div></div>'
            }
          </div>
        </section>

        <section class="tips-card" aria-label="运动后补给提示">
          <div class="extras-head">
            ${icon("spark")}
            <strong>补给提示</strong>
            <small>给你的这一顿</small>
          </div>
          <div class="tip-list">
            ${tips
              .map(
                (tip) => `
                  <div class="tip-item">
                    <span>${escapeHTML(tip.kicker)}</span>
                    <div>
                      <strong>${escapeHTML(tip.title)}</strong>
                      <small>${escapeHTML(tip.body)}</small>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        </section>
      </div>
    `;
  }

  function renderNoResult(result) {
    refs.resultsOutput.innerHTML = `
      <div class="result-head">
        <div>
          <span class="section-kicker">02 / 今晚的盘子</span>
          <h2>条件卡得有点紧。</h2>
        </div>
      </div>
      <div class="status-banner is-warning">
        ${icon("warning")}
        <span>没有找到同时满足校区、忌口和完整搭配的晚餐。把一项忌口放宽，或换一个校区再试。</span>
      </div>
      <p class="result-disclaimer">${icon("info")}<span>当前时间 ${escapeHTML(result.timeLabel)}；也可以直接去食堂自选，按“一拳主食、一掌蛋白、两拳蔬菜”搭配。</span></p>
    `;
    replayResultAnimation();
  }

  function replayResultAnimation() {
    window.clearTimeout(drawAnimationTimer);
    refs.resultsOutput.classList.remove("is-entering");
    void refs.resultsOutput.offsetWidth;
    refs.resultsOutput.classList.add("is-entering");
    drawAnimationTimer = window.setTimeout(() => {
      refs.resultsOutput.classList.remove("is-entering");
    }, 760);
  }

  function bindDynamicEvents() {
    // Results output uses event delegation; this function is a hook for future
    // card-level interactions.
  }

  /* ----------------------------------------------------------------------- */
  /* Results interactions                                                    */
  /* ----------------------------------------------------------------------- */

  function handleResultsClick(event) {
    const shuffle = event.target.closest("#shuffle-button");
    if (shuffle) {
      if (!state.result) return;
      state.variant += 1;
      const result = engine.getRecommendations(
        data,
        state.form,
        state.variant,
        new Date()
      );
      state.result = result;
      state.dirty = false;
      renderResult(result);
      updateLiveStatus();
      showToast("换了一批，仍然优先考虑正在供餐的档口");
      return;
    }

    const saveButton = event.target.closest("[data-save-id]");
    if (saveButton) {
      toggleFavorite(saveButton.dataset.saveId);
    }
  }

  function toggleFavorite(comboId) {
    if (!state.result) return;
    const combo = state.result.combos.find((item) => item.id === comboId);
    if (!combo) return;

    const existingIndex = state.favorites.findIndex(
      (favorite) => favorite.id === comboId
    );

    if (existingIndex >= 0) {
      state.favorites.splice(existingIndex, 1);
      showToast("已取消收藏");
    } else {
      state.favorites.unshift({
        id: combo.id,
        label: combo.label,
        canteenName: combo.canteen.name,
        canteenLocation: combo.canteen.location,
        dishNames: combo.dishes.map((dish) => dish.name),
        total: combo.total,
        match: combo.match,
        savedAt: new Date().toISOString()
      });
      showToast("已收藏这套晚餐，下次打开还能看到");
    }

    persistFavorites();
    updateFavoriteButtons();
    renderFavorites();
  }

  function updateFavoriteButtons() {
    document.querySelectorAll("[data-save-id]").forEach((button) => {
      const saved = isFavorite(button.dataset.saveId);
      button.classList.toggle("is-saved", saved);
      button.setAttribute("aria-pressed", saved ? "true" : "false");
      button.setAttribute("aria-label", saved ? "取消收藏这套晚餐" : "收藏这套晚餐");
      button.setAttribute("title", saved ? "取消收藏" : "收藏这套晚餐");
    });
  }

  /* ----------------------------------------------------------------------- */
  /* Favorites drawer                                                        */
  /* ----------------------------------------------------------------------- */

  function renderFavorites() {
    const count = state.favorites.length;
    refs.favoritesCount.textContent = count > 99 ? "99+" : String(count);

    if (!count) {
      refs.favoritesList.innerHTML = `
        <div class="favorites-empty">
          <span class="empty-plate">${icon("bowl")}</span>
          <h3>还没有收藏</h3>
          <p>在推荐卡片右上角点一下爱心，这套晚餐就会留在这里。</p>
        </div>
      `;
      return;
    }

    refs.favoritesList.innerHTML = state.favorites
      .map((favorite) => {
        const date = formatFavoriteDate(favorite.savedAt);
        const dishNames = Array.isArray(favorite.dishNames)
          ? favorite.dishNames.join(" · ")
          : "";
        return `
          <article class="favorite-item">
            <div class="favorite-item-head">
              <div>
                <h3>${escapeHTML(favorite.label)}</h3>
                <div class="favorite-item-canteen">
                  ${icon("pin")}${escapeHTML(favorite.canteenName || "")}${favorite.canteenLocation ? ` · ${escapeHTML(favorite.canteenLocation)}` : ""}
                </div>
              </div>
              <button class="favorite-remove" type="button" data-remove-id="${escapeHTML(favorite.id)}" aria-label="从收藏中移除 ${escapeHTML(favorite.label)}">
                ${icon("close")}
              </button>
            </div>
            <p class="favorite-dishes">${escapeHTML(dishNames)}</p>
            <div class="favorite-macros">
              <span><strong>${favorite.total.protein}</strong>g 蛋白</span>
              <span><strong>${favorite.total.carbs}</strong>g 碳水</span>
              <span><strong>${favorite.total.kcal}</strong> kcal</span>
              ${date ? `<span class="favorite-date">${escapeHTML(date)}</span>` : ""}
            </div>
          </article>
        `;
      })
      .join("");
  }

  function openFavorites() {
    state.lastFocus = document.activeElement;
    renderFavorites();
    refs.drawerOverlay.hidden = false;
    refs.drawer.setAttribute("aria-hidden", "false");
    refs.favoritesTrigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("no-scroll");
    window.requestAnimationFrame(() => {
      refs.drawerOverlay.classList.add("is-open");
      refs.drawer.classList.add("is-open");
    });
    window.setTimeout(() => {
      refs.favoritesClose.focus();
    }, 320);
  }

  function closeFavorites() {
    refs.drawer.classList.remove("is-open");
    refs.drawerOverlay.classList.remove("is-open");
    refs.drawer.setAttribute("aria-hidden", "true");
    refs.favoritesTrigger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("no-scroll");
    window.setTimeout(() => {
      if (!refs.drawer.classList.contains("is-open")) {
        refs.drawerOverlay.hidden = true;
      }
    }, 320);
    if (state.lastFocus && typeof state.lastFocus.focus === "function") {
      state.lastFocus.focus();
    }
  }

  function handleFavoriteRemove(event) {
    const button = event.target.closest("[data-remove-id]");
    if (!button) return;
    const id = button.dataset.removeId;
    state.favorites = state.favorites.filter((favorite) => favorite.id !== id);
    persistFavorites();
    updateFavoriteButtons();
    renderFavorites();
    showToast("已从收藏中移除");
    refs.favoritesClose.focus();
  }

  function trapDrawerFocus(event) {
    if (!refs.drawer.classList.contains("is-open")) return;
    if (event.key === "Escape") {
      closeFavorites();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = refs.drawer.querySelectorAll(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Navigation + live clock                                                 */
  /* ----------------------------------------------------------------------- */

  function setupNavObserver() {
    if (!("IntersectionObserver" in window)) return;
    const links = Array.from(document.querySelectorAll(".main-nav a"));
    const sections = [
      { id: "planner", link: links.find((link) => link.getAttribute("href") === "#planner") },
      { id: "guide", link: links.find((link) => link.getAttribute("href") === "#guide") }
    ].filter((item) => item.link);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => link.classList.remove("is-active"));
          const target = sections.find((section) => section.id === entry.target.id);
          if (target) target.link.classList.add("is-active");
        });
      },
      { rootMargin: "-32% 0px -58% 0px", threshold: 0.01 }
    );

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });
  }

  function setupHeaderScroll() {
    const header = document.querySelector(".site-header");
    const onScroll = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ----------------------------------------------------------------------- */
  /* Boot                                                                    */
  /* ----------------------------------------------------------------------- */

  function init() {
    refs.form.addEventListener("click", handleOptionClick);
    refs.form.addEventListener("submit", handleSubmit);
    refs.resultsOutput.addEventListener("click", handleResultsClick);

    refs.favoritesTrigger.addEventListener("click", openFavorites);
    refs.favoritesTrigger.setAttribute("aria-expanded", "false");
    refs.favoritesClose.addEventListener("click", closeFavorites);
    refs.drawerOverlay.addEventListener("click", closeFavorites);
    refs.favoritesList.addEventListener("click", handleFavoriteRemove);
    document.addEventListener("keydown", trapDrawerFocus);

    syncFormUI();
    updateFormCopy();
    renderFavorites();
    setupNavObserver();
    setupHeaderScroll();
    window.setInterval(updateLiveStatus, 30000);

    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") {
      const result = engine.getRecommendations(
        data,
        state.form,
        0,
        new Date()
      );
      state.result = result;
      renderResult(result);
      updateFormCopy();
    }
  }

  init();
})();
