/**
 * 小红书工作台 —— Node 执行器
 *
 * 职责：每个 skill 一个 handler，用 Playwright 驱动真实浏览器。
 * 输出协议：每行一个 JSON
 *   {"type":"progress","progress":40,"message":"..."}
 *   {"type":"log","message":"..."}
 *   {"type":"result","ok":true,"data":{...},"shots":[...]}
 */
const path = require('path');
const fs = require('fs');

// Playwright 位置：优先环境变量，其次 config.node_base，最后交给 Node 自行解析
function pwCandidates(cfg) {
  const bases = [];
  if (process.env.XHS_NODE_BASE) bases.push(process.env.XHS_NODE_BASE);
  if (cfg && cfg.node_base) bases.push(cfg.node_base);
  bases.push(path.join(path.dirname(process.execPath), '..'));
  bases.push(process.cwd());
  const out = [];
  for (const b of bases) {
    out.push(path.join(b, 'node_modules', 'playwright'));
  }
  out.push('playwright');
  return out;
}

function loadPlaywright(cfg) {
  for (const p of pwCandidates(cfg)) {
    try { return require(p); } catch (e) { /* next */ }
  }
  return null;
}

const payload = JSON.parse(process.argv[2] || '{}');
const { task_id, skill, params = {}, account = null, config = {}, base_dir } = payload;

const SHOTS_DIR = path.join(base_dir, 'data', 'shots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

function emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
function progress(p, message) { emit({ type: 'progress', progress: p, message }); }
function log(message) { emit({ type: 'log', message }); }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 人类化：随机停顿
async function pause(kind = 'normal') {
  const table = { short: [200, 600], normal: [500, 1500], long: [1500, 4000] };
  const [a, b] = table[kind] || table.normal;
  await sleep(rand(a, b));
}

async function shot(page, tag) {
  try {
    const name = `${task_id}-${Date.now()}-${String(tag).replace(/[^\w\u4e00-\u9fa5-]/g, '_')}.png`;
    const full = path.join(SHOTS_DIR, name);
    await page.screenshot({ path: full, fullPage: false });
    return name;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- 选择器
const DEFAULT_SELECTORS = {
  creator_home: 'https://creator.xiaohongshu.com/new/home',
  publish_url: 'https://creator.xiaohongshu.com/publish/publish',
  login_marker: [
    '.user-info', '.avatar', '[class*="avatar"]', '.name-box',
    'text=发布笔记', '.side-bar',
  ],
  login_required: [
    'text=扫码登录', 'text=短信登录', 'text=登录', 'img[src*="qrcode"]', '.login-container',
  ],
  qr_toggle: [
    '[class*="qrcode"]', '[class*="qr-code"]', 'img[src*="qrcode"]',
    '.login-switch', '.switch-type img', '[class*="code-icon"]',
  ],
  file_input: ['input[type="file"]'],
  title_input: [
    'input[placeholder*="标题"]', '#post-title',
    'input.d-text', '.title-input input', 'input[placeholder*="填写标题"]',
  ],
  content_editor: [
    'div[contenteditable="true"]', '.ql-editor',
    '.content-input div[contenteditable]', '#post-textarea',
  ],
  publish_button: [
    'button:has-text("发布")', 'div.submit-btn', '.publishBtn',
    'button.d-button--primary:has-text("发布")',
  ],
  note_title: ['#detail-title', '.note-title', 'h1', '.title'],
  like_count: ['#note-page-like', '.like-wrapper .count', '[class*="like"] [class*="count"]'],
};

function cacheSelectors(base_dir) {
  const p = path.join(base_dir, 'workers', 'selectors.json');
  if (fs.existsSync(p)) {
    try {
      return { ...DEFAULT_SELECTORS, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
    } catch (e) { return DEFAULT_SELECTORS; }
  }
  return DEFAULT_SELECTORS;
}

const SEL = cacheSelectors(base_dir);

async function firstVisible(page, candidates, timeout = 8000) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of list) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0 && await loc.isVisible({ timeout: 500 })) {
          return { loc, sel };
        }
      } catch (e) { /* 继续尝试 */ }
    }
    await sleep(300);
  }
  return null;
}

async function countVisible(page, candidates) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const sel of list) {
    try {
      const n = await page.locator(sel).count();
      if (n > 0) return { n, sel };
    } catch (e) { /* ignore */ }
  }
  return { n: 0, sel: null };
}

