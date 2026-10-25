/* 小红书工作台 —— 前端逻辑（无框架、无外网依赖） */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  page: "dash",
  accounts: [],
  skills: [],
  assets: [],
  products: [],
  cards: [],
  notes: [],
  settings: {},
  overview: null,
  selectedAssets: new Set(),
  taskTimer: null,
  runDetail: null,
  runs: [],
  keyStatus: null,
  consoleIdx: 0,
  consoleRun: "",
  consoleCur: null,
};

const PAGE_META = {
  dash: ["概览", "工作台运行状态一览"],
  runs: ["批次创作", "一次设定方向，批量生成、审核、发布"],
  console: ["复制台", "配合闭源插件：键盘驱动，一键复制，逐条推进"],
  packs: ["技能包", "导入 / 导出写作技能，叠加到生成流程"],
  accounts: ["账号", "管理你的小红书账号与登录态"],
  publish: ["单条发布", "手工发布单条笔记"],
  products: ["商品", "商品库与上架队列"],
  delivery: ["卡密发货", "虚拟商品自动发卡"],
  tasks: ["任务", "所有执行记录与实时进度"],
  settings: ["设置", "运行参数与执行器配置"],
};

/* ---------------------------------------------------------------- 工具 */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function toast(msg, type = "ok") {
  const div = document.createElement("div");
  div.className = "toast" + (type === "err" ? " err" : type === "info" ? " info" : "");
  div.textContent = msg;
  $("#toastWrap").appendChild(div);
  setTimeout(() => div.remove(), 3600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return { error: "非 JSON 响应" };
  return res.json();
}

function fmt(t) {
  if (!t) return "—";
  return String(t).replace(/^\d{4}-/, "").replace(" ", " ");
}

function badge(status) {
  const map = {
    queued: ["排队中", "blue"],
    running: ["执行中", "amber"],
    success: ["成功", "green"],
    failed: ["失败", "red"],
    canceled: ["已取消", ""],
    logged_in: ["已登录", "green"],
    expired: ["已失效", "red"],
    unknown: ["未检测", ""],
    banned: ["异常", "red"],
    draft: ["草稿", ""],
    listed: ["已上架", "green"],
    published: ["已发布", "green"],
    filled: ["已填充", "blue"],
  };
  const [txt, cls] = map[status] || [status || "—", ""];
  return `<span class="badge ${cls}">${esc(txt)}</span>`;
}

function fileBase(p) {
  return String(p || "").split(/[\\/]/).pop();
}

/* ---------------------------------------------------------------- 路由 */
function navigate(page) {
  state.page = page;
  const [title, sub] = PAGE_META[page] || ["", ""];
  $("#pageTitle").textContent = title;
  $("#pageSub").textContent = sub;
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
  location.hash = page;
  render();
}

window.addEventListener("hashchange", () => {
  const p = location.hash.replace("#", "") || "dash";
  if (p !== state.page) navigate(p);
});

/* ---------------------------------------------------------------- 渲染入口 */
async function loadAll() {
  const [accounts, skills, settings, overview] = await Promise.all([
    api("/api/accounts"),
    api("/api/skills"),
    api("/api/settings"),
    api("/api/overview"),
  ]);
  state.accounts = Array.isArray(accounts) ? accounts : [];
  state.skills = Array.isArray(skills) ? skills : [];
  state.settings = settings || {};
  state.overview = overview || {};
  const ok = !!overview && overview.node_ok !== false;
  $("#healthDot").className = "dot " + (ok ? "ok" : "bad");
  $("#healthText").textContent = ok ? "执行器就绪" : "Node 未找到";
}

async function render() {
  const v = $("#view");
  try {
    if (state.page === "dash") await renderDash(v);
    else if (state.page === "runs") await renderRuns(v);
    else if (state.page === "console") await renderConsole(v);
    else if (state.page === "packs") await renderPacks(v);
    else if (state.page === "accounts") await renderAccounts(v);
    else if (state.page === "publish") await renderPublish(v);
    else if (state.page === "products") await renderProducts(v);
    else if (state.page === "delivery") await renderDelivery(v);
    else if (state.page === "tasks") await renderTasks(v);
    else if (state.page === "settings") await renderSettings(v);
  } catch (e) {
    v.innerHTML = `<div class="empty"><b>!</b>渲染失败：${esc(e.message)}</div>`;
  }
}

/* ---------------------------------------------------------------- 概览 */
async function renderDash(v) {
  const o = state.overview || {};
  const s = o.stats || {};
  const accs = o.accounts || [];

  v.innerHTML = `
    <div class="grid c4" style="margin-bottom:16px">
      <div class="card stat">
        <span class="k">在线账号</span>
        <span class="v ${s.logged_in ? "green" : ""}">${s.logged_in || 0}</span>
        <span class="sub">共 ${accs.length} 个账号</span>
      </div>
      <div class="card stat">
        <span class="k">今日成功</span>
        <span class="v accent">${s.today_success || 0}</span>
        <span class="sub">累计成功 ${s.success || 0}</span>
      </div>
      <div class="card stat">
        <span class="k">队列 / 执行中</span>
        <span class="v amber">${s.queued || 0} / ${s.running || 0}</span>
        <span class="sub">失败 ${s.failed || 0}</span>
      </div>
      <div class="card stat">
        <span class="k">执行器</span>
        <span class="v ${o.node_ok ? "green" : ""}">${o.node_ok ? "就绪" : "异常"}</span>
        <span class="sub">Playwright · 本地</span>
      </div>
    </div>

    <div class="grid c2">
      <div class="card pad0">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="card-title" style="margin:0">账号状态 <small>${accs.length} 个</small></div>
        </div>
        ${
          accs.length
            ? accs
                .map(
                  (a) => `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #1f242c">
            <div class="avatar" style="width:30px;height:30px;flex:0 0 30px;border-radius:50%;background:linear-gradient(135deg,#ff2e4d33,#ff7a4533);display:grid;place-items:center;font-size:12px;color:#ff8fa0">${esc(
              (a.name || "?").slice(0, 1)
            )}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px">${esc(a.name)}</div>
              <div style="font-size:11px;color:var(--muted)">${esc(fmt(a.last_check))}</div>
            </div>
            ${badge(a.status)}
          </div>`
                )
                .join("")
            : `<div class="empty"><b>◎</b>还没有账号，先去「账号」页添加</div>`
        }
      </div>

      <div class="card pad0">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="card-title" style="margin:0">最近任务</div>
        </div>
        ${
          (o.recent || []).length
            ? (o.recent || [])
                .map(
                  (t) => `
          <div style="display:flex;align-items:center;gap:10px;padding:11px 18px;border-bottom:1px solid #1f242c;cursor:pointer"
               onclick="showTask('${t.id}')">
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px">${esc(t.skill_id)}</div>
              <div style="font-size:11px;color:var(--muted)">${esc(fmt(t.created_at))} · ${esc(t.message || "")}</div>
            </div>
            ${badge(t.status)}
          </div>`
                )
                .join("")
            : `<div class="empty"><b>≣</b>暂无执行记录</div>`
        }
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">快速上手</div>
      <div class="hint">
        1. 「账号」页添加账号 → 点「扫码登录」，在弹出的浏览器里扫码<br/>
        2. 「发布笔记」页选择素材与账号，先勾选「仅填充不发布」演练一次<br/>
        3. 确认填充效果无误后取消勾选，正式发布<br/>
        4. 所有执行都会留截图，在「任务」页点开可查看
      </div>
    </div>
  `;
}

/* ---------------------------------------------------------------- 账号 */
async function renderAccounts(v) {
  state.accounts = (await api("/api/accounts")) || [];

  v.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">添加账号</div>
      <div class="row">
        <input type="text" id="accName" placeholder="账号备注名，例如：主号-美妆" style="flex:1;min-width:220px" />
        <input type="text" id="accRemark" placeholder="备注（可选）" style="flex:1;min-width:180px" />
        <button class="btn primary" id="btnAddAcc">添加</button>
      </div>
      <div class="hint" style="margin-top:12px;margin-bottom:0">
        每个账号会分配独立的浏览器档案目录，登录态互不干扰。添加后请点「扫码登录」完成一次人工登录。
      </div>
    </div>

    <div class="grid" id="accList">
      ${
        state.accounts.length
          ? state.accounts
              .map(
                (a) => `
        <div class="acc">
          <div class="avatar">${esc((a.name || "?").slice(0, 1))}</div>
          <div class="meta">
            <b>${esc(a.name)}</b>
            <div>${esc(a.remark || "无备注")} · 检测于 ${esc(fmt(a.last_check))}</div>
          </div>
          ${badge(a.status)}
          <button class="btn tiny" onclick="checkLogin(${a.id})">检测</button>
          <button class="btn tiny primary" onclick="doLogin(${a.id})">扫码登录</button>
          <button class="btn tiny ghost" onclick="resetAcc(${a.id})">重置</button>
          <button class="btn tiny danger" onclick="delAcc(${a.id})">删除</button>
        </div>`
              )
              .join("")
          : `<div class="card empty"><b>◎</b>还没有账号</div>`
      }
    </div>
  `;

  $("#btnAddAcc").onclick = async () => {
    const name = $("#accName").value.trim();
    if (!name) return toast("请填写账号名", "err");
    const r = await api("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ name, remark: $("#accRemark").value.trim() }),
    });
    if (r.error) return toast(r.error, "err");
    toast("账号已添加");
    render();
  };
}

window.checkLogin = async (id) => {
  const r = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ skill_id: "xhs_check_login", account_id: id, params: {} }),
  });
  if (r.error) return toast(r.error, "err");
  toast("已加入队列，去「任务」页看进度", "info");
  navigate("tasks");
};

window.doLogin = async (id) => {
  const r = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ skill_id: "xhs_login", account_id: id, params: { wait_seconds: 180 } }),
  });
  if (r.error) return toast(r.error, "err");
  toast("浏览器即将打开，请扫码登录", "info");
  navigate("tasks");
};

window.resetAcc = async (id) => {
  if (!confirm("重置会删除该账号的登录态，需要重新扫码。继续？")) return;
  await api(`/api/accounts/${id}/reset`, { method: "POST" });
  toast("已重置");
  render();
};

window.delAcc = async (id) => {
  if (!confirm("确定删除该账号及其浏览器档案？")) return;
  await api(`/api/accounts/${id}`, { method: "DELETE" });
  toast("已删除");
  render();
};

/* ---------------------------------------------------------------- 发布笔记 */
function skillById(id) {
  return state.skills.find((s) => s.id === id) || null;
}

function fieldHtml(f, prefix = "") {
  const id = `${prefix}f_${f.key}`;
  const req = f.required ? '<span class="req">*</span>' : "";
  if (f.type === "checkbox") {
    return `<div class="field"><label class="check"><input type="checkbox" id="${id}" data-key="${f.key}" ${
      f.default ? "checked" : ""
    } /><span>${esc(f.label)}</span></label></div>`;
  }
  if (f.type === "select") {
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <select id="${id}" data-key="${f.key}">
        ${(f.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
      </select></div>`;
  }
  if (f.type === "textarea") {
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <textarea id="${id}" data-key="${f.key}" placeholder="${esc(f.label)}">${esc(f.default || "")}</textarea></div>`;
  }
  return `<div class="field"><label>${esc(f.label)}${req}</label>
    <input type="${f.type === "number" ? "number" : "text"}" id="${id}" data-key="${f.key}"
      value="${esc(f.default ?? "")}" /></div>`;
}

function collectFields(prefix) {
  const out = {};
  $$(`[data-key]`, $(`#${prefix}`)).forEach((el) => {
    const k = el.dataset.key;
    if (el.type === "checkbox") out[k] = el.checked;
    else out[k] = el.value;
  });
  return out;
}

