(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const grid = byId("recipe-grid");
  const search = byId("recipe-search");
  const productSelect = byId("product-select");
  const methodSelect = byId("method-select");
  const allTab = byId("tab-all");
  const savedTab = byId("tab-saved");
  const resetButton = byId("reset-filters");
  const moreButton = byId("show-more");
  const dialog = byId("recipe-dialog");
  const dialogSave = byId("dialog-save");
  const pageSize = 12;
  const savedKey = "upr.recipes.saved.v1";
  const stepsKey = "upr.recipes.steps.v1";

  const products = {
    chicken: "Курица",
    buckwheat: "Гречка",
    rice: "Рис",
    millet: "Пшено",
    spelt: "Полба",
    sorghum: "Сорго",
    peas: "Горох",
    oats: "Овёс",
    eggs: "Яйца",
    tongue: "Говяжий язык",
    cabbage: "Капуста"
  };
  const categories = { grains: ["rice", "buckwheat", "millet", "spelt", "sorghum", "peas", "oats"], meat: ["tongue"], poultry: ["chicken"] };
  const categoryButtons = [...document.querySelectorAll("[data-category]")];
  let selectedCategory = "all";
  const bookmarkIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6.5 4.5h11v16L12 17l-5.5 3.5z"/></svg>';
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => entities[c]);
  const fold = value => String(value).toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/[-‐‑–—]/g, " ").trim();
  function spiceTiming(recipe, when) {
    const match = fold(when).match(/^вместе с (паприкой|базиликом|карри|кориандром|куркумой|укропом)$/);
    if (!match) return when;
    const stems = { паприкой: "паприк", базиликом: "базилик", карри: "карри", кориандром: "кориандр", куркумой: "куркум", укропом: "укроп" };
    const reference = recipe.spices.find(([name]) => fold(name).includes(stems[match[1]]));
    return reference && reference[2] && !fold(reference[2]).startsWith("вместе с ")
      ? when + " — " + reference[2] : when;
  }
  const registryKeys = registry.map(fold).sort((a, b) => b.length - a.length);

  function readStore(storage, key) {
    try { return JSON.parse(window[storage].getItem(key)); }
    catch { return null; }
  }
  function writeStore(storage, key, data) {
    try { window[storage].setItem(key, JSON.stringify(data)); }
    catch { /* Состояние доступно в памяти страницы и при запрете хранилища. */ }
  }

  function recipeCount(n) {
    const end = n % 10;
    if (end === 1 && n % 100 !== 11) return n + " рецепт";
    if (end >= 2 && end <= 4 && (n % 100 < 12 || n % 100 > 14)) return n + " рецепта";
    return n + " рецептов";
  }

  const entries = recipes.map((recipe, index) => {
    const product = recipe.productId || recipe.id;
    const name = products[product] || recipe.grain;
    const method = recipe.methodId || (["microwave", "airfryer"].includes(recipe.id) ? recipe.id : "base");
    const modes = { microwave: "Микроволновка", airfryer: "Аэрогриль", multicooker: "Мультиварка · тушение" };
    const methodName = modes[method] || ({ chicken: "Духовка", eggs: "Сковорода" }[product] || "Плита");
    const aliases = { buckwheat: "греча гречи", oats: "овсянка", tongue: "говядина" };
    return {
      recipe, index, product, name, method, methodName,
      title: fold(recipe.title),
      spices: fold(recipe.spices.map(([spice]) => spice).join(" ")),
      registrySpices: recipe.spices.map(([spice]) => registryKeys.find(key => fold(spice).includes(key))),
      tags: fold([name, aliases[product] || "", methodName, method === "microwave" ? "СВЧ" : "", recipe.kicker].join(" "))
    };
  });

  const validTitles = new Set(recipes.map(recipe => recipe.title));
  function savedTitles(data) {
    return new Set((Array.isArray(data) ? data : []).filter(title => validTitles.has(title)));
  }
  let saved = savedTitles(readStore("localStorage", savedKey));
  const stepState = new Map();
  const storedSteps = readStore("sessionStorage", stepsKey);
  if (storedSteps && typeof storedSteps === "object") {
    for (const recipe of recipes) {
      const indices = storedSteps[recipe.title];
      if (Array.isArray(indices)) {
        stepState.set(recipe.title, new Set(indices.filter(i => Number.isInteger(i) && i >= 0 && i < recipe.steps.length)));
      }
    }
  }

  // Первый экран знакомит со всеми продуктами; дальнейшие страницы продолжают тот же порядок.
  const groups = Object.keys(products).map(product => entries.filter(entry => entry.product === product));
  const showcase = [];
  const rounds = Math.max(0, ...groups.map(group => group.length));
  for (let round = 0; round < rounds; round++) {
    for (const group of groups) if (group[round]) showcase.push(group[round]);
  }
  showcase.push(...entries.filter(entry => !Object.hasOwn(products, entry.product)));

  let savedOnly = false;
  let chosenSpice = "";
  let limit = pageSize;
  let active = null;
  let openingButton = null;
  let dialogCardChanged = false;

  function rank(entry, words, phrase) {
    let points = 0;
    for (const word of words) {
      if (entry.title.includes(word)) points += 5;
      else if (entry.spices.includes(word)) points += 3;
      else if (entry.tags.includes(word)) points += 2;
      else return -1;
    }
    return points + (entry.title.includes(phrase) ? 10 : 0);
  }

  function results() {
    const matches = showcase.filter(entry =>
      (!savedOnly || saved.has(entry.recipe.title)) &&
      (!chosenSpice || entry.registrySpices.includes(chosenSpice)) &&
      (selectedCategory === "all" || categories[selectedCategory].includes(entry.product)) &&
      (productSelect.value === "all" || productSelect.value === entry.product) &&
      (methodSelect.value === "all" || methodSelect.value === entry.method)
    );
    const phrase = fold(search.value);
    if (!phrase) return matches;
    const words = phrase.split(/\s+/);
    return matches.map(entry => ({ entry, score: rank(entry, words, phrase) }))
      .filter(match => match.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(match => match.entry);
  }

  function card(entry) {
    const { recipe, index, product, name, methodName } = entry;
    const marked = saved.has(recipe.title);
    const action = marked ? "Убрать из закладок" : "В закладки";
    const title = escapeHtml(recipe.title);
    return `<article class="recipe-card" data-product="${escapeHtml(product || "other")}" data-grain="${escapeHtml(recipe.id)}">
      <div class="card-photo food-photo" aria-hidden="true"></div>
      <button class="bookmark" type="button" data-save="${index}" aria-pressed="${marked}" aria-label="${action} — ${title}" title="${action}">${bookmarkIcon}</button>
      <div class="card-body">
        <p class="card-category">${escapeHtml(name)} · ${escapeHtml(methodName)}</p>
        <h3 class="card-title">${title}</h3>
        <p class="card-timing">${escapeHtml(recipe.timing || recipe.summary)}</p>
        <details class="card-seasoning"><summary>Когда добавлять приправы</summary>
          <ul>${recipe.spices.map(([name, , when]) => `<li><strong>${escapeHtml(name)}</strong> — ${escapeHtml(spiceTiming(recipe, when))}</li>`).join("")}</ul>
        </details>
        <button class="open-recipe" type="button" data-index="${index}" aria-label="Открыть рецепт — ${title}">Открыть рецепт <span aria-hidden="true">→</span></button>
      </div>
    </article>`;
  }

  function render(focusNext = false) {
    const previous = grid.childElementCount;
    const matches = results();
    grid.innerHTML = matches.slice(0, limit).map(card).join("");
    byId("catalog-heading").textContent = savedOnly ? "Мои закладки" : "Каталог рецептов";
    byId("results-title").textContent = recipeCount(matches.length);
    byId("saved-count").textContent = saved.size;
    savedTab.setAttribute("aria-pressed", String(savedOnly));
    allTab.setAttribute("aria-pressed", String(!savedOnly));
    categoryButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.category === selectedCategory)));
    moreButton.hidden = limit >= matches.length;
    moreButton.textContent = "Показать ещё " + Math.min(pageSize, Math.max(0, matches.length - limit));
    resetButton.hidden = !search.value && productSelect.value === "all" && methodSelect.value === "all" && selectedCategory === "all" && !chosenSpice;
    const empty = byId("empty-state");
    empty.hidden = matches.length !== 0;
    empty.textContent = savedOnly && !saved.size
      ? "Здесь будут ваши любимые рецепты. Нажмите на закладку в карточке, чтобы сохранить рецепт."
      : "Рецептов по такому запросу пока нет. Измените запрос или сбросьте фильтры.";
    if (focusNext) grid.children[previous]?.querySelector(".open-recipe")?.focus();
  }

  function updateDialogSave() {
    const marked = saved.has(active.recipe.title);
    dialogSave.setAttribute("aria-pressed", String(marked));
    dialogSave.innerHTML = bookmarkIcon + "<span>" + (marked ? "В закладках" : "В закладки") + "</span>";
  }

  function toggleSave(entry) {
    const title = entry.recipe.title;
    if (saved.has(title)) saved.delete(title);
    else saved.add(title);
    writeStore("localStorage", savedKey, [...saved]);
  }

  function refreshProgress() {
    const stepCount = stepState.get(active.recipe.title)?.size || 0;
    byId("step-progress").textContent = "Готово " + stepCount + " из " + active.recipe.steps.length;
  }

  function openRecipe(entry, trigger) {
    active = entry;
    openingButton = trigger;
    dialogCardChanged = false;
    const { recipe } = entry;
    dialog.dataset.product = entry.product || "";
    byId("dialog-grain").textContent = entry.name + " · " + entry.methodName;
    byId("dialog-title").textContent = recipe.title;
    byId("dialog-base").textContent = recipe.base || "";
    byId("dialog-timing").textContent = recipe.timing || recipe.summary;
    const summary = byId("dialog-summary");
    summary.textContent = recipe.summary || "";
    summary.hidden = !recipe.summary || !recipe.timing || fold(recipe.summary) === fold(recipe.timing);
    byId("dialog-spices").innerHTML = recipe.spices.map(([name, dose, when]) =>
      `<div class="spice-row"><div class="spice-name"><span>${escapeHtml(name)}</span><span class="spice-dose">${escapeHtml(dose)}</span></div><div class="spice-when">${escapeHtml(spiceTiming(recipe, when))}</div></div>`
    ).join("");
    const finished = stepState.get(recipe.title);
    byId("dialog-steps").innerHTML = recipe.steps.map((step, i) =>
      `<li class="step-item${finished?.has(i) ? " is-done" : ""}"><label class="step-check"><input type="checkbox" data-step="${i}" ${finished?.has(i) ? "checked" : ""}><span class="step-text">${escapeHtml(step)}</span></label></li>`
    ).join("");
    byId("dialog-note").innerHTML = "<strong>Важно</strong> " + recipe.note;
    updateDialogSave();
    refreshProgress();
    dialog.showModal();
    dialog.scrollTop = 0;
  }

  byId("dialog-steps").addEventListener("change", event => {
    const input = event.target.closest("input[data-step]");
    if (!input || !active) return;
    const title = active.recipe.title;
    const completed = stepState.get(title) || new Set();
    const index = Number(input.dataset.step);
    if (input.checked) completed.add(index);
    else completed.delete(index);
    if (completed.size) stepState.set(title, completed);
    else stepState.delete(title);
    input.closest("li").classList.toggle("is-done", input.checked);
    refreshProgress();
    writeStore("sessionStorage", stepsKey, Object.fromEntries([...stepState].map(([name, steps]) => [name, [...steps]])));
  });

  dialogSave.addEventListener("click", () => {
    if (!active) return;
    toggleSave(active);
    updateDialogSave();
    dialogCardChanged = true;
    byId("saved-count").textContent = saved.size;
  });
  dialog.querySelector(".close-dialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => {
    const index = active?.index;
    if (dialogCardChanged) render();
    const target = openingButton?.isConnected ? openingButton : grid.querySelector('[data-index="' + index + '"]');
    (target || (savedOnly ? savedTab : allTab)).focus();
    active = null;
  });

  grid.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-index")) {
      openRecipe(entries[Number(button.dataset.index)], button);
    } else if (button.hasAttribute("data-save")) {
      const index = Number(button.dataset.save);
      const position = [...grid.children].indexOf(button.closest("article"));
      toggleSave(entries[index]);
      render();
      const next = grid.querySelector('[data-save="' + index + '"]') ||
        grid.children[Math.min(position, grid.children.length - 1)]?.querySelector(".bookmark");
      (next || savedTab).focus();
    }
  });

  function rerun() { limit = pageSize; render(); }
  search.addEventListener("input", () => { chosenSpice = ""; rerun(); });
  categoryButtons.forEach(button => button.addEventListener("click", () => {
    selectedCategory = button.dataset.category;
    if (selectedCategory !== "all" && productSelect.value !== "all" && !categories[selectedCategory].includes(productSelect.value)) productSelect.value = "all";
    rerun();
  }));
  productSelect.addEventListener("change", () => {
    if (selectedCategory !== "all" && productSelect.value !== "all" && !categories[selectedCategory].includes(productSelect.value)) selectedCategory = "all";
    rerun();
  });
  methodSelect.addEventListener("change", rerun);
  moreButton.addEventListener("click", () => { limit += pageSize; render(true); });
  function clearFilters() {
    productSelect.value = "all";
    methodSelect.value = "all";
    search.value = "";
    chosenSpice = "";
    selectedCategory = "all";
  }
  resetButton.addEventListener("click", () => { clearFilters(); rerun(); search.focus(); });
  function switchTab(toSaved) {
    if (savedOnly !== toSaved) {
      savedOnly = toSaved;
      clearFilters();
      rerun();
    }
    const heading = byId("catalog-heading");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    byId("catalog").scrollIntoView({ block: "start" });
  }
  savedTab.addEventListener("click", () => switchTab(true));
  allTab.addEventListener("click", () => switchTab(false));
  window.addEventListener("storage", event => {
    if (event.key !== savedKey) return;
    saved = savedTitles(readStore("localStorage", savedKey));
    if (dialog.open) { updateDialogSave(); dialogCardChanged = true; }
    else render();
  });

  const spiceList = byId("registry-list");
  spiceList.innerHTML = registry.map((item, i) =>
    `<button type="button" class="registry-spice" data-spice="${i}" aria-label="Найти рецепты — ${escapeHtml(item)}">${escapeHtml(item)}</button>`
  ).join("");
  spiceList.addEventListener("click", event => {
    const button = event.target.closest("button[data-spice]");
    if (!button) return;
    const spice = registry[Number(button.dataset.spice)];
    savedOnly = false;
    clearFilters();
    chosenSpice = fold(spice);
    search.value = spice;
    rerun();
    search.focus({ preventScroll: true });
    byId("catalog").scrollIntoView({ block: "start" });
  });
  const deviceDialog = byId("device-dialog");
  const stoveForm = byId("stove-form");
  let helperReady = false;
  let stoveRunning = false;
  let stoveWarning = true;
  let pollTimer = null;

  function showStove(data) {
    stoveRunning = Boolean(data.running);
    stoveWarning = Boolean(data.warning);
    byId("stove-safety").hidden = !data.warning;
    if (data.warning) byId("stove-safety").textContent = data.warning + " Контролируйте воду отдельным термометром.";
    const reading = data.reading;
    const stateNames = { shutdown: "выключена", waiting: "ожидание", finish: "завершено", running: "работает" };
    const details = reading
      ? "Состояние: " + (stateNames[reading.state] || reading.state) + " · датчик плиты: " + reading.temperature +
        " °C · мощность: " + reading.power + "/99 · цель: " + reading.target + " °C. "
      : "";
    const progress = data.progress
      ? "Этап " + data.progress.stage + " · " + data.progress.phase +
        " · осталось " + Math.ceil(data.progress.remaining / 60) + " мин. "
      : "";
    byId("stove-status").textContent = details + progress + (data.message || "");
    byId("stove-start").disabled = !helperReady || stoveWarning || stoveRunning;
    byId("stove-stop").disabled = !helperReady || !stoveRunning;
    clearTimeout(pollTimer);
    if (stoveRunning && deviceDialog.open) pollTimer = setTimeout(() => readStove(false), 2500);
  }

  async function readStove(refresh) {
    try {
      const response = await fetch(refresh ? "api/stove/read" : "api/stove/status", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось получить состояние плиты.");
      showStove(result);
    } catch (error) {
      byId("stove-status").textContent = error.message || "Помощник недоступен.";
      byId("stove-start").disabled = true;
      byId("stove-stop").disabled = true;
    }
  }

  byId("device-open").addEventListener("click", async () => {
    if (location.protocol === "file:") {
      try {
        const response = await fetch("http://127.0.0.1:49738/health", {
          cache: "no-store", signal: AbortSignal.timeout(2000)
        });
        if (response.ok) {
          location.assign("http://127.0.0.1:49738/open#devices");
          return;
        }
      } catch {
        // На автономной странице остаётся прямая ссылка для повторного подключения.
      }
    }
    deviceDialog.showModal();
    if (helperReady) readStove(false);
  });
  byId("device-close").addEventListener("click", () => deviceDialog.close());
  deviceDialog.addEventListener("close", () => {
    clearTimeout(pollTimer);
    byId("device-open").focus();
  });

  if (location.protocol === "http:" && location.hostname === "127.0.0.1") {
    fetch("api/status", { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error("Помощник недоступен");
        return response.json();
      })
      .then(() => {
        helperReady = true;
        byId("helper-connect").hidden = true;
        byId("helper-status").textContent = "Помощник запущен. Для проверки плиты нажмите «Проверить связь и показания».";
        byId("helper-stop").hidden = false;
        byId("stove-read").disabled = false;
        readStove(false);
      })
      .catch(() => {});
  }

  byId("stove-read").addEventListener("click", async () => {
    byId("stove-read").disabled = true;
    byId("stove-status").textContent = "Читаю состояние плиты…";
    try { await readStove(true); }
    finally { byId("stove-read").disabled = !helperReady; }
  });
  stoveForm.addEventListener("submit", async event => {
    event.preventDefault();
    const fields = new FormData(stoveForm);
    const stages = [1, 2, 3].map(index => ({
      target: fields.get("target" + index) === "" ? null : Number(fields.get("target" + index)),
      minutes: fields.get("minutes" + index) === "" ? 0 : Number(fields.get("minutes" + index))
    }));
    if (!stages[0].minutes || !stages[0].target) {
      byId("stove-status").textContent = "Укажите температуру и выдержку первого этапа.";
      return;
    }
    if (!stages[1].minutes && stages[2].minutes) {
      byId("stove-status").textContent = "Заполните второй этап перед третьим.";
      return;
    }
    const summary = stages.filter(stage => stage.minutes)
      .map((stage, index) => (index + 1) + ". " + stage.target + " °C — " + stage.minutes + " мин").join("\n");
    if (!window.confirm("Запустить программу плиты?\n\n" + summary +
        "\n\nПоказание датчика плиты может отличаться от температуры воды. Оставайтесь рядом.")) return;
    try {
      const response = await fetch("api/stove/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Запуск не выполнен.");
      showStove(result);
    } catch (error) {
      byId("stove-status").textContent = error.message || "Запуск не выполнен.";
    }
  });

  byId("stove-stop").addEventListener("click", async () => {
    if (!window.confirm("Остановить программу, запущенную с сайта?")) return;
    try {
      const response = await fetch("api/stove/stop", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Остановка не выполнена.");
      showStove(result);
    } catch (error) {
      byId("stove-status").textContent = error.message || "Остановка не выполнена.";
    }
  });

  byId("helper-stop").addEventListener("click", async () => {
    try {
      const response = await fetch("api/stop", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось отключить связь.");
      helperReady = false;
      clearTimeout(pollTimer);
      byId("stove-read").disabled = true;
      byId("stove-start").disabled = true;
      byId("stove-stop").disabled = true;
      byId("helper-stop").hidden = true;
      byId("helper-connect").hidden = false;
      byId("helper-status").textContent = "Помощник отключён.";
    } catch (error) {
      byId("helper-status").textContent = error.message || "Не удалось отключить связь.";
    }
  });
  render();
  if (location.hash === "#devices") deviceDialog.showModal();
})();