async function humanType(page, locator, text) {
  const d = Number(config.typing_delay_ms || 60);
  try {
    await locator.click({ timeout: 5000 });
    await pause('short');
  } catch (e) { /* 有些富文本点不进去 */ }
  for (const ch of String(text)) {
    await page.keyboard.type(ch);
    await sleep(rand(Math.floor(d / 2), d * 2));
  }
}

// ---------------------------------------------------------------- 浏览器
async function openContext(chromium, { headless }) {
  const profileDir = account && account.profile_dir
    ? account.profile_dir
    : path.join(base_dir, 'data', 'profiles', 'default');
  fs.mkdirSync(profileDir, { recursive: true });

  const options = {
    headless: headless === undefined ? Boolean(config.headless) : headless,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };
  if (config.browser_channel) options.channel = config.browser_channel;

  try {
    const ctx = await chromium.launchPersistentContext(profileDir, options);
    return { ctx, profileDir };
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('ProcessSingleton') || msg.includes('SingletonLock') || msg.includes('already in use')) {
      const err = new Error('该账号的浏览器档案正被另一个进程占用，请先关闭该账号的浏览器窗口');
      err.code = 'PROFILE_LOCKED';
      throw err;
    }
    throw e;
  }
}

async function getPage(ctx) {
  const pages = ctx.pages();
  return pages.length ? pages[0] : await ctx.newPage();
}

async function detectLogin(page) {
  const url = page.url();

  // 最强信号：创作服务平台未登录会 401 重定向到 /login?redirectReason=401
  if (/\/login|redirectReason|401/.test(url)) return 'expired';

  const req = await countVisible(page, SEL.login_required);
  if (req.n > 0) return 'expired';

  // DOM 兜底：页面上出现"扫码登录/登录"字样
  try {
    const body = await page.locator('body').innerText({ timeout: 2000 });
    if (body && /扫码登录|短信登录|登录后|请先登录|立即登录|获取验证码/.test(body) && body.length < 1200) return 'expired';
  } catch (e) { /* ignore */ }

  const mkr = await countVisible(page, SEL.login_marker);
  if (mkr.n > 0) return 'logged_in';

  return 'unknown';
}

