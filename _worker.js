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
  const order = provider === "gemini" ? ["gemini"]
              : provider === "zhipu"  ? ["zhipu"]
              : ["zhipu", "gemini"];

  // 拉精简专业表
  let majors;
  try {
    const majorsURL = new URL("/data/majors-mini.json", request.url);
    const resp = await env.ASSETS.fetch(majorsURL);
    if (!resp.ok) throw new Error(`assets http ${resp.status}`);
    majors = await resp.json();
  } catch (e) {
    return jsonResp({ error: "专业数据加载失败：" + e.message }, 500);
  }
  const codeSet = new Set(majors.map(m => m.code));

  const majorsText = majors.map(m =>
    `${m.code} ${m.name}（${m.categoryName} / ${m.className}）`
  ).join("\n");

  const prompt = buildPrompt(interest, majorsText);

  const errors = [];
  for (const p of order) {
    try {
      const recs = p === "zhipu"
        ? await callZhipu(prompt, env.ZHIPU_KEY)
        : await callGemini(prompt, env.GEMINI_KEY);
      const valid = recs
        .filter(r => r && codeSet.has(String(r.code)) && r.reason)
        .slice(0, 8);
      if (valid.length >= 3) {
        return jsonResp({ recs: valid, provider: p });
      }
      errors.push(`${p}: 有效推荐不足 (${valid.length})`);
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  return jsonResp({ error: "AI 推荐暂时不可用", detail: errors }, 503);
}

// ---------- helpers ----------

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function buildPrompt(interest, majorsText) {
  return `你是高中生选专业的咨询师。学生说：
"""
${interest}
"""

候选本科专业列表（你只能从下面挑，不要编造）：
${majorsText}

请挑选 5-8 个最匹配的本科专业，严格按下面格式输出 JSON，不要任何额外文字、不要 markdown 围栏：
{"recs":[{"code":"<候选列表里的代码>","reason":"<一两句具体理由>"}]}

要求：
- code 必须严格来自候选列表
- reason 要具体贴合学生描述，避免空话；不要给绝对化承诺（如"你一定能..."、"未来一定高薪"）
- 涉及敏感话题（健康、家庭等）请友好引导询问老师或家长`;
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
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
  if (!Array.isArray(parsed.recs)) {
    throw new Error(`${label} 返回缺少 recs 数组`);
  }
  return parsed.recs;
}
