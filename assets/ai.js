/* AI 专业推荐 — 极简表单 + 调用 + 渲染。复用 #drawer 显示，关闭/Esc/scrim 由 app.js 已有委托处理。 */
(function () {
  "use strict";

  const btn = document.getElementById("open-ai");
  if (!btn) return;

  const drawer = document.getElementById("drawer");
  const drawerBody = document.getElementById("drawer-body");
  if (!drawer || !drawerBody) return;

  // 本次会话内缓存上一次的 panel HTML（含表单 + 结果），
  // 这样用户点专业详情跳转、关闭后再点 AI 按钮还能看到推荐列表
  let lastPanelHTML = null;

  btn.addEventListener("click", openAIPanel);

  function openAIPanel() {
    renderPanel(lastPanelHTML || renderForm());
    if (window.__app && typeof window.__app.openDrawer === "function") {
      window.__app.openDrawer(drawer);
    } else {
      drawer.hidden = false;
      drawer.setAttribute("aria-hidden", "false");
      drawer.classList.add("is-open");
    }
  }

  // 写入 HTML 并把表单事件挂上去（恢复缓存时也要重新 bind）
  function renderPanel(html) {
    drawerBody.innerHTML = html;
    const form = document.getElementById("ai-form");
    if (form) form.addEventListener("submit", handleSubmit);
  }

  function renderForm() {
    return `
      <section class="ai-panel">
        <h2 class="ai-panel__title" id="drawer-title">AI 推荐适合我的专业</h2>
        <p class="ai-panel__hint">
          说说你的兴趣、擅长科目、性格或未来想做什么，AI 会从 883 个本科专业里挑出几个适合你的方向。
        </p>
        <form id="ai-form" class="ai-form" autocomplete="off">
          <textarea
            name="interest"
            rows="5"
            maxlength="500"
            required
            placeholder="例：我数学物理都不错，喜欢动手做项目、不太喜欢死记硬背，对人工智能和机器人感兴趣…"></textarea>
          <div class="ai-form__row">
            <button type="submit" class="ai-submit">找适合我的专业</button>
          </div>
        </form>
        <p class="ai-disclaimer">推荐由 AI 生成，仅作启发，请结合老师/家长意见综合判断。</p>
        <div id="ai-result"></div>
      </section>`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const interest = e.target.interest.value.trim();
    const result = document.getElementById("ai-result");
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "AI 思考中…";
    result.innerHTML = '<p class="ai-loading">正在为你寻找匹配的专业，约需 5-10 秒…</p>';

    try {
      const resp = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interest }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const detail = Array.isArray(data.detail) ? "<ul>" + data.detail.map(d => `<li>${escapeHTML(d)}</li>`).join("") + "</ul>" : "";
        throw new Error((data.error || "请求失败") + detail);
      }
      if (data.irrelevant) {
        // 无关输入：展示固定引导文案；不缓存，让下次点 AI 回到全新表单
        result.innerHTML = `<div class="ai-hint">${escapeHTML(data.hint || "请告诉我你的兴趣、擅长科目或未来想做什么，我才能为你推荐适合的专业。")}</div>`;
      } else {
        result.innerHTML = renderRecs(data.recs);
        lastPanelHTML = drawerBody.innerHTML;
      }
    } catch (err) {
      result.innerHTML = `<div class="ai-error">${err.message}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "重新推荐";
    }
  }

  function renderRecs(recs) {
    if (!recs || !recs.length) {
      return '<p class="ai-empty">未能给出推荐，请换一种描述试试。</p>';
    }
    const head = `<p class="ai-recs__by">为你推荐 ${recs.length} 个方向</p>`;
    const items = recs.map(r => {
      const triple = lookupMajor(r.code);
      if (!triple) return "";
      return `<li class="ai-rec">
        <button type="button" class="ai-rec__head" data-code="${r.code}">
          <span class="ai-rec__code">${r.code}</span>
          <span class="ai-rec__name">${escapeHTML(triple.m.name)}</span>
          <span class="ai-rec__path">${escapeHTML(triple.cat.name)} · ${escapeHTML(triple.cls.name)}</span>
        </button>
        <p class="ai-rec__reason">${escapeHTML(r.reason)}</p>
      </li>`;
    }).filter(Boolean).join("");
    return head + `<ol class="ai-recs">${items}</ol>`;
  }

  function lookupMajor(code) {
    const data = window.MAJORS_DATA;
    if (!data) return null;
    for (const cat of data.categories) {
      for (const cls of cat.classes) {
        for (const m of cls.majors) {
          if (m.code === code) return { m, cat, cls };
        }
      }
    }
    return null;
  }

  // 事件委托：点推荐项 → 调 app.js 暴露的函数打开专业详情
  // （AI 抽屉 HTML 已经缓存到 lastPanelHTML，用户关掉详情再点 AI 就能恢复）
  document.addEventListener("click", (e) => {
    const head = e.target.closest && e.target.closest(".ai-rec__head");
    if (!head) return;
    const triple = lookupMajor(head.dataset.code);
    if (triple && window.__app && typeof window.__app.openMajor === "function") {
      window.__app.openMajor(triple.m, triple.cat, triple.cls);
    }
  });

  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
})();