async function renderPublish(v) {
  const skill = skillById("xhs_publish_note");
  state.assets = (await api("/api/assets")) || [];
  if (!state.accounts.length) state.accounts = (await api("/api/accounts")) || [];

  if (!skill) {
    v.innerHTML = `<div class="card empty">Skill 未注册，请重启服务</div>`;
    return;
  }

  v.innerHTML = `
    <div class="grid" style="grid-template-columns: minmax(0,1.35fr) minmax(0,1fr); align-items:start">
      <div class="card">
        <div class="card-title">笔记内容</div>
        <div id="pubForm">
          <div class="field">
            <label>发布账号 <span class="req">*</span></label>
            <select id="pubAcc">
              ${state.accounts
                .map((a) => `<option value="${a.id}">${esc(a.name)}（${esc(a.status)}）</option>`)
                .join("")}
            </select>
          </div>
          ${fieldHtml({ key: "title", label: "标题", type: "text", required: true })}
          ${fieldHtml({ key: "content", label: "正文", type: "textarea" })}
          ${fieldHtml({ key: "topics", label: "话题（逗号分隔，不带 #）", type: "text" })}
          ${fieldHtml({ key: "media_type", label: "素材类型", type: "select", options: ["image", "video"] })}
          <div class="field">
            <label class="check">
              <input type="checkbox" id="pubDry" data-key="dry_run" checked />
              <span>仅填充不发布（强烈建议第一次先演练）</span>
            </label>
          </div>
        </div>
        <div class="row end" style="margin-top:6px">
          <button class="btn" id="btnSaveDraft">存为草稿</button>
          <button class="btn primary" id="btnPublish">加入发布队列</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">素材库 <small>点选即加入本条笔记</small></div>
        <div class="row" style="margin-bottom:12px">
          <input type="file" id="fileUp" multiple accept="image/*,video/*" style="display:none" />
          <button class="btn tiny" id="btnUp">上传素材</button>
          <span class="hint" style="margin:0;padding:4px 8px;border:none;background:none">已选 <b id="selCount">0</b> 个</span>
        </div>
        <div class="thumbs" id="thumbBox">
          ${
            state.assets.length
              ? state.assets
                  .map(
                    (a) => `
            <div class="thumb" data-id="${a.id}" title="${esc(a.name)}">
              ${
                a.kind === "image"
                  ? `<img src="/uploads/${esc(fileBase(a.path))}" />`
                  : `<div style="display:grid;place-items:center;height:100%;font-size:11px;color:var(--muted)">视频</div>`
              }
              <span class="x" onclick="delAsset(event,${a.id})">✕</span>
            </div>`
                  )
                  .join("")
              : `<div class="empty" style="padding:20px 0;width:100%"><b>▧</b>还没有素材</div>`
          }
        </div>
      </div>
    </div>
  `;

  $$(".thumb").forEach((el) => {
    el.onclick = () => {
      const id = Number(el.dataset.id);
      if (state.selectedAssets.has(id)) state.selectedAssets.delete(id);
      else state.selectedAssets.add(id);
      el.classList.toggle("sel");
      $("#selCount").textContent = state.selectedAssets.size;
    };
  });

  $("#btnUp").onclick = () => $("#fileUp").click();
  $("#fileUp").onchange = async (e) => {
    for (const f of Array.from(e.target.files || [])) {
      const fd = new FormData();
      fd.append("file", f);
      await fetch("/api/assets/upload", { method: "POST", body: fd });
    }
    toast("素材已上传");
    render();
  };

  const buildParams = () => {
    const p = collectFields("pubForm");
    p.media = state.assets
      .filter((a) => state.selectedAssets.has(a.id))
      .map((a) => a.path)
      .join("\n");
    return p;
  };

  $("#btnSaveDraft").onclick = async () => {
    const p = buildParams();
    if (!p.title) return toast("标题必填", "err");
    await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        account_id: Number($("#pubAcc").value),
        title: p.title,
        content: p.content,
        topics: (p.topics || "").split(/[,，]/).filter(Boolean),
        images: p.media ? p.media.split("\n") : [],
      }),
    });
    toast("草稿已保存");
  };

  $("#btnPublish").onclick = async () => {
    const p = buildParams();
    if (!p.title) return toast("标题必填", "err");
    const acc = $("#pubAcc").value;
    if (!acc) return toast("请先添加账号", "err");
    const r = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        skill_id: "xhs_publish_note",
        account_id: Number(acc),
        params: p,
      }),
    });
    if (r.error) return toast(r.error, "err");
    toast(p.dry_run ? "已加入队列（演练模式）" : "已加入发布队列", "info");
    navigate("tasks");
  };
}

