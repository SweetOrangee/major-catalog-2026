/* 本科专业目录 · 2026 — 前端交互 */
(function () {
  "use strict";

  const DATA = window.MAJORS_DATA;
  if (!DATA) {
    console.error("MAJORS_DATA 未加载");
    return;
  }

  // ---------- 工具 ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const escapeHTML = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  // 高亮：对名字中匹配 query 的子串包裹 <mark>
  const highlight = (text, q) => {
    if (!q) return escapeHTML(text);
    const safe = escapeHTML(text);
    const safeQ = escapeHTML(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return safe.replace(new RegExp(safeQ, "gi"), (m) => `<mark class="hl">${m}</mark>`);
  };

  // 扁平化索引，加速搜索
  const FLAT = [];
  for (const cat of DATA.categories) {
    for (const cls of cat.classes) {
      for (const m of cls.majors) {
        FLAT.push({
          ...m,
          categoryCode: cat.code,
          categoryName: cat.name,
          classCode: cls.code,
          className: cls.name,
          classSynthetic: !!cls.synthetic,
        });
      }
    }
  }

  // ---------- 路由 ----------
  function parseRoute() {
    const h = (location.hash || "").replace(/^#\/?/, "");
    if (!h) return { view: "home" };
    const parts = h.split("/").filter(Boolean);
    if (parts[0] === "c" && parts[1]) return { view: "category", code: parts[1] };
    if (parts[0] === "q" && parts.length > 1) {
      return { view: "search", query: decodeURIComponent(parts.slice(1).join("/")) };
    }
    return { view: "home" };
  }

  function navigate(hash, { replace = false } = {}) {
    if (replace) history.replaceState(null, "", hash);
    else if (location.hash === hash) render();
    else location.hash = hash;
  }

  // ---------- 渲染 ----------
  const host = $("#main");

  function clearHost() {
    host.innerHTML = "";
    // 切换视图时回到顶部，避免沿用上一个视图的滚动位置
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  function setTitle(suffix) {
    const base = "本科专业目录 · 2026 · 教育部";
    document.title = suffix ? `${suffix} · ${base}` : base;
  }

  // 首页
  function renderHome() {
    clearHost();
    host.appendChild($("#tpl-home").content.cloneNode(true));
    setTitle("");

    $("[data-stat=categories]").textContent = DATA.stats.categories;
    $("[data-stat=classes]").textContent = DATA.stats.classes;
    $("[data-stat=majors]").textContent = DATA.stats.majors;

    const list = $("#catalog-list");
    const frag = document.createDocumentFragment();
    DATA.categories.forEach((cat, idx) => {
      const count = cat.classes.reduce((s, c) => s + c.majors.length, 0);
      const li = document.createElement("li");
      li.style.setProperty("--i", idx);
      li.innerHTML = `
        <a class="catalog-item" href="#/c/${cat.code}">
          <span class="catalog-item__code">${cat.code}</span>
          <span class="catalog-item__name">${escapeHTML(cat.name)}</span>
          <span class="catalog-item__dots" aria-hidden="true"></span>
          <span class="catalog-item__count"><em>${count}</em>本科专业</span>
        </a>`;
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  // 门类页
  function renderCategory(code) {
    const cat = DATA.categories.find((c) => c.code === code);
    if (!cat) return navigate("");

    clearHost();
    host.appendChild($("#tpl-category").content.cloneNode(true));
    setTitle(`${cat.code} ${cat.name}`);

    $("[data-breadcrumb-current]").textContent = cat.name;
    $("[data-cat-code]").textContent = cat.code;
    $("[data-cat-name]").textContent = cat.name;

    const realClasses = cat.classes.filter((c) => !c.synthetic);
    const totalMajors = cat.classes.reduce((s, c) => s + c.majors.length, 0);
    $("[data-cat-class-count]").textContent = realClasses.length || cat.classes.length;
    $("[data-cat-major-count]").textContent = totalMajors;

    // TOC
    const toc = $("[data-cat-toc]");
    const tocFrag = document.createDocumentFragment();
    for (const cls of cat.classes) {
      const li = document.createElement("li");
      const label = cls.synthetic ? "直辖专业" : escapeHTML(cls.name);
      const num = cls.synthetic ? "·" : cls.code;
      li.innerHTML = `
        <a href="#cls-${cls.code}" data-toc-target="cls-${cls.code}">
          <span class="cat-toc__num">${num}</span>
          <span>${label}</span>
        </a>`;
      tocFrag.appendChild(li);
    }
    toc.appendChild(tocFrag);

    // 内容
    const content = $("[data-cat-content]");
    const contentFrag = document.createDocumentFragment();
    for (const cls of cat.classes) {
      const sec = document.createElement("section");
      sec.className = "cls-block";
      sec.id = `cls-${cls.code}`;

      const head = document.createElement("div");
      head.className = "cls-block__head";
      if (cls.synthetic) {
        head.innerHTML = `
          <h2 class="cls-block__name">本门类直辖专业</h2>
          <span class="cls-block__count">${cls.majors.length} 个本科专业</span>`;
      } else {
        head.innerHTML = `
          <span class="cls-block__code">${cls.code}</span>
          <h2 class="cls-block__name">${escapeHTML(cls.name)}</h2>
          <span class="cls-block__count">${cls.majors.length} 个本科专业</span>`;
      }
      sec.appendChild(head);

      const grid = document.createElement("ul");
      grid.className = "major-grid";
      for (const m of cls.majors) {
        const li = document.createElement("li");
        li.appendChild(majorButton(m, cat, cls));
        grid.appendChild(li);
      }
      sec.appendChild(grid);
      contentFrag.appendChild(sec);
    }
    content.appendChild(contentFrag);

    setupTocObserver();

    // 平滑滚动锚点
    toc.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-toc-target]");
      if (!a) return;
      const target = document.getElementById(a.dataset.tocTarget);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // 单条专业按钮
  function majorButton(m, cat, cls, opts = {}) {
    const { query = "", showPath = false } = opts;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "major";
    btn.dataset.majorCode = m.code;

    const tags = [];
    if (m.isSpecial) tags.push('<em class="tag tag--T" aria-label="特设专业">T</em>');
    if (m.isControlled) tags.push('<em class="tag tag--K" aria-label="国家控制布点专业">K</em>');

    const nameHTML = query ? highlight(m.name, query) : escapeHTML(m.name);
    const codeHTML = query ? highlight(m.code, query) : escapeHTML(m.code);

    let pathLine = "";
    if (showPath) {
      const cls2 = cls && !cls.synthetic ? ` · ${escapeHTML(cls.name)}` : "";
      pathLine = `<span class="major__note">${cat.code} ${escapeHTML(cat.name)}${cls2}</span>`;
    } else if (m.note) {
      pathLine = `<span class="major__note">${escapeHTML(m.note)}</span>`;
    }

    btn.innerHTML = `
      <span class="major__code">${codeHTML}</span>
      <span class="major__main">
        <span class="major__name">${nameHTML}${tags.join("")}</span>
        ${pathLine}
        ${m.intro ? `<span class="major__has-intro">查看专业介绍 →</span>` : ""}
      </span>`;

    btn.addEventListener("click", () => openMajorDetail(m, cat, cls));
    return btn;
  }

  // 搜索页
  function renderSearch(query) {
    clearHost();
    host.appendChild($("#tpl-search").content.cloneNode(true));
    setTitle(`检索：${query}`);

    $("[data-search-q]").textContent = query;
    const results = filterMajors(query);
    $("[data-search-count]").textContent = results.length;

    const container = $("[data-search-results]");
    const emptyEl = $("[data-search-empty]");

    if (results.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    // 按门类分组
    const byCat = new Map();
    for (const m of results) {
      if (!byCat.has(m.categoryCode)) byCat.set(m.categoryCode, []);
      byCat.get(m.categoryCode).push(m);
    }

    const frag = document.createDocumentFragment();
    for (const [catCode, items] of byCat) {
      const cat = DATA.categories.find((c) => c.code === catCode);
      const sec = document.createElement("section");
      sec.className = "cls-block";

      const head = document.createElement("div");
      head.className = "cls-block__head";
      head.innerHTML = `
        <span class="cls-block__code">${cat.code}</span>
        <h2 class="cls-block__name"><a href="#/c/${cat.code}">${escapeHTML(cat.name)}</a></h2>
        <span class="cls-block__count">${items.length} 个匹配</span>`;
      sec.appendChild(head);

      const grid = document.createElement("ul");
      grid.className = "major-grid";
      for (const m of items) {
        const cls = cat.classes.find((c) => c.code === m.classCode);
        const li = document.createElement("li");
        li.appendChild(
          majorButton(m, cat, cls, { query, showPath: !cls?.synthetic && true })
        );
        grid.appendChild(li);
      }
      sec.appendChild(grid);
      frag.appendChild(sec);
    }
    container.appendChild(frag);
  }

  // 搜索过滤：匹配代码、专业名、专业类名、门类名
  function filterMajors(q) {
    const qs = q.trim().toLowerCase();
    if (!qs) return [];
    return FLAT.filter((m) => {
      return (
        m.code.toLowerCase().includes(qs) ||
        m.name.toLowerCase().includes(qs) ||
        (!m.classSynthetic && m.className.toLowerCase().includes(qs)) ||
        m.categoryName.toLowerCase().includes(qs)
      );
    });
  }

  // ---------- TOC 同步高亮 ----------
  let tocObserver = null;
  function setupTocObserver() {
    if (tocObserver) tocObserver.disconnect();
    const links = $$("[data-toc-target]");
    if (!links.length) return;
    const targets = links
      .map((a) => document.getElementById(a.dataset.tocTarget))
      .filter(Boolean);
    if (!targets.length) return;

    tocObserver = new IntersectionObserver(
      (entries) => {
        // 找出最靠近顶部的可见块
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.target.offsetTop - b.target.offsetTop);
        if (!visible.length) return;
        const id = visible[0].target.id;
        for (const a of links) {
          if (a.dataset.tocTarget === id) a.setAttribute("aria-current", "true");
          else a.removeAttribute("aria-current");
        }
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 }
    );
    targets.forEach((t) => tocObserver.observe(t));
  }

  // ---------- 抽屉 ----------
  const drawer = $("#drawer");
  const drawerBody = $("#drawer-body");
  const notesDialog = $("#notes-dialog");
  const notesBody = $("#notes-body");

  let lastFocus = null;

  function openDrawer(el) {
    lastFocus = document.activeElement;
    el.hidden = false;
    el.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => el.classList.add("is-open"));
    document.body.style.overflow = "hidden";
    // 把焦点移到关闭按钮
    const close = el.querySelector(".drawer__close");
    if (close) close.focus({ preventScroll: true });
  }

  function closeDrawer(el) {
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    setTimeout(() => {
      el.hidden = true;
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }, 260);
  }

  function openMajorDetail(m, cat, cls) {
    const tags = [];
    if (m.isSpecial) tags.push('<em class="tag tag--T" aria-label="特设专业">T</em>');
    if (m.isControlled) tags.push('<em class="tag tag--K" aria-label="国家控制布点专业">K</em>');

    const typeLabel = [
      m.isSpecial ? "特设专业（T）" : "基本专业",
      m.isControlled ? "国家控制布点（K）" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const classRow = cls && !cls.synthetic
      ? `<dt>所属专业类</dt><dd>${cls.code} ${escapeHTML(cls.name)}</dd>`
      : `<dt>所属层级</dt><dd>${escapeHTML(cat.name)}（直辖）</dd>`;

    const noteHTML = m.note
      ? `<section class="detail__section">
           <h3>官方括注</h3>
           <p>${escapeHTML(m.note)}</p>
         </section>`
      : "";

    const introHTML = m.intro
      ? `<section class="detail__section">
           <h3>专业介绍</h3>
           ${renderIntro(m.intro)}
         </section>`
      : `<section class="detail__section">
           <h3>专业介绍</h3>
           <div class="placeholder">该专业的介绍正在筹备中，敬请期待。</div>
         </section>`;

    drawerBody.innerHTML = `
      <p class="detail__eyebrow">${cat.code} ${escapeHTML(cat.name)}</p>
      <p class="detail__code" translate="no">${escapeHTML(m.code)}</p>
      <h2 class="detail__name" id="drawer-title">
        ${escapeHTML(m.name)}${tags.join("")}
      </h2>
      <dl class="detail__meta">
        <dt>专业代码</dt><dd translate="no">${escapeHTML(m.code)}</dd>
        ${classRow}
        <dt>所属门类</dt><dd>${cat.code} ${escapeHTML(cat.name)}</dd>
        <dt>专业类型</dt><dd>${typeLabel}</dd>
      </dl>
      ${noteHTML}
      ${introHTML}
      <section class="detail__section">
        <h3>查看同类</h3>
        <p><a href="#/c/${cat.code}">前往「${escapeHTML(cat.name)}」门类目录页 →</a></p>
      </section>`;

    openDrawer(drawer);
  }

  function renderIntro(intro) {
    // 支持字符串或 {summary, points: [], outlets: []} 这类结构，按你后续定义扩展
    if (typeof intro === "string") {
      return `<p>${escapeHTML(intro)}</p>`;
    }
    if (intro && typeof intro === "object") {
      let html = "";
      if (intro.summary) html += `<p>${escapeHTML(intro.summary)}</p>`;
      if (Array.isArray(intro.points) && intro.points.length) {
        html += `<ul>${intro.points.map((p) => `<li>${escapeHTML(p)}</li>`).join("")}</ul>`;
      }
      if (Array.isArray(intro.outlets) && intro.outlets.length) {
        html += `<p><strong>典型出口：</strong>${intro.outlets.map(escapeHTML).join(" / ")}</p>`;
      }
      return html || `<p>${escapeHTML(JSON.stringify(intro))}</p>`;
    }
    return "";
  }

  function openNotes() {
    notesBody.innerHTML = `
      <div class="notes-body">
        <h2 id="notes-title">凡　例</h2>
        <ol>
          ${DATA.meta.notes.map((n) => `<li><p>${escapeHTML(n)}</p></li>`).join("")}
        </ol>
      </div>`;
    openDrawer(notesDialog);
  }

  // ---------- 搜索框 ----------
  const searchForm = $("#search-form");
  const searchInput = $("#search-input");

  let searchDebounce = null;
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      if (!q) {
        navigate("");
      } else {
        navigate(`#/q/${encodeURIComponent(q)}`);
      }
    }, 120);
  });
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q) navigate(`#/q/${encodeURIComponent(q)}`);
  });

  // ---------- 全局快捷键 ----------
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (drawer.classList.contains("is-open")) return closeDrawer(drawer);
      if (notesDialog.classList.contains("is-open")) return closeDrawer(notesDialog);
    }
    // 在输入框/可编辑元素之外按 "/" 聚焦搜索框
    const tag = (e.target && e.target.tagName) || "";
    const inField = tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable;
    if (e.key === "/" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  // 关闭抽屉
  document.addEventListener("click", (e) => {
    if (e.target.matches("[data-close]") || e.target.closest("[data-close]")) {
      if (drawer.classList.contains("is-open")) closeDrawer(drawer);
      else if (notesDialog.classList.contains("is-open")) closeDrawer(notesDialog);
    }
  });

  $("#open-notes").addEventListener("click", openNotes);

  // ---------- 主渲染 ----------
  function render() {
    const route = parseRoute();
    // 同步搜索框文本（如果从其他视图跳回 home）
    if (route.view !== "search" && searchInput.value && !document.activeElement?.matches("#search-input")) {
      searchInput.value = "";
    }
    if (route.view === "search" && searchInput.value !== route.query) {
      // 不打断用户输入：仅当差异较大才回填
      if (document.activeElement !== searchInput) searchInput.value = route.query;
    }

    if (route.view === "home") return renderHome();
    if (route.view === "category") return renderCategory(route.code);
    if (route.view === "search") return renderSearch(route.query);
    renderHome();
  }

  window.addEventListener("hashchange", render);
  render();
})();