// 千帆后台的 IP 风险拦截
async function detectRiskBlock(page) {
  try {
    const url = page.url();
    const body = await page.locator('body').innerText({ timeout: 2000 });
    if (/IP存在风险|error_code=300012|安全限制/.test(url + ' ' + body)) {
      return '千帆后台拦截了当前网络出口（IP存在风险 / 300012）。这不是代码问题：' +
        '小红书对店铺后台的 IP 极敏感，需要换到干净的住宅网络或加代理，再重试。';
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function settle(page, ms = 2500) {
  await page.waitForLoadState('load').catch(() => {});
  try { await page.waitForLoadState('networkidle', { timeout: ms }); } catch (e) { /* 不强求 */ }
  await sleep(800);
}

// ---------------------------------------------------------------- Skills
const handlers = {};

handlers.xhs_check_login = async ({ ctx, page }) => {
  progress(30, '打开创作服务平台');
  await page.goto(SEL.creator_home, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);
  const status = await detectLogin(page);
  const blocked = await detectRiskBlock(page);
  const s = await shot(page, 'check-login');
  if (blocked) {
    return { ok: false, message: '网络被拦截', error: blocked, data: { status, url: page.url() }, shots: s ? [s] : [] };
  }
  return {
    ok: true,
    message:
      status === 'logged_in' ? '登录态有效'
      : status === 'expired' ? '登录已失效，需要扫码'
      : '状态未知（页面结构未匹配）',
    data: { status, url: page.url() },
    shots: s ? [s] : [],
  };
};

handlers.xhs_login = async ({ ctx, page }) => {
  progress(20, '打开登录页，请在浏览器窗口内扫码');
  await page.goto(SEL.creator_home, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);

  // 小红书默认展示短信登录，先尝试切到扫码
  const toggle = await firstVisible(page, SEL.qr_toggle, 5000);
  if (toggle) {
    await toggle.loc.click({ force: true }).catch((e) => log('切换扫码失败: ' + e.message));
    log('已尝试切换到扫码登录');
    await sleep(1500);
  } else {
    log('未找到扫码切换入口，可能是短信登录页');
  }

  const waitMs = Number(params.wait_seconds || 120) * 1000;
  const deadline = Date.now() + waitMs;
  let status = 'unknown';
  while (Date.now() < deadline) {
    status = await detectLogin(page);
    if (status === 'logged_in') break;
    await sleep(2000);
  }
  const s = await shot(page, 'login');
  if (status === 'logged_in') {
    return { ok: true, message: '登录成功，会话已保存', data: { logged_in: true }, shots: s ? [s] : [] };
  }
  return {
    ok: false,
    message: '未检测到登录',
    error: `等待 ${params.wait_seconds || 120}s 仍未检测到登录态，请确认已完成扫码`,
    data: { logged_in: false, status },
    shots: s ? [s] : [],
  };
};

handlers.xhs_publish_note = async ({ ctx, page }) => {
  const media = (params.media || '')
    .split('\n').map(x => x.trim()).filter(Boolean);
  const mediaType = params.media_type || 'image';
  progress(10, '打开发布页');
  await page.goto(SEL.publish_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause('long');

  const status = await detectLogin(page);
  if (status === 'expired') {
    const s = await shot(page, 'need-login');
    return { ok: false, message: '登录已失效', error: '请先运行「扫码登录」', shots: s ? [s] : [] };
  }

  if (mediaType === 'video') {
    progress(20, '切换到视频上传');
    const tab = await firstVisible(page, ['text=上传视频', 'div:has-text("上传视频")'], 6000);
    if (tab) { await tab.loc.click().catch(() => {}); await pause('normal'); }
  }

  if (media.length) {
    progress(30, `上传 ${media.length} 个素材`);
    let input = null;
    for (const sel of SEL.file_input) {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) { input = loc; break; }
    }
    if (!input) {
      const s = await shot(page, 'no-file-input');
      return { ok: false, message: '找不到上传控件', error: 'file input 未找到，页面可能改版', shots: s ? [s] : [] };
    }
    try {
      await input.setInputFiles(media);
    } catch (e) {
      const s = await shot(page, 'upload-fail');
      return { ok: false, message: '素材上传失败', error: String(e.message), shots: s ? [s] : [] };
    }
    await pause('long');
    await sleep(2000);
  }

  progress(50, '填写标题');
  const titleEl = await firstVisible(page, SEL.title_input, 15000);
  if (!titleEl) {
    const s = await shot(page, 'no-title');
    return { ok: false, message: '找不到标题输入框', error: '标题选择器失配，请更新 selectors.json', shots: s ? [s] : [] };
  }
  await humanType(page, titleEl.loc, params.title || '');
  await pause('normal');

  progress(65, '填写正文');
  const editor = await firstVisible(page, SEL.content_editor, 10000);
  if (editor) {
    let text = params.content || '';
    const topics = (params.topics || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
    if (topics.length) text += '\n' + topics.map(t => '#' + t).join(' ');
    await humanType(page, editor.loc, text);
  } else {
    log('未找到正文编辑器，跳过正文');
  }
  await pause('normal');

  progress(80, '检查发布按钮');
  const btn = await firstVisible(page, SEL.publish_button, 10000);
  const s1 = await shot(page, 'before-publish');

  if (params.dry_run) {
    return {
      ok: true,
      message: '演练完成，已填充但未发布',
      data: { published: false, dry_run: true, url: page.url() },
      shots: s1 ? [s1] : [],
    };
  }

  if (!btn) {
    return {
      ok: false,
      message: '找不到发布按钮',
      error: '发布按钮选择器失配，请更新 selectors.json 或改为演练模式',
      shots: s1 ? [s1] : [],
    };
  }

  progress(90, '点击发布');
  await pause('normal');
  await btn.loc.click({ timeout: 10000 }).catch(async (e) => {
    log('常规点击失败，尝试强制点击: ' + e.message);
    await btn.loc.click({ force: true, timeout: 5000 });
  });
  await pause('long');
  await sleep(3000);

  const s2 = await shot(page, 'after-publish');
  const body = await page.content();
  const successHint = /发布成功|已发布|笔记发布|发布完成/.test(body);
  return {
    ok: true,
    message: successHint ? '发布成功' : '已点击发布，但未捕获成功信号',
    data: {
      published: true,
      confirmed: successHint,
      // 点了按钮但确认不到 → 结果未知，调用方必须核查而不是重发
      uncertain: !successHint,
      hint: successHint,
      command_id: params.command_id || '',
      url: page.url(),
    },
    shots: [s1, s2].filter(Boolean),
  };
};

handlers.xhs_fetch_note = async ({ ctx, page }) => {
  const url = params.url;
  if (!url) return { ok: false, message: '缺少链接', error: 'url 必填' };
  progress(20, '打开笔记');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause('long');
  await sleep(1500);

  const text = await page.content();
  const grab = (re) => { const m = text.match(re); return m ? m[1] : ''; };
  const title = await page.locator(SEL.note_title[0]).first().textContent().catch(() => '') || '';

  const nums = (await page.locator('body').innerText().catch(() => '')) || '';
  const collect = (label) => {
    const re = new RegExp(label + '\\s*\\n?\\s*([0-9.]+[万wW]?)');
    const m = nums.match(re);
    return m ? m[1] : '';
  };

  const s = await shot(page, 'note');
  return {
    ok: true,
    message: '抓取完成',
    data: {
      url,
      title: (title || '').trim(),
      like: collect('点赞') || collect('赞'),
      collect: collect('收藏'),
      comment: collect('评论'),
      og_title: grab(/<meta property="og:title" content="([^"]*)"/),
    },
    shots: s ? [s] : [],
  };
};

handlers.xhs_publish_product = async ({ ctx, page, dbProduct }) => {
  progress(15, '打开千帆商品创建页');
  await page.goto('https://ark.xiaohongshu.com/app-item/create', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log('千帆跳转中断: ' + e.message));
  await settle(page, 3000);

  const blocked = await detectRiskBlock(page);
  const s1 = await shot(page, 'ark-open');
  if (blocked) {
    return { ok: false, message: '网络被拦截', error: blocked, shots: s1 ? [s1] : [] };
  }
  if (!dbProduct) {
    return {
      ok: false,
      message: '商品不存在',
      error: '本地没有该商品记录，请先在「商品」页创建',
      shots: s1 ? [s1] : [],
    };
  }

  progress(40, '预填商品名称');
  const titleEl = await firstVisible(page, [
    'input[placeholder*="商品名称"]', 'input[placeholder*="名称"]', 'input[type="text"]',
  ], 12000);
  if (titleEl) await humanType(page, titleEl.loc, dbProduct.title || '');
  await pause('normal');

  progress(60, '预填价格与库存');
  const priceEl = await firstVisible(page, [
    'input[placeholder*="价格"]', 'input[placeholder*="售价"]',
  ], 6000);
  if (priceEl) await humanType(page, priceEl.loc, String(dbProduct.price || ''));

  const stockEl = await firstVisible(page, [
    'input[placeholder*="库存"]', 'input[placeholder*="数量"]',
  ], 4000);
  if (stockEl) await humanType(page, stockEl.loc, String(dbProduct.stock || ''));

  await pause('normal');
  const s2 = await shot(page, 'ark-filled');

  if (!params.auto_submit) {
    return {
      ok: true,
      message: '已预填，请到浏览器窗口人工确认并提交',
      data: { submitted: false, url: page.url() },
      shots: [s1, s2].filter(Boolean),
    };
  }
  return {
    ok: false,
    message: '自动提交未开放',
    error: '商品自动提交涉及店铺资金安全，默认禁用；如确需开启请修改 worker.js 并自担风险',
    shots: [s1, s2].filter(Boolean),
  };
};

// ---------------------------------------------------------------- 主流程
(async () => {
  const pw = loadPlaywright(config);
  if (!pw) {
    emit({ type: 'result', ok: false, message: 'Playwright 未找到', error: '无法加载 playwright 模块' });
    return;
  }
  const handler = handlers[skill];
  if (!handler) {
    emit({ type: 'result', ok: false, message: '未知 skill', error: `没有这个 skill: ${skill}` });
    return;
  }

  const needsBrowser = !['auto_delivery'].includes(skill);
  if (!needsBrowser) {
    emit({ type: 'result', ok: false, message: '该 skill 由 Python 侧执行', error: 'routed_to_python' });
    return;
  }

  let ctx = null;
  try {
    progress(15, '启动浏览器');
    const { ctx: c } = await openContext(pw.chromium, {
      headless: skill === 'xhs_login' ? false : undefined,
    });
    ctx = c;
    const page = await getPage(ctx);
    const res = await handler({ ctx, page });
    emit({ type: 'result', ...res });
  } catch (e) {
    let s = null;
    try {
      const pages = ctx ? ctx.pages() : [];
      if (pages.length) s = await shot(pages[0], 'exception');
    } catch (ignored) {}
    emit({
      type: 'result',
      ok: false,
      message: '执行异常',
      error: String(e.message || e),
      shots: s ? [s] : [],
    });
  } finally {
    try { if (ctx) await ctx.close(); } catch (e) { /* ignore */ }
  }
})();