window.delAsset = async (ev, id) => {
  ev.stopPropagation();
  if (!confirm("删除该素材？")) return;
  await api(`/api/assets/${id}`, { method: "DELETE" });
  state.selectedAssets.delete(id);
  render();
};

/* ---------------------------------------------------------------- 商品 */
async function renderProducts(v) {
  state.products = (await api("/api/products")) || [];
  v.innerHTML = `
    <div class="grid c2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-title">新增商品</div>
        <div id="prodForm">
          ${fieldHtml({ key: "title", label: "商品标题", type: "text", required: true })}
          <div class="row">
            <div style="flex:1">${fieldHtml({ key: "price", label: "价格", type: "number", default: 0 })}</div>
            <div style="flex:1">${fieldHtml({ key: "stock", label: "库存", type: "number", default: 0 })}</div>
          </div>
          <div class="row">
            <div style="flex:1">${fieldHtml({ key: "sku", label: "SKU", type: "text" })}</div>
            <div style="flex:1">${fieldHtml({ key: "category", label: "类目", type: "text" })}</div>
          </div>
        </div>
        <div class="row end">
          <button class="btn primary" id="btnAddProd">添加商品</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">批量导入</div>
        <div class="hint">CSV 列顺序：<code>title,price,stock,sku,category</code>，第一行会被跳过。</div>
        <input type="file" id="csvFile" accept=".csv" style="display:none" />
        <button class="btn" id="btnCsv">选择 CSV 导入</button>
        <div class="hint danger" style="margin-top:14px">
          自动上架涉及店铺资金与合规，本工作台只做「打开后台 + 预填表单」，最后一步必须人工确认。<br/>
          合规做法是申请小红书开放平台商品接口，而不是 RPA。
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">AI 生成商品文案 <small>虚拟商品：AI 小程序 / 小游戏 / 测算工具</small></div>
      <div class="row">
        <div style="flex:1;min-width:200px">
          ${fieldHtml({ key: "copy_name", label: "商品名", type: "text" })}
        </div>
        <div style="flex:1;min-width:160px">
          <div class="field"><label>交付方式</label>
            <select id="copyDelivery">
              <option value="card">卡密（自动发激活码）</option>
              <option value="link">链接（发专属链接）</option>
              <option value="invite">邀请码</option>
            </select></div>
        </div>
        <div style="flex:1;min-width:160px">
          ${fieldHtml({ key: "copy_audience", label: "目标人群", type: "text" })}
        </div>
      </div>
      <div class="field">
        <label>已知卖点（可选，逗号分隔）</label>
        <input type="text" data-key="copy_sp" placeholder="例：每天一句情绪建议，可生成运势卡片分享" />
      </div>
      <div class="field"><label class="check">
        <input type="checkbox" id="copyAi" checked /><span>内容含 AI 生成成分（需按平台要求标注）</span>
      </label></div>
      <div class="row end">
        <button class="btn primary" id="btnGenCopy">生成文案</button>
      </div>
      <div id="copyBox"></div>
    </div>

    <div class="card pad0">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
        <div class="card-title" style="margin:0">商品库 <small>${state.products.length} 个</small></div>
      </div>
      ${
        state.products.length
          ? `<table>
        <thead><tr><th>标题</th><th>SKU</th><th>价格</th><th>库存</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>
          ${state.products
            .map(
              (p) => `<tr>
            <td>${esc(p.title)}</td>
            <td class="mono">${esc(p.sku || "—")}</td>
            <td>¥${esc(p.price)}</td>
            <td>${esc(p.stock)}</td>
            <td>${badge(p.status)}</td>
            <td style="text-align:right">
              <button class="btn tiny" onclick="listProduct(${p.id})">预填上架</button>
              <button class="btn tiny danger" onclick="delProduct(${p.id})">删</button>
            </td>
          </tr>`
            )
            .join("")}
        </tbody></table>`
          : `<div class="empty"><b>▣</b>还没有商品</div>`
      }
    </div>
  `;

  $("#btnAddProd").onclick = async () => {
    const d = collectFields("prodForm");
    if (!d.title) return toast("标题必填", "err");
    await api("/api/products", { method: "POST", body: JSON.stringify(d) });
    toast("已添加");
    render();
  };

  $("#btnGenCopy").onclick = async () => {
    const name = ($("#f_copy_name")?.value || "").trim();
    if (!name) return toast("请填商品名", "err");
    const btn = $("#btnGenCopy");
    btn.disabled = true;
    $("#copyBox").innerHTML = `<div class="hint">生成中…</div>`;
    const r = await api("/api/products/copy", {
      method: "POST",
      body: JSON.stringify({
        name,
        selling_points: $("[data-key=copy_sp]").value,
        audience: $("#f_copy_audience").value,
        delivery_type: $("#copyDelivery").value,
        ai_generated: $("#copyAi").checked,
      }),
    });
    btn.disabled = false;
    if (r.error) {
      $("#copyBox").innerHTML = `<div class="hint danger">${esc(r.error)}</div>`;
      return;
    }
    const iss = (r.compliance || [])
      .map(
        (i) =>
          `<div class="hint ${i.level === "high" ? "danger" : i.level === "medium" ? "warn" : ""}">${esc(
            i.message
          )}${i.word ? `（命中：${esc(i.word)}）` : ""}</div>`
      )
      .join("");
    $("#copyBox").innerHTML = `
      <div class="card" style="margin-top:12px;background:var(--panel-2)">
        <div class="card-title">${esc(r.title)}</div>
        <ul style="margin:0 0 10px 18px;font-size:13px;line-height:1.8">
          ${(r.selling_points || []).map((s) => `<li>${esc(s)}</li>`).join("")}
        </ul>
        <div style="font-size:13px;color:var(--muted);white-space:pre-wrap">${esc(r.desc)}</div>
        <div style="margin-top:10px">${(r.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>
        ${iss}
        <div class="row end" style="margin-top:12px">
          <button class="btn primary" id="btnAdoptCopy">采用并入库</button>
        </div>
      </div>`;
    $("#btnAdoptCopy").onclick = async () => {
      const p = await api("/api/products", {
        method: "POST",
        body: JSON.stringify({ title: r.title, desc: r.desc, price: 0, stock: 0 }),
      });
      if (p.error) return toast(p.error, "err");
      toast("已入库，价格与库存去商品库补");
      render();
    };
  };

  $("#btnCsv").onclick = () => $("#csvFile").click();
  $("#csvFile").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    const r = await (await fetch("/api/products/import", { method: "POST", body: fd })).json();
    toast(`导入 ${r.imported || 0} 条`);
    render();
  };
}

window.listProduct = async (pid) => {
  const acc = state.accounts[0];
  if (!acc) return toast("请先添加账号", "err");
  const r = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      skill_id: "xhs_publish_product",
      account_id: acc.id,
      params: { product_id: pid, auto_submit: false },
    }),
  });
  if (r.error) return toast(r.error, "err");
  toast("已加入队列，将打开千帆后台预填", "info");
  navigate("tasks");
};

