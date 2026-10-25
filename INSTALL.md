# 安装

## 依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| Windows | 10 / 11 | 目前只在 Windows 验证过 |
| Python | **3.11** | 必须是 3.11；内核是字节码，与次版本绑定 |
| Microsoft Edge | 任意 | 系统自带 |
| Node.js | 18+ | 可选；没有则只能用「导出待发包」模式 |

## 一、拿内核

打开本仓库的 **Releases** 页面，下载 `app-x.y.z.zip`，放进 `releases/` 目录：

```
releases/
└── app-1.0.0.zip
```

不要去别处下载内核——只认本仓库 Releases 的文件，并核对 `SHA256SUMS.txt`。

## 二、装依赖

```
pip install flask requests
```

（可选，启用浏览器自动化）

```
npm i -g playwright
npx playwright install msedge
```

## 三、启动

双击 `启动工作台.vbs`（无黑窗），或 `start.bat`（有控制台，排错用）。

浏览器打开 `http://127.0.0.1:8788`。

## 四、首次使用

1. 「设置」填 DeepSeek API Key
2. 「账号」添加账号，扫码登录
3. 「批次创作」填方向 → 生成 → 审核
4. 「复制台」或「任务」查看发布

## 常见问题

**启动提示「找不到内核文件」**
→ 没把 `app-*.zip` 放进 `releases/`，见第一步。

**提示「内核校验失败」**
→ 文件损坏或被改动，重新从 Releases 下载。

**`ModuleNotFoundError: No module named flask`**
→ 没装依赖，`pip install flask requests`。

**`Bad magic number`**
→ Python 版本不对，换 3.11。

**千帆后台提示 IP 存在风险（300012）**
→ 平台对店铺后台出口 IP 有校验，换网络或加代理，不是程序问题。

## 改前端

`web/` 是纯静态文件（HTML/CSS/原生 JS，无构建步骤），改完刷新即可。
`web/app.js` 里所有接口调用都在 `api()` 函数附近，容易定位。
