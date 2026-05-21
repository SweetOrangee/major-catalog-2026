/**
 * Cloudflare Workers 入口（Workers + Static Assets 模型）
 *
 * 路由：
 *   POST /api/recommend  → 调智谱 / Gemini，返回 AI 推荐
 *   其它路径             → 交给 ASSETS（仓库根目录的静态资源）
 *
 * 需要在 Worker 项目 Settings → Variables and Secrets 配置：
 *   ZHIPU_KEY、GEMINI_KEY
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/recommend") {
      if (request.method === "POST") return handleRecommend(request, env);
      return jsonResp({ error: "Method Not Allowed", hint: "use POST" }, 405);
    }

    return env.ASSETS.fetch(request);
  },
};

// ---------- AI 推荐核心 ----------

async function handleRecommend(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return jsonResp({ error: "请求体不是合法 JSON" }, 400); }

  const interest = String(body.interest || "").trim().slice(0, 500);
  if (interest.length < 5) {
    return jsonResp({ error: "请多说几句你的兴趣（至少 5 个字）" }, 400);
  }

  const provider = String(body.provider || "auto").toLowerCase();
  // auto：智谱无限额度优先，Gemini（3.1 flash-lite，500 RPD）兜底
  const order = provider === "gemini" ? ["gemini"]
              : provider === "zhipu"  ? ["zhipu"]
              : ["zhipu", "gemini"];

  // 日志：合规起见不记录用户输入原文、不记录 IP；
  // 只保留时间戳、输入长度、provider、最终推荐结果等元数据，足够 debug。
  // 看：本地 `npx wrangler tail` 实时滚 / Cloudflare Dashboard → Worker → Logs (30 天)
  const logCtx = {
    t: new Date().toISOString(),
    inputLen: interest.length,
  };
  console.log("[ai-in]", JSON.stringify(logCtx));

  let majors;
  try {
    const majorsURL = new URL("/data/majors-mini.json", request.url);
    const resp = await env.ASSETS.fetch(majorsURL);
    if (!resp.ok) throw new Error(`assets http ${resp.status}`);
    majors = await resp.json();
  } catch (e) {
    return jsonResp({ error: "专业数据加载失败：" + e.message }, 500);
  }
  // 用专业名反查 code（883 条本科专业名 100% 唯一，能极大降低 code 幻觉）
  // 同时建 normalize 后的反查表，容忍模型加空格/换标点
  const byName = new Map(majors.map(m => [m.name, m]));
  const byNorm = new Map(majors.map(m => [normalizeName(m.name), m]));

  // 简化候选列表：只给专业名，节省 token、降噪
  const majorsText = majors.map(m => m.name).join("\n");

  const prompt = buildPrompt(interest, majorsText);

  const errors = [];
  for (const p of order) {
    try {
      const parsed = p === "zhipu"
        ? await callZhipu(prompt, env.ZHIPU_KEY)
        : await callGemini(prompt, env.GEMINI_KEY);

      // LLM 判定输入跟选专业无关，直接走引导路径（HTTP 200，让前端友好展示）
      if (parsed && parsed.irrelevant === true) {
        console.log("[ai-out]", JSON.stringify({ ...logCtx, provider: p, irrelevant: true }));
        return jsonResp({
          irrelevant: true,
          hint: "请告诉我你的兴趣、擅长科目或未来想做什么，我才能为你推荐适合的专业。",
          provider: p,
        });
      }

      const recs = Array.isArray(parsed?.recs) ? parsed.recs : [];
      const rawNames = [];
      const valid = recs
        .map(r => {
          const name = String(r?.name || "").trim();
          rawNames.push(name);
          if (!r.reason) return null;
          const m = byName.get(name) || byNorm.get(normalizeName(name));
          if (!m) return null;
          return { code: m.code, name: m.name, reason: String(r.reason).slice(0, 200) };
        })
        .filter(Boolean)
        .slice(0, 4);
      if (valid.length >= 2) {
        console.log("[ai-out]", JSON.stringify({
          ...logCtx,
          provider: p,
          // 只存 code+name，不存 reason（reason 常 echo 用户输入）
          recs: valid.map(v => `${v.code} ${v.name}`),
        }));
        return jsonResp({ recs: valid, provider: p });
      }
      errors.push(`${p}: 有效推荐不足 (${valid.length}/${recs.length})，未命中名: ${rawNames.filter(n => !byName.get(n) && !byNorm.get(normalizeName(n))).slice(0, 5).join("｜")}`);
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
      // 限流类错误 fail-fast：下一个 provider 大概率也救不了，让用户尽快看到失败、重试一次
      if (/\b(429|rate.?limit|quota|too\s*many)\b/i.test(e.message)) {
        break;
      }
    }
  }
  console.warn("[ai-err]", JSON.stringify({ ...logCtx, errors }));
  return jsonResp({ error: "AI 推荐暂时不可用，请稍后再试", detail: errors }, 503);
}

function normalizeName(s) {
  // 先剥掉中英文括号及其中内容（兜底：LLM 万一把"专业名（门类-类别）"整段复制过来）
  let x = String(s || "").replace(/[（(][^）)]*[）)]/g, "");
  // 再剥掉所有空白、常见标点（中英文）
  return x.toLowerCase().replace(/[\s\u3000、，,。.【】\[\]《》<>“”"'·\-—_:：;；!！?？/\\]/g, "");
}

// ---------- helpers ----------

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function buildPrompt(interest, majorsText) {
  return `你是高中生选大学本科专业的咨询师。学生说：
"""
${interest}
"""

候选本科专业（每行一个中文专业名）：
${majorsText}

任务：
- 如果学生的描述跟「为自己选大学专业」明显无关（例如：询问天气、纯乱码、跟个人兴趣特长完全无关的话题、寒暄等），严格输出：
  {"irrelevant": true}
- 否则，从上面的候选列表里挑出 2-4 个最匹配学生描述的本科专业，严格输出：
  {"recs":[{"name":"<候选列表里逐字复制的中文专业名>","reason":"<一两句具体理由>"}]}

输出示例（仅示意结构）：
{"recs":[
  {"name":"汉语言文学","reason":"你喜欢阅读和写作，这个专业系统训练古今汉语与文学鉴赏"},
  {"name":"历史学","reason":"你对历史感兴趣，本专业培养史料解读与研究方法"}
]}

严格要求：
- 只输出 JSON，不要任何额外文字、不要 markdown 围栏
- name 必须**逐字**来自候选列表，不要简称、改写、编造、不要带括号或门类
- 推荐 2-4 个就够，宁缺勿滥
- reason 1-2 句话，具体贴合学生描述，不要空话、不要绝对化承诺
- 涉及健康/家庭等敏感话题请友好引导询问老师或家长`;
}

async function callZhipu(prompt, apiKey) {
  if (!apiKey) throw new Error("ZHIPU_KEY 未配置");
  const resp = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "glm-4-flash",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`zhipu http ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return parseRecsJSON(content, "zhipu");
}

async function callGemini(prompt, apiKey) {
  if (!apiKey) throw new Error("GEMINI_KEY 未配置");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
        // 显式关掉 dynamic thinking（gemini 3.x flash-lite 默认开），避免遇到模糊输入耗时 15s+
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`gemini http ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseRecsJSON(content, "gemini");
}

function parseRecsJSON(content, label) {
  const cleaned = String(content).trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch {
    throw new Error(`${label} 返回内容不是 JSON: ${cleaned.slice(0, 120)}`);
  }
  // 兼容 {irrelevant:true} 与 {recs:[...]} 两种形态
  if (parsed.irrelevant !== true && !Array.isArray(parsed.recs)) {
    throw new Error(`${label} 返回缺少 recs 数组且非 irrelevant`);
  }
  return parsed;
}