window.delProduct = async (pid) => {
  if (!confirm("删除该商品？")) return;
  await api(`/api/products/${pid}`, { method: "DELETE" });
  render();
};

/* ---------------------------------------------------------------- 卡密发货 */
async function renderDelivery(v) {
  state.cards = (await api("/api/cards")) || [];
  const avail = state.cards.filter((c) => !c.used).length;

  v.innerHTML = `
    <div class="grid c2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-title">导入卡密 <small>每行一张</small></div>
        ${fieldHtml({ key: "sku", label: "绑定 SKU", type: "text" })}
        <div class="field">
          <label>卡密内容</label>
          <textarea id="cardText" placeholder="ABCD-1234-EFGH&#10;IJKL-5678-MNOP"></textarea>
        </div>
        <div class="row end"><button class="btn primary" id="btnAddCards">导入</button></div>
      </div>

      <div class="card">
        <div class="card-title">执行发货</div>
        <div class="grid c2" style="gap:10px;margin-bottom:8px">
          <div class="stat"><span class="k">可用卡密</span><span class="v green">${avail}</span></div>
          <div class="stat"><span class="k">已用</span><span class="v">${state.cards.length - avail}</span></div>
        </div>
        ${fieldHtml({ key: "sku", label: "指定 SKU（留空=全部）", type: "text" })}
        ${fieldHtml({ key: "order_file", label: "订单 CSV 路径（列：订单号,SKU）", type: "text" })}
        <div class="field"><label class="check"><input type="checkbox" id="dvDry" checked /><span>演练（只配对，不扣卡密）</span></label></div>
        <div class="row end"><button class="btn primary" id="btnDeliver">开始发货</button></div>
      </div>
    </div>

    <div class="card pad0">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
        <div class="card-title" style="margin:0">卡密库 <small>最近 500 条</small></div>
      </div>
      ${
        state.cards.length
          ? `<table><thead><tr><th>SKU</th><th>卡密</th><th>状态</th><th>使用时间</th></tr></thead><tbody>
          ${state.cards
            .slice(0, 200)
            .map(
              (c) => `<tr>
              <td class="mono">${esc(c.product_sku || "—")}</td>
              <td class="mono">${esc(c.card)}</td>
              <td>${c.used ? badge("used") : badge("success")}</td>
              <td class="mono">${esc(fmt(c.used_at))}</td>
            </tr>`
            )
            .join("")}
        </tbody></table>`
          : `<div class="empty"><b>✦</b>还没有卡密</div>`
      }
    </div>
  `;

  $("#btnAddCards").onclick = async () => {
    const cards = $("#cardText").value.trim();
    if (!cards) return toast("请粘贴卡密", "err");
    const r = await api("/api/cards", {
      method: "POST",
      body: JSON.stringify({ sku: $("#f_sku")?.value || "", cards }),
    });
    toast(`已导入 ${r.added || 0} 张`);
    render();
  };

  $("#btnDeliver").onclick = async () => {
    const sku = $$("[data-key]").find((e) => e.dataset.key === "sku")?.value || "";
    const of = $$("[data-key]").find((e) => e.dataset.key === "order_file")?.value || "";
    const r = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        skill_id: "auto_delivery",
        account_id: null,
        params: { sku, order_file: of, dry_run: $("#dvDry").checked },
      }),
    });
    if (r.error) return toast(r.error, "err");
    toast("发货任务已提交", "info");
    navigate("tasks");
  };
}

/* ---------------------------------------------------------------- 任务 */
async function renderTasks(v) {
  const tasks = (await api("/api/tasks?limit=120")) || [];
  v.innerHTML = `
    <div class="card pad0">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center">
        <div class="card-title" style="margin:0">执行记录</div>
        <div class="spacer"></div>
        <span class="hint" style="margin:0;padding:4px 10px;border:none;background:none">自动刷新中</span>
      </div>
      ${
        tasks.length
          ? `<table>
        <thead><tr><th>任务</th><th>技能</th><th>状态</th><th>进度</th><th>信息</th><th>时间</th></tr></thead>
        <tbody>
          ${tasks
            .map(
              (t) => `<tr style="cursor:pointer" onclick="showTask('${t.id}')">
            <td class="mono" style="color:var(--muted)">${esc(t.id)}</td>
            <td>${esc(t.skill_id)}</td>
            <td>${badge(t.status)}</td>
            <td><div class="bar ${t.status === "success" ? "done" : t.status === "failed" ? "fail" : ""}">
              <i style="width:${t.status === "success" ? 100 : t.progress || 0}%"></i></div></td>
            <td style="color:var(--muted);font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${esc(t.error || t.message || "")}</td>
            <td class="mono" style="color:var(--muted)">${esc(fmt(t.created_at))}</td>
          </tr>`
            )
            .join("")}
        </tbody></table>`
          : `<div class="empty"><b>≣</b>还没有任务</div>`
      }
    </div>
  `;
}

window.showTask = async (id) => {
  const t = await api(`/api/tasks/${id}`);
  if (t.error) return toast(t.error, "err");
  let shots = [];
  let result = null;
  try { shots = JSON.parse(t.shots || "[]"); } catch (e) {}
  try { result = JSON.parse(t.result || "null"); } catch (e) {}

  openModal(
    `任务 ${esc(t.id)}`,
    `
    <div class="row" style="margin-bottom:12px">
      ${badge(t.status)} <span class="tag">${esc(t.skill_id)}</span>
      <span class="mono" style="color:var(--muted);font-size:11.5px">${esc(t.created_at)}</span>
    </div>
    <div class="hint">${esc(t.message || "无")}</div>
    ${t.error ? `<div class="hint danger">${esc(t.error)}</div>` : ""}
    ${result ? `<div class="card-title" style="margin-top:8px">结果</div><pre>${esc(JSON.stringify(result, null, 2))}</pre>` : ""}
    ${shots.length ? `<div class="card-title" style="margin-top:12px">截图</div>${shots.map((s) => `<img src="/shots/${esc(s)}" />`).join("")}` : ""}
    <div class="row end" style="margin-top:14px">
      <button class="btn tiny" onclick="retryTask('${t.id}')">重试</button>
    </div>
  `
  );
};

window.retryTask = async (id) => {
  await api(`/api/tasks/${id}/retry`, { method: "POST" });
  closeModal();
  toast("已重新入队");
  render();
};

