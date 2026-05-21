/* 本科专业目录 · 2026 — 前端交互 */
(function () {
  "use strict";

  const DATA = window.MAJORS_DATA;
  if (!DATA) {
    console.error("MAJORS_DATA 未加载");
    return;
  }

  // 全国高校元数据，按 yxdm 索引
  const UNIV = window.UNIVERSITIES || { provinces: {}, list: [] };
  const UNIV_BY_YXDM = {};
  for (const u of UNIV.list) UNIV_BY_YXDM[u.yxdm] = u;
  const PROVINCE_BY_SSDM = UNIV.provinces || {};

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
    const base = "本科专业目录 · 2026";
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

    const hint = introHint(m.intro);
    btn.innerHTML = `
      <span class="major__code">${codeHTML}</span>
      <span class="major__main">
        <span class="major__name">${nameHTML}${tags.join("")}</span>
        ${pathLine}
        ${hint ? `<span class="major__has-intro">${hint}</span>` : ""}
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

    const introHTML = renderIntroSection(m.intro);

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
      ${gotoCategoryHTML(cat)}`;

    openDrawer(drawer);
  }

  // 只在不知道当前位置时（搜索、首页）才显示「前往本门类」入口
  function gotoCategoryHTML(cat) {
    const route = parseRoute();
    if (route.view === "category" && route.code === cat.code) return "";
    return `
      <section class="detail__section">
        <h3>查看同类</h3>
        <p><a href="#/c/${cat.code}">前往「${escapeHTML(cat.name)}」门类目录页 →</a></p>
      </section>`;
  }

  // ---------- 专业介绍 ----------
  // intro 的形态由 scripts/merge_intro.py 决定：
  //   {specId, summary?, jyfx?, kyfx?, satisfaction?, scale?, gender?, schools?, year?, interpretation?}
  // 渲染顺序：官方简介 → 典型就业 → 在校生画像 → 考研方向 → 开设院校 → 外部专家解读

  function introHint(intro) {
    if (!intro) return "";
    if (intro.interpretation || intro.summary) return "查看介绍 →";
    // 新专业暂无介绍文本，但有考研方向/学生规模/推荐院校等
    if (intro.kyfx || intro.scale || intro.gender || intro.schools) return "查看资料 →";
    return "";
  }

  function renderIntroSection(intro) {
    // 真的什么都没有（理论上不应该出现，所有专业都至少有 specId）
    if (!intro) {
      return `<section class="detail__section">
        <h3>专业介绍</h3>
        <div class="placeholder">该专业的介绍正在筹备中，敬请期待。</div>
      </section>`;
    }

    const hasContent =
      intro.summary ||
      intro.interpretation ||
      (intro.jyfx && intro.jyfx.length) ||
      intro.kyfx ||
      intro.scale ||
      intro.gender ||
      intro.schools;

    if (!hasContent) {
      // 完全没数据，多半是 2024 后新增专业，阳光高考也还没收录
      return `<section class="detail__section detail__section--intro">
        <h3>专业介绍</h3>
        <p class="placeholder">该专业为新设/年轻专业，详细介绍待官方补充。</p>
        ${renderIntroFooter(intro)}
      </section>`;
    }

    const parts = [];
    if (intro.summary) parts.push(renderSummary(intro.summary));
    parts.push(renderJyfx(intro));
    parts.push(renderProfile(intro));
    parts.push(renderKyfx(intro));
    parts.push(renderSchools(intro.schools));
    // 解读的三小节正文作为"详解"接在最下面，去掉作者/导语/标题等装饰
    if (intro.interpretation) parts.push(renderChapters(intro.interpretation.sections));
    parts.push(renderIntroFooter(intro));

    return `<section class="detail__section detail__section--intro">
      <h3>专业介绍</h3>
      ${parts.filter(Boolean).join("")}
    </section>`;
  }

  function renderChapters(sections) {
    if (!Array.isArray(sections) || !sections.length) return "";
    const cNum = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    return sections
      .map(
        (sec, i) => `
        <div class="intro__chapter">
          <h4 class="intro__chapter-title">
            <em class="intro__chapter-num">${cNum[i] || i + 1}</em>
            <span>${escapeHTML(sec.title)}</span>
          </h4>
          <div class="intro__rich">${sanitizeHTML(sec.html)}</div>
        </div>`
      )
      .join("");
  }

  function renderSummary(summary) {
    return `
      <div class="intro__group intro__group--summary">
        <h4 class="intro__group-title">官方简介</h4>
        <p class="intro__summary">${escapeHTML(summary)}</p>
      </div>`;
  }

  function renderJyfx(intro) {
    if (!Array.isArray(intro.jyfx) || !intro.jyfx.length) return "";
    return `
      <div class="intro__group">
        <h4 class="intro__group-title">典型就业方向</h4>
        <ul class="intro__tags">
          ${intro.jyfx.map((x) => `<li>${escapeHTML(x)}</li>`).join("")}
        </ul>
      </div>`;
  }

  function renderKyfx(intro) {
    if (!Array.isArray(intro.kyfx) || !intro.kyfx.length) return "";
    return `
      <div class="intro__group">
        <h4 class="intro__group-title">考研可关注的学科</h4>
        <ul class="intro__tags intro__tags--soft">
          ${intro.kyfx
            .map(
              (x) => `<li>
                <span class="intro__kyfx-code" translate="no">${escapeHTML(x.code || "")}</span>
                <span>${escapeHTML(x.name || "")}</span>
              </li>`
            )
            .join("")}
        </ul>
      </div>`;
  }

  function renderProfile(intro) {
    if (!intro.scale && !intro.gender) return "";
    const items = [];
    if (intro.scale) {
      items.push(
        `<span class="intro__profile-item"><span class="intro__profile-label">学生规模</span><b>${escapeHTML(intro.scale)}</b> 人</span>`
      );
    }
    if (intro.gender) {
      const [b, g] = intro.gender;
      items.push(
        `<span class="intro__profile-item"><span class="intro__profile-label">男女比例</span><b>${b}</b> : <b>${g}</b></span>`
      );
    }
    return `
      <div class="intro__group">
        <h4 class="intro__group-title">在校生画像</h4>
        <div class="intro__profile">${items.join("")}</div>
      </div>`;
  }

  // ---------- 开设院校（每页 10 所 + 文本筛选 + 标签筛选） ----------
  const SCHOOLS_PAGE_SIZE = 10;
  const SCHOOLS_CACHE = {}; // id -> { yxdms, filtered, query, tags:Set, page }
  let SCHOOLS_NEXT_ID = 0;

  function renderSchools(schools) {
    if (!schools || !Array.isArray(schools.list) || !schools.list.length) return "";
    const id = ++SCHOOLS_NEXT_ID;
    SCHOOLS_CACHE[id] = {
      yxdms: schools.list,
      filtered: schools.list,
      query: "",
      tags: new Set(),
      page: 1,
    };
    const total = schools.total || schools.list.length;
    const showSearch = schools.list.length > SCHOOLS_PAGE_SIZE;
    return `
      <div class="intro__group">
        <h4 class="intro__group-title">开设院校 <span class="intro__group-meta">共 ${total} 所</span></h4>
        <div class="intro__schools-pager" data-cache="${id}">
          ${showSearch ? `<div class="intro__schools-toolbar">
            <input class="intro__schools-search" type="search" placeholder="搜院校名或省份…" />
            <div class="intro__schools-tags">
              <button class="intro__schools-tag-btn" data-tag="985">985</button>
              <button class="intro__schools-tag-btn" data-tag="211">211</button>
              <button class="intro__schools-tag-btn" data-tag="syl">双一流</button>
            </div>
            <span class="intro__schools-matched"></span>
          </div>` : ""}
          <div class="intro__schools-body">${renderSchoolsBody(id)}</div>
        </div>
      </div>`;
  }

  function renderSchoolsBody(id) {
    const c = SCHOOLS_CACHE[id];
    if (!c.filtered.length) {
      return `<div class="intro__schools-empty">未匹配到院校</div>`;
    }
    const pages = Math.max(1, Math.ceil(c.filtered.length / SCHOOLS_PAGE_SIZE));
    if (c.page > pages) c.page = pages;
    return `
      <ul class="intro__schools">${renderSchoolPage(c.filtered, c.page - 1)}</ul>
      ${pages > 1 ? renderSchoolsPagination(c.page, pages) : ""}`;
  }

  function renderSchoolPage(yxdms, page0) {
    const start = page0 * SCHOOLS_PAGE_SIZE;
    return yxdms
      .slice(start, start + SCHOOLS_PAGE_SIZE)
      .map((yxdm) => renderSchoolItem(yxdm))
      .join("");
  }

  function schoolMatchesTag(u, tag) {
    const tags = u.tags || [];
    if (tag === "985") return tags.includes("985");
    if (tag === "211") return tags.includes("211");
    if (tag === "syl") {
      return !!u.syl || tags.some((t) => /一流大学|双一流/.test(t));
    }
    return false;
  }

  function filterSchools(yxdms, query, activeTags) {
    const q = (query || "").trim();
    const hasTags = activeTags && activeTags.size > 0;
    if (!q && !hasTags) return yxdms;
    return yxdms.filter((yxdm) => {
      const u = UNIV_BY_YXDM[yxdm];
      if (!u) return false;
      if (q) {
        const prov = PROVINCE_BY_SSDM[u.ssdm] || "";
        if (!(u.name || "").includes(q) && !prov.includes(q)) return false;
      }
      if (hasTags) {
        // 标签之间 OR：任一勾选标签匹配即可
        let any = false;
        for (const t of activeTags) {
          if (schoolMatchesTag(u, t)) { any = true; break; }
        }
        if (!any) return false;
      }
      return true;
    });
  }

  function renderSchoolItem(yxdm) {
    const u = UNIV_BY_YXDM[yxdm];
    if (!u) {
      return `<li class="intro__school">
        <span class="intro__school-code">${escapeHTML(yxdm)}</span>
        <span class="intro__school-name">[未知]</span>
      </li>`;
    }
    const prov = PROVINCE_BY_SSDM[u.ssdm] || "";
    const tags = (u.tags && u.tags.length) ? u.tags : (u.syl ? ["双一流"] : []);
    const badgeHTML = tags
      .map((t) => `<span class="intro__school-tag tag-${tagClass(t)}">${escapeHTML(t)}</span>`)
      .join("");
    const name = escapeHTML(u.name || "");
    const nameHTML = u.schid
      ? `<a class="intro__school-name" href="https://gaokao.chsi.com.cn/sch/schoolInfo--schId-${escapeHTML(u.schid)}.dhtml" target="_blank" rel="noopener">${name}</a>`
      : `<span class="intro__school-name">${name}</span>`;
    return `<li class="intro__school">
      <span class="intro__school-code">${escapeHTML(yxdm)}</span>
      <span class="intro__school-main">
        ${nameHTML}
        ${badgeHTML ? `<span class="intro__school-badges">${badgeHTML}</span>` : ""}
      </span>
      <span class="intro__school-meta">${prov ? escapeHTML(prov) : ""}</span>
    </li>`;
  }

  function tagClass(t) {
    if (/985/.test(t)) return "985";
    if (/211/.test(t)) return "211";
    if (/双一流|一流大学|一流学科/.test(t)) return "syl";
    return "default";
  }

  function renderSchoolsPagination(page, pages) {
    return `<div class="intro__schools-pagination">
      <button class="intro__page-btn" data-act="prev" ${page === 1 ? "disabled" : ""}>‹ 上一页</button>
      <span class="intro__page-info">第 <b>${page}</b> / ${pages} 页</span>
      <button class="intro__page-btn" data-act="next" ${page === pages ? "disabled" : ""}>下一页 ›</button>
    </div>`;
  }

  // 事件委托：分页 / 搜索 / 标签筛选 共用一个 pager 状态
  function refilterAndRerender(pager) {
    const id = pager.dataset.cache;
    const c = SCHOOLS_CACHE[id];
    c.filtered = filterSchools(c.yxdms, c.query, c.tags);
    c.page = 1;
    pager.querySelector(".intro__schools-body").innerHTML = renderSchoolsBody(id);
    const matched = pager.querySelector(".intro__schools-matched");
    if (matched) {
      const hasFilter = c.query || c.tags.size > 0;
      matched.textContent = hasFilter ? `匹配 ${c.filtered.length} 所` : "";
    }
  }

  document.addEventListener("click", (e) => {
    // 标签筛选按钮
    const tagBtn = e.target.closest(".intro__schools-tag-btn");
    if (tagBtn) {
      const pager = tagBtn.closest(".intro__schools-pager");
      const c = SCHOOLS_CACHE[pager.dataset.cache];
      const t = tagBtn.dataset.tag;
      if (c.tags.has(t)) { c.tags.delete(t); tagBtn.classList.remove("is-active"); }
      else { c.tags.add(t); tagBtn.classList.add("is-active"); }
      refilterAndRerender(pager);
      return;
    }
    // 分页按钮
    const pageBtn = e.target.closest(".intro__schools-pagination .intro__page-btn");
    if (pageBtn) {
      const pager = pageBtn.closest(".intro__schools-pager");
      const id = pager.dataset.cache;
      const c = SCHOOLS_CACHE[id];
      const pages = Math.max(1, Math.ceil(c.filtered.length / SCHOOLS_PAGE_SIZE));
      if (pageBtn.dataset.act === "prev" && c.page > 1) c.page--;
      else if (pageBtn.dataset.act === "next" && c.page < pages) c.page++;
      else return;
      pager.querySelector(".intro__schools-body").innerHTML = renderSchoolsBody(id);
    }
  });

  document.addEventListener("input", (e) => {
    if (!e.target.matches(".intro__schools-search")) return;
    const pager = e.target.closest(".intro__schools-pager");
    SCHOOLS_CACHE[pager.dataset.cache].query = e.target.value;
    refilterAndRerender(pager);
  });

  function renderIntroFooter(intro) {
    const specId = intro && intro.specId;
    if (!specId) return "";
    const url = `https://gaokao.chsi.com.cn/zyk/zybk/detail/${encodeURIComponent(specId)}`;
    const year = intro.year ? `${intro.year} 年` : "";
    return `
      <div class="intro__footer">
        <a class="intro__external" href="${url}" target="_blank" rel="noopener noreferrer">
          在阳光高考查看完整专业页 →
        </a>
        <p class="intro__credit">资料来源：教育部阳光高考信息平台${year ? ` · ${year}采集` : ""}</p>
      </div>`;
  }

  // 解读富文本只来自阳光高考且标签可控：<p><strong><em><h3-h5><span><br><ul><ol><li>
  // 还是做一遍白名单 sanitize，扔掉所有属性，避免万一塞了 onclick 类的脏数据
  const ALLOWED_TAGS = new Set([
    "p", "strong", "b", "em", "i", "u", "span", "br",
    "h3", "h4", "h5", "ul", "ol", "li", "div",
  ]);
  function sanitizeHTML(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 1) {
          const tag = child.tagName.toLowerCase();
          if (!ALLOWED_TAGS.has(tag)) {
            child.replaceWith(doc.createTextNode(child.textContent || ""));
            return;
          }
          Array.from(child.attributes).forEach((a) => child.removeAttribute(a.name));
          walk(child);
        } else if (child.nodeType === 8) {
          child.remove();
        }
      });
    };
    walk(doc.body);
    return doc.body.innerHTML;
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

  // #open-notes 现在在 tpl-home 模板里（首次 DOMContentLoaded 时还没渲染），用事件委托
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("#open-notes")) openNotes();
  });

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

  // 暴露最小 helper 给 ai.js 复用（打开抽屉 / 跳详情）
  window.__app = {
    openMajor: openMajorDetail,
    openDrawer,
    closeDrawer,
  };
})();
