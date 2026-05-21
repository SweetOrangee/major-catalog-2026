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

  const majorsText = majors.map(m =>
    `${m.name}（${m.categoryName}-${m.className}）`
  ).join("\n");

  const prompt = buildPrompt(interest, majorsText);

  const errors = [];
  for (const p of order) {
    try {
      const recs = p === "zhipu"
        ? await callZhipu(prompt, env.ZHIPU_KEY)
        : await callGemini(prompt, env.GEMINI_KEY);
      const rawNames = []; // 调试用
      const valid = recs
        .map(r => {
          const name = String(r?.name || "").trim();
          rawNames.push(name);
          if (!r.reason) return null;
          // 精确 → 模糊（去标点/空格）匹配
          const m = byName.get(name) || byNorm.get(normalizeName(name));
          if (!m) return null;
          return { code: m.code, name: m.name, reason: String(r.reason).slice(0, 200) };
        })
        .filter(Boolean)
        .slice(0, 8);
      if (valid.length >= 3) {
        return jsonResp({ recs: valid, provider: p });
      }
      errors.push(`${p}: 有效推荐不足 (${valid.length}/${recs.length})，未命中名: ${rawNames.filter(n => !byName.get(n) && !byNorm.get(normalizeName(n))).slice(0, 5).join("｜")}`);
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
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
  return `你是高中生选专业的咨询师。学生说：
"""
${interest}
"""

候选本科专业列表（每行格式：「专业名（门类-类别）」，门类与类别仅供你参考用以判断专业归属，不要写到输出里）：
${majorsText}

任务：从上面候选列表里挑出 5-8 个最匹配学生描述的本科专业。

严格输出 JSON，不要任何额外文字、不要 markdown 围栏。

输出格式示例（仅示意结构，实际推荐请基于学生描述）：
{"recs":[
  {"name":"汉语言文学","reason":"你喜欢阅读和写作，这个专业系统训练古今汉语与文学鉴赏，适合长期沉浸文本"},
  {"name":"历史学","reason":"你对历史感兴趣，本专业培养史料解读与研究方法，对应你想深耕历史的方向"}
]}

要求：
- name 字段**只填中文专业名本身**（如「汉语言文学」「机器人工程」），**不要**带括号里的门类类别信息
- name 必须**逐字**来自候选列表，不要简称、改写、编造
- reason 要具体贴合学生描述，1-2 句话；不要绝对化承诺（如"你一定能..."、"未来一定高薪"）
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