/* ---------------------------------------------------------------- 设置 */
async function renderSettings(v) {
  const c = (await api("/api/settings")) || {};
  v.innerHTML = `
    <div class="grid c2">
      <div class="card">
        <div class="card-title">执行器</div>
        <div id="setForm">
          <div class="field"><label>Node 可执行文件</label>
            <input type="text" data-sk="node_exe" value="${esc(c.node_exe || "")}" /></div>
          <div class="field"><label>浏览器通道</label>
            <select data-sk="browser_channel">
              <option value="msedge" ${c.browser_channel === "msedge" ? "selected" : ""}>系统 Edge（推荐，真实指纹）</option>
              <option value="" ${!c.browser_channel ? "selected" : ""}>内置 Chromium</option>
            </select></div>
          <div class="field"><label class="check">
            <input type="checkbox" data-sk="headless" ${c.headless ? "checked" : ""} />
            <span>无头模式（不显示浏览器窗口）</span></label></div>
          <div class="field"><label>并发任务数</label>
            <input type="number" data-sk="max_concurrent" value="${esc(c.max_concurrent || 1)}" /></div>
          <div class="field"><label>操作间隔下限（秒）</label>
            <input type="number" data-sk="delay_min" value="${esc(c.delay_min || 3)}" /></div>
          <div class="field"><label>操作间隔上限（秒）</label>
            <input type="number" data-sk="delay_max" value="${esc(c.delay_max || 9)}" /></div>
          <div class="field"><label>打字速度（毫秒/字）</label>
            <input type="number" data-sk="typing_delay_ms" value="${esc(c.typing_delay_ms || 60)}" /></div>
        </div>
        <div class="row end"><button class="btn primary" id="btnSaveSet">保存</button></div>
      </div>

      <div class="card">
        <div class="card-title">说明</div>
        <div class="hint">
          <b>浏览器通道</b>：用系统 Edge 比内置 Chromium 更不容易被风控识别，因为它的指纹、字体、插件都是真实的。
        </div>
        <div class="hint warn">
          <b>并发不要调高</b>。同一账号并发操作是最容易触发风控的行为，默认 1 是刻意的。
        </div>
        <div class="hint danger">
          <b>无头模式</b>会显著提高被识别概率，建议只在调试抓数据时开。
        </div>
        <div class="card-title" style="margin-top:16px">选择器校准</div>
        <div class="hint">
          小红书改版导致找不到元素时，编辑 <code>workers/selectors.json</code> 覆盖默认选择器，无需改代码。
        </div>
      </div>
    </div>
  `;

  const adp = (await api("/api/adapters")) || {};
  const adpList = adp.list || [];
  v.insertAdjacentHTML(
    "beforeend",
    `
    <div class="card" style="margin-top:16px">
      <div class="card-title">发布适配器 <small>决定「发布」这一步由谁执行</small></div>
      <div class="row" style="align-items:flex-start;gap:18px">
        <div style="flex:1;min-width:280px">
          <div class="field"><label>当前适配器</label>
            <select id="adpSel">
              ${adpList
                .map(
                  (a) =>
                    `<option value="${a.id}" ${adp.current === a.id ? "selected" : ""}>${esc(a.name)}</option>`
                )
                .join("")}
            </select>
          </div>
          <div class="hint" id="adpDesc"></div>
        </div>
        <div style="flex:1;min-width:280px">
          <div class="field"><label>Webhook 地址（仅 webhook 需要）</label>
            <input type="text" id="adpUrl" value="${esc((adp.config || {}).webhook_url || "")}"
              placeholder="http://127.0.0.1:9000/publish" /></div>
          <div class="field"><label>Token（可选）</label>
            <input type="password" id="adpToken" value="${esc((adp.config || {}).webhook_token || "")}" /></div>
          <button class="btn primary" id="btnSaveAdp">保存适配器</button>
        </div>
      </div>
      <div class="hint" style="margin-top:14px;margin-bottom:0">
        闭源工具（蚁小二、融媒宝、红草、批量发布扩展）<b>都没有对外接口</b>，
        所以选它们时用「导出待发包」或「批量导入表」，由你手动或半自动执行；
        只有对方真的提供了 HTTP 接口（如影刀流程）才选 webhook。
      </div>
    </div>`
  );

  const descOf = (id) => (adpList.find((a) => a.id === id) || {}).desc || "";
  const sel = $("#adpSel");
  const paintDesc = () => {
    $("#adpDesc").textContent = descOf(sel.value);
  };
  sel.onchange = paintDesc;
  paintDesc();

  $("#btnSaveAdp").onclick = async () => {
    const r = await api("/api/adapters", {
      method: "POST",
      body: JSON.stringify({
        adapter: sel.value,
        config: { webhook_url: $("#adpUrl").value.trim(), webhook_token: $("#adpToken").value.trim() },
      }),
    });
    if (r.error) return toast(r.error, "err");
    toast("适配器已保存：" + r.current);
  };

  const ks = (await api("/api/key/status")) || {};
  state.keyStatus = ks;
  v.insertAdjacentHTML(
    "beforeend",
    `
    <div class="card" style="margin-top:16px">
      <div class="card-title">模型密钥 <small>用于批量生成笔记</small></div>
      <div class="row" style="margin-bottom:12px">
        <span class="badge ${ks.configured ? "green" : "red"}">${ks.configured ? "已配置" : "未配置"}</span>
        <span class="mono" style="color:var(--muted);font-size:12px">${esc(ks.model || "deepseek-chat")}</span>
      </div>
      <div class="row">
        <input type="password" id="dsKey" placeholder="sk-..." style="flex:1;min-width:260px" />
        <button class="btn primary" id="btnSaveKey">保存</button>
        <button class="btn" id="btnImportKey">从闲鱼工作台导入</button>
      </div>
      <div class="hint" style="margin-top:12px;margin-bottom:0">
        密钥只存在本机数据库，不出机器。生成按量计费，费用由模型供应商收取。
      </div>
    </div>`
  );

  $("#btnSaveKey").onclick = async () => {
    const k = $("#dsKey").value.trim();
    if (!k) return toast("请填入密钥", "err");
    const r = await api("/api/key", { method: "POST", body: JSON.stringify({ key: k }) });
    if (r.error) return toast(r.error, "err");
    state.keyStatus = null;
    toast("密钥已保存");
    render();
  };

  $("#btnImportKey").onclick = async () => {
    const r = await api("/api/key/import-xianyu", { method: "POST" });
    if (r.error) return toast(r.error, "err");
    state.keyStatus = null;
    toast("已导入 " + (r.preview || ""));
    render();
  };

  $("#btnSaveSet").onclick = async () => {
    const body = {};
    $$("[data-sk]").forEach((el) => {
      const k = el.dataset.sk;
      if (el.type === "checkbox") body[k] = el.checked;
      else if (el.type === "number") body[k] = Number(el.value);
      else body[k] = el.value;
    });
    await api("/api/settings", { method: "POST", body: JSON.stringify(body) });
    toast("设置已保存");
    loadAll();
  };
}

/* ---------------------------------------------------------------- 复制台 */
async function copyText(text, label) {
  if (!text) return toast("没有内容可复制", "err");
  try {
    await navigator.clipboard.writeText(text);
    toast(`已复制${label}`, "info");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(`已复制${label}`, "info");
    } catch (_) {
      toast("复制失败，请手动选中", "err");
    }
    ta.remove();
  }
}

function topicLine(topics) {
  return (topics || []).map((t) => "#" + t).join(" ");
}

async function renderConsole(v) {
  if (!state.runs.length) state.runs = (await api("/api/runs")) || [];

  const url = "/api/console/queue" + (state.consoleRun ? `?run_id=${state.consoleRun}` : "");
  const q = (await api(url)) || [];
  const total = q.length;
  let i = Math.min(state.consoleIdx, Math.max(0, total - 1));
  state.consoleIdx = i;
  const cur = total ? q[i] : null;
  state.consoleCur = cur;

  const runOptions = `<option value="">全部批次</option>` +
    state.runs
      .map(
        (r) =>
          `<option value="${r.id}" ${state.consoleRun === r.id ? "selected" : ""}>${esc(
            r.name || r.id
          )}</option>`
      )
      .join("");

  if (!cur) {
    v.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="row"><div class="field" style="margin:0;flex:1">
          <label>批次</label><select id="cRun">${runOptions}</select></div></div>
      </div>
      <div class="card empty"><b>⌨</b>没有待发布的内容<br/>
        <span style="font-size:12px">先去「批次创作」生成并通过审核，条目就会出现在这里</span>
      </div>`;
    $("#cRun").onchange = (e) => {
      state.consoleRun = e.target.value;
      state.consoleIdx = 0;
      render();
    };
    return;
  }

  v.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="row">
        <div class="field" style="margin:0;flex:1;min-width:200px">
          <label>批次</label>
          <select id="cRun">${runOptions}</select>
        </div>
        <div style="margin-left:auto;text-align:right">
          <div style="font-size:22px;font-weight:650">${i + 1}<span style="color:var(--muted);font-size:14px"> / ${total}</span></div>
          <div style="font-size:11.5px;color:var(--muted)">待发布</div>
        </div>
      </div>
    </div>

    <div class="copy-block card" data-field="title" style="margin-bottom:12px;cursor:pointer">
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">
        标题 <span style="color:#4a525f">· 点击复制 · Ctrl+1</span>
      </div>
      <div style="font-size:19px;font-weight:600;line-height:1.45">${esc(cur.title)}</div>
    </div>

    <div class="copy-block card" data-field="content" style="margin-bottom:12px;cursor:pointer">
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">
        正文 <span style="color:#4a525f">· 点击复制 · Ctrl+2</span>
      </div>
      <div style="font-size:14px;line-height:1.85;white-space:pre-wrap">${esc(cur.content)}</div>
    </div>

    <div class="copy-block card" data-field="topics" style="margin-bottom:12px;cursor:pointer">
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">
        话题 <span style="color:#4a525f">· 点击复制 · Ctrl+3</span>
      </div>
      <div style="font-size:13.5px;color:#ff8fa0">${esc(topicLine(cur.topics) || "（无话题）")}</div>
    </div>

    ${
      cur.images && cur.images.length
        ? `<div class="card" style="margin-bottom:12px">
            <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px">素材 ${cur.images.length} 个</div>
            <div class="thumbs">${cur.images
              .map((p) => `<img src="/uploads/${esc(fileBase(p))}" class="thumb" style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" />`)
              .join("")}</div>
          </div>`
        : ""
    }

    <div class="card">
      <div class="row" style="gap:10px">
        <button class="btn primary" id="btnDone">标记已发（Ctrl+Enter）</button>
        <button class="btn" id="btnNext">下一条（→）</button>
        <button class="btn ghost" id="btnPrev">上一条（←）</button>
        <button class="btn ghost" id="btnSkip">跳过</button>
      </div>
      <div class="hint" style="margin-top:12px;margin-bottom:0">
        流程：复制 → 切到插件页面粘贴 → 发布成功 → 回来按 <b>Ctrl+Enter</b> 记账。<br/>
        只有记账后账本才会写 <code>confirmed</code>，这条不会再被自动发布。
      </div>
    </div>
  `;

  $("#cRun").onchange = (e) => {
    state.consoleRun = e.target.value;
    state.consoleIdx = 0;
    render();
  };

  const fieldMap = { title: "标题", content: "正文", topics: "话题" };
  const valueOf = (f) => (f === "topics" ? topicLine(cur.topics) : cur[f]);
  $$(".copy-block").forEach((el) => {
    el.onclick = () => copyText(valueOf(el.dataset.field), fieldMap[el.dataset.field]);
  });

  $("#btnDone").onclick = () => consoleMark("done");
  $("#btnSkip").onclick = () => consoleMark("skip");
  $("#btnNext").onclick = () => {
    state.consoleIdx = Math.min(state.consoleIdx + 1, total - 1);
    render();
  };
  $("#btnPrev").onclick = () => {
    state.consoleIdx = Math.max(state.consoleIdx - 1, 0);
    render();
  };
}

async function consoleMark(action) {
  const cur = state.consoleCur;
  if (!cur) return;
  const r = await api("/api/console/mark", {
    method: "POST",
    body: JSON.stringify({ item_id: cur.item_id, action }),
  });
  if (r.error) return toast(r.error, "err");
  toast(action === "done" ? "已记账：这条不会再被自动发布" : "已跳过");
  render();
}

function consoleCopy(field) {
  const cur = state.consoleCur;
  if (!cur) return;
  const map = { title: "标题", content: "正文", topics: "话题" };
  copyText(field === "topics" ? topicLine(cur.topics) : cur[field], map[field]);
}

document.addEventListener("keydown", (e) => {
  if (state.page !== "console" || !state.consoleCur) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (["input", "textarea", "select"].includes(tag)) return;

  if (e.ctrlKey && ["1", "2", "3"].includes(e.key)) {
    e.preventDefault();
    consoleCopy({ "1": "title", "2": "content", "3": "topics" }[e.key]);
  } else if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    consoleMark("done");
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    state.consoleIdx += 1;
    render();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    state.consoleIdx = Math.max(0, state.consoleIdx - 1);
    render();
  }
});

/* ---------------------------------------------------------------- 技能包 */
async function renderPacks(v) {
  const packs = (await api("/api/packs")) || [];
  const builtin = (await api("/api/packs/builtin")) || [];
  const missing = builtin.filter((b) => !b.installed).length;

  v.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">内置技能库 <small>${builtin.length} 个，${builtin.length - missing} 个已装</small></div>
      <div class="hint">
        前两个是网上真实开源项目（MIT 许可），原文未删改，出处与提交号已记录；
        其余是按公开方法论独立撰写的。没有许可证的项目一律不内置。
      </div>
      <table>
        <thead><tr><th>技能</th><th>分类</th><th>许可</th><th>出处</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>
        ${builtin
          .map(
            (b) => `<tr>
          <td><b>${esc(b.name)}</b><div class="mono" style="color:var(--muted);font-size:11px">${esc(b.id)}</div></td>
          <td><span class="tag">${esc(b.category)}</span></td>
          <td>${esc(b.license || "—")}</td>
          <td style="font-size:11.5px;color:var(--muted);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${
              b.source_note && b.source_note.startsWith("http")
                ? `<a href="${esc(b.source_note.split(" ")[0])}" target="_blank" style="color:var(--blue)">${esc(
                    b.source_note.split(" ")[0].replace("https://github.com/", "")
                  )}</a>`
                : esc(b.source_note || "工作台原创")
            }
          </td>
          <td>${b.installed ? '<span class="badge green">已安装</span>' : '<span class="badge">未安装</span>'}</td>
          <td style="text-align:right">
            ${b.installed ? "" : `<button class="btn tiny primary" onclick="installBuiltin('${b.id}')">安装</button>`}
          </td>
        </tr>`
          )
          .join("")}
        </tbody>
      </table>
      <div class="row end" style="margin-top:12px">
        ${missing ? `<button class="btn primary" id="btnInstallAll">安装全部 ${missing} 个</button>` : ""}
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">导入技能包 <small>.zip（内含 SKILL.md）</small></div>
      <div class="row">
        <input type="file" id="packFile" accept=".zip" style="display:none" />
        <button class="btn primary" id="btnPickPack">选择 zip 导入</button>
        <span style="color:var(--muted);font-size:12px">旧包同 id 会被覆盖</span>
      </div>
      <div class="hint" style="margin-top:12px;margin-bottom:0">
        技能包只作为<b>提示词</b>参与生成，<b>不会执行包内任何代码或脚本</b>；
        只接受文档类文件（.md/.json/.txt/.html/.csv），夹带可执行文件会被拒绝。
      </div>
    </div>

    <div class="card pad0">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
        <div class="card-title" style="margin:0">已安装 <small>${packs.length} 个</small></div>
      </div>
      ${
        packs.length
          ? `<table>
        <thead><tr><th>名称</th><th>版本</th><th>许可</th><th>来源</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>
        ${packs
          .map(
            (p) => `<tr>
          <td><b>${esc(p.name)}</b><div class="mono" style="color:var(--muted);font-size:11px">${esc(p.id)}</div></td>
          <td class="mono">${esc(p.version)}</td>
          <td>${esc(p.license || "—")}</td>
          <td><span class="tag">${esc(p.source || "import")}</span></td>
          <td>${p.status === "active" ? '<span class="badge green">启用</span>' : '<span class="badge">停用</span>'}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn tiny" onclick="viewPack('${p.id}')">查看</button>
            <a class="btn tiny" href="/api/packs/${p.id}/export">导出</a>
            <button class="btn tiny" onclick="togglePack('${p.id}','${p.status === "active" ? "disabled" : "active"}')">
              ${p.status === "active" ? "停用" : "启用"}</button>
            <button class="btn tiny danger" onclick="delPack('${p.id}')">删</button>
          </td>
        </tr>`
          )
          .join("")}
        </tbody></table>`
          : `<div class="empty"><b>❖</b>还没有技能包</div>`
      }
    </div>
  `;

  $("#btnPickPack").onclick = () => $("#packFile").click();

  const allBtn = $("#btnInstallAll");
  if (allBtn)
    allBtn.onclick = async () => {
      const r = await api("/api/packs/builtin/install", { method: "POST", body: JSON.stringify({}) });
      toast(`已安装 ${r.installed} 个技能`);
      render();
    };
  $("#packFile").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    const r = await (await fetch("/api/packs/import", { method: "POST", body: fd })).json();
    if (r.error) return toast(r.error, "err");
    toast(`已导入「${r.name}」 v${r.version}`);
    render();
  };
}

window.installBuiltin = async (id) => {
  const r = await api("/api/packs/builtin/install", {
    method: "POST",
    body: JSON.stringify({ ids: [id] }),
  });
  if (r.failed) return toast("安装失败", "err");
  toast("已安装");
  render();
};

window.viewPack = async (id) => {
  const p = await api(`/api/packs/${id}`);
  if (p.error) return toast(p.error, "err");
  openModal(
    esc(p.name),
    `<div class="row" style="margin-bottom:10px">
       <span class="tag">v${esc(p.version)}</span>
       <span class="tag">${esc(p.license || "无许可")}</span>
       <span class="tag">sha256 ${esc((p.sha256 || "").slice(0, 12))}…</span>
     </div>
     <div class="card-title">提示词</div>
     <pre>${esc(p.prompt || "")}</pre>`
  );
};

window.togglePack = async (id, status) => {
  const r = await api(`/api/packs/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
  if (r.error) return toast(r.error, "err");
  render();
};

window.delPack = async (id) => {
  if (!confirm("删除该技能包？")) return;
  await api(`/api/packs/${id}`, { method: "DELETE" });
  render();
};

/* ---------------------------------------------------------------- 批次 */
const RUN_BADGE = {
  draft: ["草稿", ""],
  review: ["待审核", "blue"],
  running: ["运行中", "amber"],
  paused: ["已暂停", ""],
  done: ["已完成", "green"],
  failed: ["失败", "red"],
};

const ITEM_BADGE = {
  pending: ["待生成", ""],
  content_review: ["待审核", "blue"],
  approved: ["已通过", "green"],
  publishing: ["发布中", "amber"],
  exported: ["待人工执行", "amber"],
  published: ["已发布", "green"],
  failed: ["失败", "red"],
  reconcile_required: ["需核查", "red"],
  skipped: ["已跳过", ""],
};

function runBadge(s) {
  const [t, c] = RUN_BADGE[s] || [s, ""];
  return `<span class="badge ${c}">${esc(t)}</span>`;
}
function itemBadge(s) {
  const [t, c] = ITEM_BADGE[s] || [s, ""];
  return `<span class="badge ${c}">${esc(t)}</span>`;
}

async function renderRuns(v) {
  if (state.runDetail) return renderRunDetail(v);
  state.runs = (await api("/api/runs")) || [];
  if (!state.accounts.length) state.accounts = (await api("/api/accounts")) || [];
  if (!state.keyStatus) state.keyStatus = (await api("/api/key/status")) || {};
  state.packs = (await api("/api/packs")) || [];

  const list = state.runs.length
    ? state.runs
        .map((r) => {
          const c = r.counts || {};
          const done = c.published || 0;
          const total = c.total || 0;
          const pct = total ? Math.round((done / total) * 100) : 0;
          return `
      <div class="card" style="margin-bottom:10px">
        <div class="row" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div class="row" style="gap:8px;margin-bottom:4px">
              <b style="font-size:14px">${esc(r.name || "未命名批次")}</b>
              ${runBadge(r.status)}
            </div>
            <div style="font-size:12px;color:var(--muted)">${esc(r.direction || "")}</div>
            <div style="margin-top:9px;display:flex;gap:7px;flex-wrap:wrap">
              <span class="tag">共 ${total}</span>
              <span class="tag">已发布 ${done}</span>
              ${c.review ? `<span class="tag">待审 ${c.review}</span>` : ""}
              ${c.approved ? `<span class="tag">待发 ${c.approved}</span>` : ""}
              ${c.failed ? `<span class="tag">失败 ${c.failed}</span>` : ""}
              ${c.reconcile ? `<span class="tag" style="color:var(--red)">需核查 ${c.reconcile}</span>` : ""}
            </div>
            <div class="bar ${pct === 100 ? "done" : ""}" style="margin-top:10px;max-width:420px"><i style="width:${pct}%"></i></div>
          </div>
          <div class="row" style="gap:6px">
            ${total === 0 ? `<button class="btn tiny" onclick="genRun('${r.id}')">生成内容</button>` : ""}
            ${total > 0 ? `<button class="btn tiny" onclick="openRun('${r.id}')">查看条目</button>` : ""}
            ${r.status === "review" ? `<button class="btn tiny primary" onclick="startRun('${r.id}')">开始发布</button>` : ""}
            ${r.status === "running" ? `<button class="btn tiny" onclick="pauseRun('${r.id}')">暂停</button>` : ""}
            ${r.status === "paused" ? `<button class="btn tiny primary" onclick="resumeRun('${r.id}')">恢复</button>` : ""}
          </div>
        </div>
      </div>`;
        })
        .join("")
    : `<div class="card empty"><b>◈</b>还没有批次</div>`;

  v.innerHTML = `
    ${
      !state.keyStatus.configured
        ? `<div class="hint danger">未配置模型密钥，无法生成内容。去「设置」填入 DeepSeek Key，或点「从闲鱼工作台导入」。</div>`
        : ""
    }
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">新建批次 <small>一次设定，按流程推进</small></div>
      <div id="runForm">
        <div class="row">
          <div style="flex:1;min-width:200px">${fieldHtml({ key: "name", label: "批次名称", type: "text" })}</div>
          <div style="flex:1;min-width:140px">${fieldHtml({ key: "total", label: "生成篇数", type: "number", default: 10 })}</div>
        </div>
        <div class="field">
          <label>内容方向 <span class="req">*</span></label>
          <textarea data-key="direction" placeholder="例：AI 提示词实操，面向零基础职场人，偏工具流"></textarea>
        </div>
        <div class="row">
          <div style="flex:1;min-width:180px">${fieldHtml({ key: "audience", label: "目标读者", type: "text" })}</div>
          <div style="flex:1;min-width:140px">${fieldHtml({ key: "interval_sec", label: "两条间隔（秒）", type: "number", default: 600 })}</div>
          <div style="flex:1;min-width:160px">
            <div class="field"><label>发布账号 <span class="req">*</span></label>
              <select data-key="account_id">
                ${state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}（${esc(a.status)}）</option>`).join("")}
              </select></div>
          </div>
        </div>
      </div>
      <div class="field">
        <label>写作技能（可多选，叠加进提示词）</label>
        <div class="row" id="packPick" style="gap:14px">
          ${
            (state.packs || []).filter((p) => p.status === "active").length
              ? state.packs
                  .filter((p) => p.status === "active")
                  .map(
                    (p) => `<label class="check"><input type="checkbox" value="${esc(p.id)}" /><span>${esc(
                      p.name
                    )}</span></label>`
                  )
                  .join("")
              : `<span style="color:var(--muted);font-size:12px">还没有启用的技能包，去「技能包」页导入</span>`
          }
        </div>
      </div>
      <div class="hint">
        流水线：<b>生成</b> → <b>逐条审核</b> → <b>开始发布</b>。未审核通过的条目不会被发布。<br/>
        每条发布前会写入幂等账本，<b>结果未知的条目会被拦住要求人工核查</b>，绝不自动重发。
      </div>
      <div class="row end">
        <span id="costHint" style="color:var(--muted);font-size:12px;margin-right:auto"></span>
        <button class="btn primary" id="btnNewRun">创建并生成</button>
      </div>
    </div>

    <div class="card-title" style="margin-bottom:10px">批次列表</div>
    ${list}
  `;

  const updCost = async () => {
    const n = Number($("#runForm [data-key=total]")?.value || 10);
    const e = await api(`/api/cost-estimate?count=${n}`);
    if (e && e.cny_low !== undefined) {
      $("#costHint").textContent = `预估模型费 ¥${e.cny_low} ~ ¥${e.cny_high}（${e.tokens_in + e.tokens_out} tokens，非账单）`;
    }
  };
  $("#runForm [data-key=total]").oninput = updCost;
  updCost();

  $("#btnNewRun").onclick = async () => {
    const d = collectFields("runForm");
    d.pack_ids = Array.from(document.querySelectorAll("#packPick input:checked")).map((e) => e.value);
    if (!d.direction) return toast("请填写内容方向", "err");
    if (!state.keyStatus.configured) return toast("请先在设置里配置模型密钥", "err");
    const r = await api("/api/runs", { method: "POST", body: JSON.stringify(d) });
    if (r.error) return toast(r.error, "err");
    toast("批次已创建，开始生成…", "info");
    const g = await api(`/api/runs/${r.id}/generate`, {
      method: "POST",
      body: JSON.stringify({ count: Number(d.total) || 10 }),
    });
    if (g.error) return toast(g.error, "err");
    toast(`生成完成 ${g.created} 条${g.duplicates ? `，${g.duplicates} 条疑似重复` : ""}`);
    render();
  };
}

async function renderRunDetail(v) {
  const d = await api(`/api/runs/${state.runDetail}`);
  if (!d || d.error) {
    state.runDetail = null;
    return renderRuns(v);
  }
  const { run, items } = d;
  const rows = items
    .map(
      (it) => `
    <div class="card" style="margin-bottom:10px">
      <div class="row" style="align-items:flex-start">
        <div style="width:30px;color:var(--muted);font-size:12px;flex:0 0 30px">#${it.idx + 1}</div>
        <div style="flex:1;min-width:0">
          <div class="row" style="gap:8px;margin-bottom:3px">
            <b style="font-size:13.5px">${esc(it.note?.title || "（无标题）")}</b>
            ${itemBadge(it.status)}
            ${it.note?.source ? `<span class="tag">${esc(it.note.source)}</span>` : ""}
          </div>
          <div style="font-size:12px;color:var(--muted);white-space:pre-wrap;max-height:80px;overflow:hidden">${esc(
            (it.note?.content || "").slice(0, 220)
          )}</div>
          ${
            it.note?.topics?.length
              ? `<div style="margin-top:6px">${it.note.topics.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>`
              : ""
          }
          ${it.error ? `<div class="hint danger" style="margin:8px 0 0">${esc(it.error)}</div>` : ""}
        </div>
        <div class="row" style="gap:5px">
          ${
            it.status === "content_review"
              ? `<button class="btn tiny primary" onclick="reviewItem('${run.id}','${it.id}',1)">通过</button>
                 <button class="btn tiny ghost" onclick="reviewItem('${run.id}','${it.id}',0)">跳过</button>`
              : ""
          }
          ${
            it.status === "reconcile_required" || it.status === "exported"
              ? `<button class="btn tiny" onclick="resolveItem('${run.id}','${it.id}','published')">确认已发</button>
                 <button class="btn tiny danger" onclick="resolveItem('${run.id}','${it.id}','not_published')">确认未发</button>`
              : ""
          }
          ${
            it.status === "published" && it.ledger
              ? `<span class="tag">账本：${esc(it.ledger.state)}</span>`
              : ""
          }
        </div>
      </div>
    </div>`
    )
    .join("");

  v.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <button class="btn tiny ghost" onclick="closeRun()">← 返回</button>
      <b style="font-size:15px;margin-left:6px">${esc(run.name || "批次")}</b>
      ${runBadge(run.status)}
      <span class="mono" style="color:var(--muted);font-size:11.5px">${esc(run.id)}</span>
      <div class="spacer"></div>
      <a class="btn tiny" href="/api/runs/${run.id}/export?fmt=zip">导出待发包</a>
      <a class="btn tiny" href="/api/runs/${run.id}/export?fmt=csv">导出导入表</a>
    </div>
    <div class="hint">${esc(run.direction || "")}</div>
    ${rows || `<div class="card empty"><b>◈</b>还没有条目，先点「生成内容」</div>`}
  `;
}

window.openRun = (id) => { state.runDetail = id; render(); };
window.closeRun = () => { state.runDetail = null; render(); };

window.genRun = async (id) => {
  toast("生成中，请稍候…", "info");
  const g = await api(`/api/runs/${id}/generate`, { method: "POST", body: JSON.stringify({}) });
  if (g.error) return toast(g.error, "err");
  toast(`生成 ${g.created} 条`);
  render();
};

window.startRun = async (id) => {
  const r = await api(`/api/runs/${id}/start`, { method: "POST" });
  if (r.error) return toast(r.error, "err");
  toast(`批次已启动，待发 ${r.available} 条`, "info");
  render();
};

window.pauseRun = async (id) => {
  await api(`/api/runs/${id}/pause`, { method: "POST" });
  toast("已暂停");
  render();
};

window.resumeRun = async (id) => {
  await api(`/api/runs/${id}/resume`, { method: "POST" });
  toast("已恢复");
  render();
};

window.reviewItem = async (rid, iid, approve) => {
  const r = await api(`/api/runs/${rid}/items/${iid}/review`, {
    method: "POST",
    body: JSON.stringify({ approve: !!approve }),
  });
  if (r.error) return toast(r.error, "err");
  render();
};

window.resolveItem = async (rid, iid, verdict) => {
  const r = await api(`/api/runs/${rid}/items/${iid}/resolve`, {
    method: "POST",
    body: JSON.stringify({ verdict }),
  });
  if (r.error) return toast(r.error, "err");
  toast(verdict === "published" ? "已标记为已发布" : "已退回待发");
  render();
};

/* ---------------------------------------------------------------- modal */
function openModal(title, html) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modalBackdrop").classList.add("show");
}
function closeModal() {
  $("#modalBackdrop").classList.remove("show");
}
$("#modalClose").onclick = closeModal;
$("#modalBackdrop").onclick = (e) => {
  if (e.target.id === "modalBackdrop") closeModal();
};

/* ---------------------------------------------------------------- 启动 */
$("#nav").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-page]");
  if (a) navigate(a.dataset.page);
});

async function syncPause() {
  const p = await api("/api/pause");
  const btn = $("#btnPause");
  if (!btn) return;
  if (p && p.paused) {
    btn.textContent = "已暂停";
    btn.classList.add("danger");
  } else {
    btn.textContent = "暂停";
    btn.classList.remove("danger");
  }
}

$("#btnPause").onclick = async () => {
  const cur = await api("/api/pause");
  await api("/api/pause", {
    method: "POST",
    body: JSON.stringify({ paused: !(cur && cur.paused) }),
  });
  await syncPause();
  toast((cur && cur.paused) ? "已恢复执行" : "已暂停所有批次");
};

$("#btnRefresh").onclick = async () => {
  await loadAll();
  await render();
  toast("已刷新");
};

(async function boot() {
  await loadAll();
  await syncPause();
  const p = location.hash.replace("#", "") || "dash";
  navigate(PAGE_META[p] ? p : "dash");

  // 概览/任务页静默轮询
  setInterval(async () => {
    if (state.page === "dash" || state.page === "tasks") {
      await loadAll();
      if (state.page === "dash") renderDash($("#view"));
      else renderTasks($("#view"));
    }
  }, 2500);
})();
