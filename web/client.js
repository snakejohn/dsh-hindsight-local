// dsh-hindsight-memory — browser half (settings panel, status page, first-run choice).
// Hand-written in dsh's closure-factory bundle format (packages/client/tsdown.client.ts):
// no build step; `require` resolves only the shell's shared module table (react).
// Visual language: iOS 26 "Liquid Glass" — translucent frosted cards, inset grouped lists,
// capsule segmented controls and switches, SF system font stack, light/dark via
// prefers-color-scheme. All network work (Hindsight, provider /models) goes through the
// plugin's server-side route `/api/dsh-hindsight` on dsh's Connection service, so keys
// never travel to the browser and CORS does not apply.
window.__ModuleLoader__.load({
  id: "dsh-hindsight-memory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useRef, useSyncExternalStore } = React;
    const PKG = "dsh-hindsight-memory";
    const NS_FORM = "dsh-hindsight-memory";
    const NS = "dshHindsight";
    const ROUTE = "api/dsh-hindsight";

    const zh = {
      title: "长期记忆", summary: "长期记忆：让 AI 记住你们聊过的事",
      tabSettings: "设置", tabStatus: "状态",
      choose: "记忆服务放在哪里？",
      existing: "我已经有记忆服务", existingHint: "适合懂技术的用户：连接一个已经在运行的 Hindsight 服务",
      local: "装在这台电脑上（推荐）", localHint: "记忆存在你自己的电脑里，大约占用 500MB 内存。缺少的运行环境会自动下载，不用你操心。",
      shareKey: "留空 = 和上面用同一个密钥", deployTitle: "准备进度", step_config: "检查设置", step_python: "准备运行环境", step_install: "下载记忆程序", step_start: "启动", step_health: "检查是否正常",
      port: "端口", pid: "进程号", mem: "内存", logTail: "运行记录（给技术支持看）", installTail: "下载记录", logDir: "记录保存位置", envFile: "设置文件（.env）", checkConn: "检查一下", redeploy: "重新安装", restart: "重新启动", connOk: "一切正常", connBad: "连不上", hintT: "怎么办",
      rechoose: "重新选择", save: "保存", saved: "已保存，正在按新设置重新准备", failed: "保存没有成功，请再点一次保存；还不行就重启 dsh", unsaved: "有未保存的修改",
      conn: "连接", baseUrl: "接口地址", apiKey: "密钥", apiPrefix: "接口路径前缀", secretSet: "已设置（留空不修改）", keyUnset: "未设置", keyUseDsh: "使用 dsh 的密钥", keySrc: "来源", src_dotenv: "本插件的设置文件（.env）", "src_plugin-config": "dsh 插件配置", src_env: "系统环境变量", src_dsh: "dsh 的密钥", clearKeys: "清除密钥", clearKeysAsk: "确定清除已保存的密钥吗？会同时清掉本插件 .env 和 dsh 插件配置里的密钥（不影响 dsh 自己的模型密钥）。", clearKeysDone: "已清除密钥", modelsLoading: "正在获取模型…", modelsCount: "共 {n} 个可选模型，也可以直接输入模型名", modelsNone: "还没有获取到模型列表，可以直接输入模型名", modelsManual: "仍可在上面手动输入模型名", modelSearch: "搜索或输入模型名", modelPick: "选择或输入模型", proxy: "代理", proxyAuto: "自动", proxyOff: "不用代理", proxyCustom: "自定义地址", proxyFoot: "「自动」跟随系统代理，并自动去掉无法识别的地址（如 [::1]）。启动时报「端口无效」（Invalid port）可选「不用代理」。", sModels: "模型（一般不用改）",
      deploy: "本地部署", runner: "安装方式", variant: "版本", port: "端口", cp: "同时打开官方管理后台", cpHint: "官方的网页管理后台（端口 9999；电脑上需要有 Node.js，第一次打开要联网下载约 80MB）",
      emb: "理解文字的模型", embFoot: "用来理解每句话的意思，找回相关的记忆。必须设置。", dim: "向量维度", dimFoot: "向量维度：模型把一句话变成多少个数字。bge-m3 是 1024，一般不用改。换模型或迁移时必须和原来一致，不一致时插件会拦下来并提示，不会弄坏已有记忆。", rr: "排序模型", rrFoot: "把找回的记忆按相关程度排好。选「不用模型」就只按简单规则排序。", llm: "整理记忆的模型",
      preset: "服务商", provider: "接口类型", model: "模型", fetchModels: "获取模型", modelsN: "个模型", modelsErr: "获取模型失败",
      follow: "和 dsh 用同一个", custom: "自己指定", none: "不整理",
      followOk: "使用 dsh 默认模型", followNoKey: "dsh 的模型还没有密钥，所以暂时只保存原话、不做整理。", followInfo: "密钥来自", followOnlyLocal: "只对装在本机的记忆服务有效。", noneFoot: "不整理，只原样保存对话。",
      bank: "记忆库", ownBank: "新建库", ownAuto: "新建库（自动命名）", ownNamed: "新建库，自己起名…", joinBank: "接入已有库", usedBy: "已被使用：", newBank: "新建记忆库…", newBankPrompt: "给新记忆库起个名字（中文也可以）",
      ws: "工作区", wsFoot: "对话数不含已归档的对话；归档的对话不会被记住。", sessions: "个对话", archivedN: "个已归档", unmapped: "（默认路由）", addPath: "手动添加路径", path: "工作区文件夹", bankId: "记忆库名字", remove: "删除", noWs: "dsh 未提供工作区服务，可手动添加路径。",
      importQ: "要导入以前的对话吗？", importText: "装好后只会自动记住新的聊天。以前的对话可以在下面「现在就记住」里选一个工作区或单个对话导入：会一段一段慢慢整理，已经记过的不会重复。", importGo: "去选择", importNo: "不用了", pickOne: "选择单个对话", pickHide: "收起", retainPicked: "记住选中的对话", recorded: "已记过", noSessions: "没有找到对话", retainNow: "现在就记住", retainSel: "记住这个工作区的对话", retainAll: "记住全部对话（不含已归档）", retainHint: "已经记住过的内容不会重复记。", running: "进行中", done: "完成",
      other: "其他", sideCard: "侧栏显示状态卡片", sideCardH: "左下角的记忆状态卡片；关掉后不显示，记忆照常工作。", rcTitle: "记住哪些内容", rcFoot: "只影响以后新记的内容，已经记住的不会改。设置同时保存在插件目录的 .env 里。", rcUser: "我说的话", rcUserH: "你发给 AI 的消息。", rcAsst: "AI 的回复", rcAsstH: "AI 回给你的正文。", rcTool: "工具调用内容", rcToolH: "AI 读文件、搜网页等工具的输入和结果，通常又长又杂，默认不记。", rcToolMax: "每条工具内容最多保留几个字", rcReason: "AI 的思考过程", rcReasonH: "模型的推理草稿，会截断后再记，默认不记。", rcSys: "系统提示", rcSysH: "角色设定等系统提示，只在它变化时记一次，默认不记。", rcArch: "已归档的对话", rcArchH: "打开后，归档的对话也会被记住和导入。", rcSub: "子代理的对话", rcSubH: "AI 自己派出去干活的子任务对话，默认不记。", rcMin: "最短字数", rcMinH: "一轮对话太短就不记（默认 24，中文一个字算 2）。", rcInj: "插件自己插入的记忆", rcInjH: "回忆时插进对话的记忆块永远不会再被记一遍，否则会越记越多、自己重复自己。", rcAlwaysOff: "永远不记", recall: "聊天时自动回忆", retain: "自动记住对话", backfill: "启动时把以前的对话也记住", timezone: "时区", topN: "每次最多回忆几条",
      health: "记忆服务", state: "状态", version: "版本", openCp: "打开官方管理后台", banks: "记忆库", memories: "条记忆", docs: "段对话",
      feedback: "反馈问题", exportLogs: "导出日志", exported: "已导出（密钥已隐藏）：", openIssue: "去提问题 ↗", feedbackFoot: "遇到问题：先点「导出日志」，再点「去提问题」，把导出的文件拖进问题表单。导出时会自动隐藏密钥，上传前也请再看一眼。", job: "记住进度", pendingTip: "已交给记忆服务、还在整理中（需要整理记忆的模型能连上）", failedTip: "整理失败的条数：多半是整理记忆的模型连不上或密钥无效，详情见记忆服务日志（hindsight.log）", jobTip: "已提交：交给记忆服务的对话 · 完成：真的整理好写进记忆库 · 处理中：排队或正在整理 · 失败：整理没成功（会自动重试） · ↷ 跳过（已记过/子任务） · 🗄 已归档", submitted: "已提交", opsDone: "完成", opsProc: "处理中", opsFail: "失败", retryFailed: "重试失败项", retrying: "已重新排队 {n} 项", dataDir: "数据目录", dataDirPh: "留空＝自动", dataDirHint: "记忆服务的程序、数据库和模型缓存放在这里。留空会自动选择：Windows 用户名含中文时改放到 C:\\Users\\Public\\dsh-hindsight。自己填写时请用纯英文路径（例如 D:\\dsh-hindsight），改完后重新部署。", conc: "同时处理数", concHint: "同时整理几段对话（1-4）。免费模型或中转服务请保持 1，否则容易被限流。", recent: "最近记住的", failures: "没记住的", empty: "暂无", browse: "看看记住了什么", browseSum: "共 {n} 条记忆，{b} 个记忆库", browseOpen: "展开看看", collapse: "收起", loadMore: "加载更多", shownOf: "已显示 {a} / {b} 条", hideMem: "隐藏内容", tapShow: "点一下显示", search: "搜索记忆", llmFallback: "整理记忆的模型暂时不可用，目前只保存原话",
      loading: "正在读取配置…", unavailable: "设置页面没有加载出来，请重启 dsh 再试。", noRpc: "插件还没连上，请稍等或重启 dsh",
      sLlm: "整理记忆的模型", sLlmTip: "它负责把聊天内容整理成一条条好找的记忆。默认和 dsh 用同一个模型，不用另外设置。",
      sLlmOk: "和 dsh 用同一个模型 ✓", sLlmNeed: "默认用 dsh 正在用的 {m}。插件拿不到 dsh 保存的密钥，请把这个模型的密钥也粘贴一次（不填也能用，只是先只保存原话、不做整理）。", sLlmPh: "粘贴 dsh 模型的密钥（可选）",
      sTitle: "三步开始使用", s1: "① 选服务商", s2: "② 粘贴密钥", s3: "③ 一键开始", sfName: "硅基流动（推荐，新用户有免费额度）",
      s2help: "到 cloud.siliconflow.cn 注册登录 → 左侧「API 密钥」→「新建密钥」→ 复制 sk- 开头的一串字，粘贴到这里。「理解文字」和「排序」两个模型共用这一个密钥。",
      keyPh: "粘贴 sk- 开头的密钥", keyChecking: "正在检查密钥…", keyOk: "密钥可以用 ✓", keySaved: "已保存过密钥（重新粘贴可替换）",
      go: "一键开始", going: "正在准备，第一次大约需要 3–10 分钟…", advanced: "高级设置（一般不用改）", retry: "重试",
      whatHappened: "发生了什么", howFix: "怎么做", qm: "这是什么？",
      activation: "长期记忆已打开。只需粘贴一个密钥就能用，现在设置吗？", openDetails: "去设置", later: "稍后"
    };
    const en = Object.assign({}, zh);

    const CSS = `
.hs26{--hs-bg:rgba(255,255,255,.62);--hs-bg2:rgba(255,255,255,.38);--hs-line:rgba(60,60,67,.14);--hs-text:#1c1c1e;--hs-sub:rgba(60,60,67,.62);--hs-tint:#0a84ff;--hs-green:#30d158;--hs-red:#ff453a;--hs-orange:#ff9f0a;--hs-fill:rgba(120,120,128,.14);--hs-shadow:0 8px 32px rgba(0,0,0,.08),inset 0 1px 0 rgba(255,255,255,.7);
font:15px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;color:var(--hs-text);padding:14px;border-radius:28px;
background:radial-gradient(120% 80% at 0% 0%,rgba(10,132,255,.14),transparent 60%),radial-gradient(100% 70% at 100% 100%,rgba(191,90,242,.12),transparent 60%);-webkit-font-smoothing:antialiased}
.hs26.dk{--hs-bg:rgba(44,44,46,.55);--hs-bg2:rgba(58,58,60,.4);--hs-line:rgba(84,84,88,.45);--hs-text:#f2f2f7;--hs-sub:rgba(235,235,245,.6);--hs-fill:rgba(120,120,128,.28);--hs-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.08)}
.hs26 *{box-sizing:border-box}
.hs26 .glass{background:var(--hs-bg);backdrop-filter:blur(28px) saturate(180%);-webkit-backdrop-filter:blur(28px) saturate(180%);border:1px solid rgba(255,255,255,.22);box-shadow:var(--hs-shadow)}
.hs26 .hdr{font-size:13px;text-transform:uppercase;letter-spacing:.02em;color:var(--hs-sub);margin:22px 18px 7px}
.hs26 .foot{font-size:12.5px;color:var(--hs-sub);margin:7px 18px 0}
.hs26 .group{border-radius:26px;overflow:hidden}
.hs26 .row{display:flex;align-items:center;gap:10px;min-height:48px;padding:8px 18px;position:relative;animation:hsIn .32s cubic-bezier(.2,.8,.2,1)}
.hs26 .row+.row:before{content:"";position:absolute;top:0;left:18px;right:0;border-top:.5px solid var(--hs-line)}
.hs26 .lbl{flex:0 0 auto;min-width:110px}
.hs26 .val{flex:1;display:flex;justify-content:flex-end;align-items:center;gap:8px;min-width:0;color:var(--hs-sub)}
.hs26 input[type=text],.hs26 input[type=password],.hs26 input[type=number],.hs26 input[type=search],.hs26 select{font:inherit;color:var(--hs-text);background:transparent;border:0;outline:0;text-align:right;min-width:0;width:100%;padding:6px 0}
.hs26 select{appearance:none;-webkit-appearance:none;cursor:pointer;color:var(--hs-tint);width:auto;max-width:100%}
.hs26 input::placeholder{color:var(--hs-sub);opacity:.7}
.hs26 .seg{display:inline-flex;padding:3px;border-radius:999px;background:var(--hs-fill);gap:2px}
.hs26 .seg button{font:inherit;font-size:13.5px;border:0;background:transparent;color:var(--hs-text);padding:6px 14px;border-radius:999px;cursor:pointer;transition:all .28s cubic-bezier(.2,.8,.2,1)}
.hs26 .seg button[aria-pressed=true]{background:var(--hs-bg);box-shadow:0 3px 10px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.5);font-weight:600}
.hs26 .tabs{display:flex;justify-content:center;margin:2px 0 6px}
.hs26 .tabs .seg button{padding:8px 26px;font-size:14.5px}
.hs26 .sw{width:51px;height:31px;border-radius:999px;border:0;background:var(--hs-fill);position:relative;cursor:pointer;transition:background .25s;flex:0 0 auto}
.hs26 .sw:after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:999px;background:#fff;box-shadow:0 3px 8px rgba(0,0,0,.18);transition:transform .3s cubic-bezier(.3,1.4,.5,1)}
.hs26 .sw[aria-checked=true]{background:var(--hs-green)}.hs26 .sw[aria-checked=true]:after{transform:translateX(20px)}
.hs26 .btn{font:inherit;font-weight:600;border:0;border-radius:999px;padding:10px 20px;cursor:pointer;color:#fff;background:var(--hs-tint);box-shadow:0 6px 18px rgba(10,132,255,.32);transition:transform .15s}
.hs26 .btn:active{transform:scale(.97)}.hs26 .btn[disabled]{opacity:.45;cursor:default}
.hs26 .btn.ghost{background:var(--hs-fill);color:var(--hs-tint);box-shadow:none}
.hs26 .btn.small{padding:6px 13px;font-size:13px}
.hs26 .pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;background:var(--hs-fill);color:var(--hs-sub);white-space:nowrap}
.hs26 .pill.ok{background:rgba(48,209,88,.18);color:#248a3d}.hs26 .pill.bad{background:rgba(255,69,58,.16);color:#d70015}.hs26 .pill.warn{background:rgba(255,159,10,.18);color:#c93400}
.hs26.dk .pill.ok{color:#30d158}.hs26.dk .pill.bad{color:#ff6961}.hs26.dk .pill.warn{color:#ffb340}
.hs26 .card{border-radius:26px;padding:18px;margin:10px 0;cursor:pointer;transition:transform .2s}
.hs26 .card:hover{transform:translateY(-2px)}
.hs26 .sub{font-size:12.5px;color:var(--hs-sub)}
.hs26 .mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12.5px}
.hs26 .bar{height:6px;border-radius:999px;background:var(--hs-fill);overflow:hidden;flex:1}.hs26 .bar>i{display:block;height:100%;background:linear-gradient(90deg,#0a84ff,#64d2ff);border-radius:999px;transition:width .4s}
.hs26 pre.logtail{font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all;margin:6px 0 0;padding:10px;border-radius:12px;background:rgba(127,127,127,.12)}
.hs26 details summary{cursor:pointer;font-size:14px}
.hs26 .row.step .lbl{flex:0 0 auto}
.hs26 details.adv{margin-top:18px}.hs26 details.adv>summary{cursor:pointer;color:var(--hs-sub);font-size:14px;padding:8px 4px;list-style:none}.hs26 details.adv>summary:before{content:"▸ "}.hs26 details.adv[open]>summary:before{content:"▾ "}
.hs26 .row.col{flex-direction:column;align-items:stretch;gap:6px}.hs26 .row.col input{width:100%;text-align:left;max-width:none}
.hs26 .qm{display:inline-grid;place-items:center;width:17px;height:17px;border-radius:50%;background:var(--hs-fill);color:var(--hs-sub);font-size:11px;cursor:help;vertical-align:1px}
.hs26 .okbox{color:var(--hs-green);font-weight:600;font-size:14px}.hs26 .guide b{font-weight:600}.hs26 .guide>div{margin:2px 0}
.hs-side{all:unset;box-sizing:border-box;display:block;width:calc(100% - 12px);margin:4px 6px;padding:8px 10px;border-radius:16px;cursor:pointer;font:13px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif;color:var(--hs-text);background:var(--hs-bg);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);border:1px solid var(--hs-line);box-shadow:var(--hs-shadow);--hs-gray:#8e8e93}
.hs-side.mini{width:36px;height:36px;padding:0;display:grid;place-items:center;border-radius:12px}
.hs-side:hover{filter:brightness(1.04)}
.hs-side-top{display:flex;align-items:center;gap:8px}
.hs-side-t{font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hs-side-sub{font-size:11.5px;color:var(--hs-sub);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hs-side-why{font-size:11.5px;line-height:1.4;color:var(--hs-sub);margin-top:3px;white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden}
.hs-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;display:inline-block}
.hs-dot.pulse{animation:hspulse 1.2s ease-in-out infinite}
@keyframes hspulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.hs-dot.pulse{animation:none}}
.hs26 .savebar{position:sticky;bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:999px;padding:8px 8px 8px 20px;margin-top:20px}
.hs26 .chk{width:22px;height:22px;border-radius:999px;border:1.5px solid var(--hs-line);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:#fff;font-size:13px;flex:0 0 auto}
.hs26 .chk[aria-checked=true]{background:var(--hs-tint);border-color:var(--hs-tint)}
.hs26 .warnbox{border-radius:20px;padding:12px 16px;margin-top:10px;background:rgba(255,159,10,.14);font-size:13.5px}
.hs26 .mem{display:block}.hs26 .mem .t{color:var(--hs-text);white-space:pre-wrap;word-break:break-word}
.hs26 a{color:var(--hs-tint);text-decoration:none;font-weight:600}
.hs-pick{font:inherit;display:inline-flex;align-items:center;justify-content:flex-end;gap:6px;max-width:100%;min-width:0;border:0;background:transparent;color:var(--hs-tint);cursor:pointer;padding:6px 10px;margin:-2px -10px -2px 0;border-radius:12px;transition:background .2s,transform .12s}
.hs-pick:hover{background:var(--hs-fill)}.hs-pick:active{transform:scale(.97)}.hs-pick[disabled]{opacity:.45;cursor:default}
.hs-pick:focus-visible{outline:2px solid var(--hs-tint);outline-offset:1px}
.hs-pick .tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hs-pick .tx.ph{color:var(--hs-sub)}
.hs-pick svg{flex:0 0 auto;opacity:.75}
.hs26.hs-pop{position:fixed;display:flex;flex-direction:column;padding:6px;border-radius:22px;background:rgba(252,252,254,.74);backdrop-filter:blur(40px) saturate(190%);-webkit-backdrop-filter:blur(40px) saturate(190%);border:1px solid rgba(255,255,255,.55);box-shadow:0 22px 60px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.08),inset 0 1px 0 rgba(255,255,255,.7);animation:hsPop .2s cubic-bezier(.2,.9,.3,1.15);transform-origin:top right;z-index:2147483000;overflow:hidden}
.hs26.hs-pop:focus{outline:none}
.hs26.hs-pop.up{transform-origin:bottom right}
.hs26.hs-pop.dk{background:rgba(38,38,42,.76);border-color:rgba(255,255,255,.12);box-shadow:0 22px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08)}
.hs-pop-list{overflow-y:auto;overscroll-behavior:contain;flex:1 1 auto;min-height:0}
.hs-opt{display:flex;align-items:center;gap:8px;padding:9px 12px 9px 8px;border-radius:13px;cursor:pointer;color:var(--hs-text);transition:background .12s;user-select:none}
.hs-opt.act{background:var(--hs-fill)}.hs-opt:active{background:rgba(120,120,128,.3);transform:scale(.99)}
.hs-opt .ck{width:18px;color:var(--hs-tint);font-weight:700;text-align:center;flex:0 0 auto}
.hs-opt .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hs26 .mem .t.blur{filter:blur(6px);cursor:pointer;user-select:none}.hs-opt .osub{display:block;font-size:11px;color:var(--hs-sub);overflow:hidden;text-overflow:ellipsis}
.hs-opt.sel .tx{font-weight:600}.hs-opt.custom .tx{color:var(--hs-tint)}
.hs26.hs-pop .hs-pop-search{padding:2px 2px 6px}
.hs26.hs-pop .hs-pop-search input{width:100%;font:inherit;font-size:14px;border:0;outline:0;border-radius:12px;padding:8px 12px;background:var(--hs-fill);color:var(--hs-text);text-align:left}
.hs-pop-empty{padding:14px 12px;color:var(--hs-sub);font-size:13px;text-align:center}
.hs26 .keysrc{font-size:12px;color:var(--hs-sub);white-space:nowrap}
@keyframes hsPop{from{opacity:0;transform:scale(.94) translateY(-4px)}to{opacity:1;transform:none}}
@keyframes hsIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.hs26 *{animation:none!important;transition:none!important}}`;
    function useStyle() {
      useEffect(() => {
        if (document.getElementById("hs26-style")) return;
        const el = document.createElement("style");
        el.id = "hs26-style";
        el.textContent = CSS;
        document.head.appendChild(el);
      }, []);
    }

    const get = (obj, path) => path.reduce((v, k) => (v == null ? undefined : v[k]), obj);
    const fmtTime = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString("zh-CN", { hour12: false }); };
    // Hindsight stores a date-only "When" as UTC midnight; show the real turn time instead of "08:00".
    const utcMidnight = (v) => /T00:00:00(\.0\d{0,5})?(Z|\+00:00)$/.test(String(v || ""));
    const memTime = (m) => { const v = m.date || m.occurred_start || m.mentioned_at; return utcMidnight(v) && m.mentioned_at ? m.mentioned_at : v; };

    // ---- server channel ----
    // Exact owner-only route the plugin registers via connection.fetch.register; the page's
    // dsh browser session cookie authenticates it (same origin, document-relative like dsh's own RPC).
    function makeApi(doFetch) {
      const send = doFetch || ((u, i) => window.fetch(u, i));
      return async (endpoint, payload) => {
        const res = await send(ROUTE, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint, payload: payload || {} }) });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const r = await res.json();
        if (!r || !r.ok) throw new Error((r && r.error && r.error.message) || "rpc failed");
        return r.value;
      };
    }
    function useRpc(api, endpoint, payload, deps, pollMs) {
      const [state, setState] = useState({ loading: true });
      useEffect(() => {
        let alive = true;
        const run = () => api(endpoint, payload).then((value) => alive && setState({ value }), (e) => alive && setState({ error: String(e.message || e) }));
        run();
        const timer = pollMs ? setInterval(run, pollMs) : null;
        return () => { alive = false; if (timer) clearInterval(timer); };
      }, deps); // eslint-disable-line
      return state;
    }

    // ---- primitives ----
    const Group = (p) => h(React.Fragment, null, p.title ? h("div", { className: "hdr" }, p.title) : null, h("div", { className: "group glass" }, p.children), p.foot ? h("div", { className: "foot" }, p.foot) : null);
    const Row = (p) => h("div", { className: "row" }, h("span", { className: "lbl" }, p.label), h("div", { className: "val" }, p.children));
    const hostOf = (u) => { try { return new URL(u).host; } catch (_) { return ""; } };
    const Switch = (p) => h("button", { className: "sw", role: "switch", "aria-checked": !!p.value, "aria-label": p.label, onClick: () => p.onChange(!p.value) });
    const Seg = (p) => h("div", { className: "seg", role: "group", "aria-label": p.label }, p.options.map((o) => h("button", { key: o.value, "aria-pressed": p.value === o.value, onClick: () => p.onChange(o.value) }, o.label)));
    const Text = (p) => h("input", { type: p.type || "text", value: p.value == null ? "" : p.value, placeholder: p.placeholder, list: p.list, "aria-label": p.label, onChange: (e) => p.onChange(p.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value) });
    let ReactDOM = null;
    try { ReactDOM = require("react-dom"); } catch (_) { ReactDOM = null; }
    // dsh toggles body[data-ds-dark-theme] (ui-theme boot-theme.ts); the OS setting only applies
    // when dsh has not chosen (no data-ds-theme-source), e.g. outside the dsh shell.
    function isDark() {
      if (typeof document === "undefined" || !document.body) return false;
      if (document.body.hasAttribute("data-ds-dark-theme")) return true;
      if (document.documentElement.dataset && document.documentElement.dataset.dsThemeSource) return false;
      return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    function useDark() {
      const [d, setD] = useState(isDark);
      useEffect(() => {
        const up = () => setD(isDark());
        const mo = new MutationObserver(up);
        mo.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ds-theme-source"] });
        const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
        if (mq && mq.addEventListener) mq.addEventListener("change", up);
        return () => { mo.disconnect(); if (mq && mq.removeEventListener) mq.removeEventListener("change", up); };
      }, []);
      return d;
    }
    const Chevrons = () => h("svg", { width: 9, height: 14, viewBox: "0 0 9 14", "aria-hidden": true }, h("path", { d: "M1 5l3.5-3.5L8 5M1 9l3.5 3.5L8 9", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }));
    // iOS 26 pop-up button: a Liquid Glass menu rendered into document.body (portal, fixed
    // position) so no ancestor overflow/z-index/backdrop-filter can clip it.
    function Picker(p) {
      const [open, setOpen] = useState(false);
      const [q, setQ] = useState("");
      const [act, setAct] = useState(0);
      const [pos, setPos] = useState(null);
      const btn = useRef(null);
      const pop = useRef(null);
      const inp = useRef(null);
      const dark = useDark();
      const opts = (p.options || []).map((o) => typeof o === "string" ? { value: o, label: o || "—" } : o);
      const ql = q.trim().toLowerCase();
      const shown = ql ? opts.filter((o) => String(o.label).toLowerCase().indexOf(ql) >= 0 || String(o.value).toLowerCase().indexOf(ql) >= 0) : opts;
      const canCustom = p.custom && ql && !opts.some((o) => String(o.value).toLowerCase() === ql);
      const items = canCustom ? shown.concat([{ value: q.trim(), label: "使用「" + q.trim() + "」", custom: true }]) : shown;
      const curOpt = opts.find((o) => o.value === p.value);
      const place = () => {
        if (!btn.current) return;
        const r = btn.current.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = Math.min(Math.max(r.width + 20, p.minWidth || (p.search ? 300 : 220)), vw - 16);
        const left = Math.min(Math.max(8, r.right + 10 - w), vw - w - 8);
        const below = vh - r.bottom - 14, above = r.top - 14;
        const up = below < 240 && above > below;
        setPos({ left, width: w, top: up ? undefined : r.bottom + 6, bottom: up ? vh - r.top + 6 : undefined, maxHeight: Math.max(120, Math.min(380, up ? above : below)), up });
      };
      const show = () => { if (p.disabled) return; place(); setQ(""); setAct(Math.max(0, opts.findIndex((o) => o.value === p.value))); setOpen(true); if (p.onOpen) p.onOpen(); };
      const close = (focus) => { setOpen(false); if (focus && btn.current) btn.current.focus(); };
      const choose = (o) => { p.onChange(o.value); close(true); };
      useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if ((pop.current && pop.current.contains(e.target)) || (btn.current && btn.current.contains(e.target))) return; close(false); };
        const onMove = (e) => { if (pop.current && e && e.target && pop.current.contains(e.target)) return; place(); };
        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("touchstart", onDown, true);
        window.addEventListener("resize", onMove);
        window.addEventListener("scroll", onMove, true);
        const id = setTimeout(() => { const el = inp.current || pop.current; if (el) el.focus({ preventScroll: true }); }, 0);
        return () => { clearTimeout(id); document.removeEventListener("mousedown", onDown, true); document.removeEventListener("touchstart", onDown, true); window.removeEventListener("resize", onMove); window.removeEventListener("scroll", onMove, true); };
      }, [open]); // eslint-disable-line
      useEffect(() => { if (open && pop.current) { const el = pop.current.querySelector('[data-i="' + act + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); } }, [act, open]);
      const onKey = (e) => {
        if (!open) { if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); } return; }
        if (e.key === "ArrowDown") { e.preventDefault(); setAct((a) => Math.min(items.length - 1, a + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
        else if (e.key === "Home") { e.preventDefault(); setAct(0); }
        else if (e.key === "End") { e.preventDefault(); setAct(items.length - 1); }
        else if (e.key === "Enter") { e.preventDefault(); if (items[act]) choose(items[act]); else if (p.custom && q.trim()) choose({ value: q.trim() }); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.key === "Tab") close(false);
      };
      const label = curOpt ? curOpt.label : p.value ? String(p.value) : (p.placeholder || "—");
      const menu = open && pos ? h("div", { ref: pop, className: "hs26 hs-pop" + (dark ? " dk" : "") + (pos.up ? " up" : ""), role: "listbox", "aria-label": p.label, tabIndex: -1, onKeyDown: onKey, style: { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight } },
        p.search ? h("div", { className: "hs-pop-search" }, h("input", { ref: inp, type: "search", value: q, placeholder: p.searchPh || "搜索", "aria-label": p.label + " 搜索", autoComplete: "off", spellCheck: false, onChange: (e) => { setQ(e.target.value); setAct(0); } })) : null,
        h("div", { className: "hs-pop-list" },
          p.loading && !items.length ? h("div", { className: "hs-pop-empty" }, p.loadingText || "正在获取模型…") : null,
          items.map((o, i) => h("div", { key: (o.custom ? "c:" : "o:") + o.value, "data-i": i, role: "option", "aria-selected": o.value === p.value, className: "hs-opt" + (i === act ? " act" : "") + (o.value === p.value && !o.custom ? " sel" : "") + (o.custom ? " custom" : ""), onMouseEnter: () => setAct(i), onMouseDown: (e) => e.preventDefault(), onClick: () => choose(o) },
            h("span", { className: "ck" }, o.value === p.value && !o.custom ? "✓" : ""), o.sub ? h("span", { className: "tx", title: String(o.label) + " · " + o.sub }, o.label, h("span", { className: "osub" }, o.sub)) : h("span", { className: "tx", title: String(o.label) }, o.label))),
          !p.loading && !items.length ? h("div", { className: "hs-pop-empty" }, p.emptyText || "没有匹配的选项") : null)) : null;
      return h(React.Fragment, null,
        h("button", { ref: btn, type: "button", className: "hs-pick" + (open ? " open" : ""), "aria-haspopup": "listbox", "aria-expanded": open, "aria-label": p.label, disabled: p.disabled, onClick: () => (open ? close(false) : show()), onKeyDown: onKey },
          h("span", { className: "tx" + (curOpt || p.value ? "" : " ph") }, label), h(Chevrons)),
        menu ? (ReactDOM && ReactDOM.createPortal && typeof document !== "undefined" ? ReactDOM.createPortal(menu, document.body) : menu) : null);
    }
    const Select = (p) => h(Picker, p);

    // ---- key source + model list (shared by the advanced channels and the three-step page) ----
    // Only where a key comes from is shown, never the key.
    function keyText(t, info, chan) {
      if (!info) return t("keyUnset");
      if (info.source === "dsh") return t("keyUseDsh");
      if (info.set) return t("secretSet").replace("（", "（" + t("keySrc") + "：" + (info.sources || [info.source]).map((x) => t("src_" + x)).join(" + ") + "；");
      if (info.source === "shared") return t("shareKey");
      return t("keyUnset");
    }
    // Fetch ~0.5 s after the key/endpoint changes, with the key just typed (server side: no CORS).
    function useModels(api, { chan, preset, provider, baseUrl, keyDraft, hasKey, enabled }) {
      const [models, setModels] = useState({});
      const seq = useRef(0);
      const load = () => {
        if (!baseUrl) return;
        const n = ++seq.current;
        setModels((m) => ({ list: m.list, loading: true }));
        api("models", { channel: chan, preset, provider: provider || "", base_url: baseUrl, api_key: (keyDraft || "").trim() })
          .then((v) => n === seq.current && setModels({ list: v.models || [], note: v.note }), (e) => n === seq.current && setModels({ error: String(e.message || e) }));
      };
      useEffect(() => {
        if (enabled === false || !baseUrl || !((keyDraft || "").trim() || hasKey || /localhost|127\.0\.0\.1/.test(baseUrl))) return undefined;
        const timer = setTimeout(load, 500);
        return () => clearTimeout(timer);
      }, [keyDraft, baseUrl, preset, hasKey, enabled]); // eslint-disable-line
      return [models, load];
    }
    function ModelPicker(p) {
      const { t, chan, value, onChange, models } = p;
      const list = models.list || [];
      return h(Picker, { label: chan + " model", value: value || "", onChange, search: true, custom: true, searchPh: t("modelSearch"), placeholder: t("modelPick"), loading: !!models.loading, loadingText: t("modelsLoading"),
        options: (value && list.indexOf(value) < 0 ? [value] : []).concat(list).map((m) => ({ value: m, label: m })),
        emptyText: models.error ? models.error + "；" + t("modelsManual") : t("modelsNone") });
    }
    function ModelStatus(p) {
      const { t, models } = p;
      if (models.loading) return h("div", { className: "row sub", role: "status" }, t("modelsLoading"));
      if (models.error) return h("div", { className: "row sub", role: "alert", style: { color: "var(--hs-red)" } }, t("modelsErr") + "：" + models.error + "。" + t("modelsManual"));
      if (models.list) return h("div", { className: "row sub" }, models.list.length ? t("modelsCount").replace("{n}", models.list.length) : (models.note ? t("modelsNone") : t("modelsNone")));
      return null;
    }

    // ---- provider channel (preset -> base URL auto-fill, model list) ----
    function Channel(p) {
      const { t, api, chan, cur, set, keyInfo, presets, title, foot, extraTop } = p;
      const list = presets ? Object.keys(presets[chan] || {}) : [];
      const preset = cur([chan, "preset"]) || "";
      const baseUrl = cur([chan, "base_url"]) || "";
      const ownDraft = p.edits[chan + ".api_key"] ? p.edits[chan + ".api_key"].v : "";
      // A channel on the embedding host with no key of its own borrows the embedding key (as on save).
      const embDraft = chan !== "embedding" && hostOf(baseUrl) && hostOf(baseUrl) === hostOf(cur(["embedding", "base_url"])) && p.edits["embedding.api_key"] ? p.edits["embedding.api_key"].v : "";
      const keyDraft = ownDraft;
      const info = keyInfo ? keyInfo(chan) : null;
      const touched = useRef(false);
      const [models, load] = useModels(api, { chan, preset, provider: cur([chan, "provider"]), baseUrl, keyDraft: ownDraft || embDraft, hasKey: !!(info && (info.set || info.source === "shared" || info.source === "dsh")) });
      const pick = (name) => {
        set([chan, "preset"])(name);
        const pr = presets && presets[chan] && presets[chan][name];
        if (!pr) return;
        set([chan, "provider"])(pr.provider);
        // Auto-fill the URL unless the user typed their own one.
        if (!touched.current || !baseUrl) set([chan, "base_url"])(pr.base_url);
        if (pr.model) set([chan, "model"])(pr.model);
      };
      return h(Group, { title, foot },
        extraTop,
        h(Row, { label: t("preset") }, h(Picker, { label: chan + " preset", value: preset, onChange: pick, placeholder: "—", options: [{ value: "", label: "—" }].concat(list.map((n) => ({ value: n, label: PRESET_ZH[n] || n }))) })),
        h(Row, { label: t("provider") }, h(Text, { label: chan + " provider", value: cur([chan, "provider"]), onChange: set([chan, "provider"]) })),
        h(Row, { label: t("baseUrl") }, h(Text, { label: chan + " base_url", value: baseUrl, placeholder: "https://…", onChange: (v) => { touched.current = true; set([chan, "base_url"])(v); } })),
        h(Row, { label: t("apiKey") }, h(Text, { type: "password", label: chan + " api_key", value: keyDraft, placeholder: keyText(t, info, chan), onChange: set([chan, "api_key"]) })),
        h(Row, { label: t("model") },
          h(ModelPicker, { t, chan, value: cur([chan, "model"]), onChange: set([chan, "model"]), models }),
          h("button", { className: "btn ghost small", onClick: load, disabled: !baseUrl || models.loading, "aria-label": t("fetchModels") }, models.loading ? "…" : "↻")),
        h(ModelStatus, { t, models }),
        chan === "embedding" ? h(Row, { label: t("dim") }, h(Text, { type: "number", label: "embedding expected_dim", value: cur(["embedding", "expected_dim"]), placeholder: "1024", onChange: set(["embedding", "expected_dim"]) })) : null);
    }

    // ---- workspace mapping + manual retain ----
    function Workspaces(p) {
      const { t, api, mapping, setMapping, bankOptions, askNewBank } = p;
      const ws = useRpc(api, "workspaces", {}, []);
      const [sel, setSel] = useState({});
      const [job, setJob] = useState(null);
      const [ops, setOps] = useState(null);
      const [poll, setPoll] = useState(false);
      const [prompt, setPrompt] = useState(false);
      const [picker, setPicker] = useState(null);
      const [pick, setPick] = useState({});
      useEffect(() => { api("overview").then((o) => { setPrompt(!!o.importPrompt); setOps(o.ops || null); if (o.job) setJob(o.job); }, () => {}); }, []); // eslint-disable-line
      useEffect(() => {
        if (!poll) return;
        const timer = setInterval(() => api("overview").then((o) => { setJob(o.job); setOps(o.ops || null); if ((!o.job || !o.job.running) && !(o.ops && o.ops.processing)) setPoll(false); }, () => setPoll(false)), 1500);
        return () => clearInterval(timer);
      }, [poll]); // eslint-disable-line
      const list = (ws.value && ws.value.workspaces) || [];
      const known = new Set(list.map((w) => w.path));
      const manual = Object.keys(mapping).filter((k) => !known.has(k));
      const remote = p.remoteBanks || [];
      const usersOf = (bank) => list.filter((w) => w.bank === bank).map((w) => w.title || w.path.split(/[\\/]/).pop());
      const bankSel = (path, auto) => {
        const cur0 = mapping[path] || "";
        const opts = [{ value: "", label: t("ownAuto") + (auto ? " · " + auto : "") }];
        if (cur0 && !remote.includes(cur0)) opts.push({ value: cur0, label: t("ownBank") + " · " + cur0 });
        opts.push({ value: "__named", label: t("ownNamed") });
        remote.forEach((b) => { const u = usersOf(b); const nm = (p.remoteNames || {})[b]; opts.push({ value: b, label: t("joinBank") + " · " + (nm || b), sub: [nm ? b : "", u.length ? t("usedBy") + u.join("、") : ""].filter(Boolean).join(" · ") }); });
        return h(Select, { label: "bank for " + path, search: true, minWidth: 380, value: cur0, options: opts,
          onChange: (v) => { if (v === "__named") { const id = askNewBank(); if (id) setMapping(Object.assign({}, mapping, { [path]: id })); return; } const n = Object.assign({}, mapping); if (v) n[path] = v; else delete n[path]; setMapping(n); } });
      };
      const start = (filter) => { setPrompt(false); return api("retainNow", filter).then((r) => { setJob(r.job || r); setPoll(true); }, (e) => setJob({ error: String(e.message || e) })); };
      const chosen = Object.keys(sel).filter((k) => sel[k]);
      const picked = Object.keys(pick).filter((k) => pick[k]);
      const openPicker = () => { if (picker) { setPicker(null); return; } setPicker({ loading: true }); api("sessions", { workspace: chosen.length === 1 ? chosen[0] : "" }).then((r) => setPicker({ list: r.sessions || [] }), (e) => setPicker({ error: String(e.message || e) })); };
      const goImport = () => { const el = document.getElementById("hs-retain-now"); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" }); };
      const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
      return h(React.Fragment, null,
        prompt ? h("div", { className: "warnbox", role: "note" },
          h("div", { style: { fontWeight: 600, marginBottom: 4 } }, t("importQ")),
          h("div", { className: "sub", style: { marginBottom: 8 } }, t("importText")),
          h("div", { className: "row", style: { gap: 8 } },
            h("button", { className: "btn small", onClick: goImport }, t("importGo")),
            h("button", { className: "btn ghost small", onClick: () => { setPrompt(false); api("dismissImport", {}).catch(() => {}); } }, t("importNo")))) : null,
        h(Group, { title: t("ws"), foot: t("wsFoot") },
          ws.loading ? h("div", { className: "row sub" }, "…") : null,
          ws.value && !ws.value.available ? h("div", { className: "row sub" }, t("noWs")) : null,
          ws.error ? h("div", { className: "row sub" }, t("noRpc") + ": " + ws.error) : null,
          list.map((w) => h("div", { className: "row", key: w.path },
            h("button", { className: "chk", role: "checkbox", "aria-checked": !!sel[w.path], "aria-label": "select " + w.path, onClick: () => setSel(Object.assign({}, sel, { [w.path]: !sel[w.path] })) }, sel[w.path] ? "✓" : ""),
            h("div", { style: { flex: 1, minWidth: 0 } }, h("div", null, w.title || w.path.split(/[\\/]/).pop()), h("div", { className: "sub mono", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, w.path)),
            h("span", { className: "pill" }, w.sessions + " " + t("sessions")),
            w.archived ? h("span", { className: "pill", title: t("archivedN") }, w.archived + " " + t("archivedN")) : null,
            bankSel(w.path, w.autoBank))),
          manual.map((path, i) => h("div", { className: "row", key: "m" + i },
            h("input", { type: "text", style: { textAlign: "left" }, value: path, "aria-label": t("path"), placeholder: t("path"), onChange: (e) => { const n = {}; Object.keys(mapping).forEach((k) => { n[k === path ? e.target.value : k] = mapping[k]; }); setMapping(n); } }),
            bankSel(path),
            h("button", { className: "btn ghost small", onClick: () => { const n = Object.assign({}, mapping); delete n[path]; setMapping(n); } }, t("remove")))),
          h("div", { className: "row" }, h("button", { className: "btn ghost small", onClick: () => setMapping(Object.assign({}, mapping, { ["/path/" + (manual.length + 1)]: "" })) }, "+ " + t("addPath")))),
        h("div", { id: "hs-retain-now" }, h(Group, { title: t("retainNow"), foot: t("retainHint") },
          h("div", { className: "row", style: { flexWrap: "wrap", gap: 8 } },
            h("button", { className: "btn small", disabled: !chosen.length || (job && job.running), onClick: () => start({ workspaces: chosen }) }, t("retainSel") + (chosen.length ? " (" + chosen.length + ")" : "")),
            h("button", { className: "btn ghost small", onClick: openPicker }, picker ? t("pickHide") : t("pickOne")),
            h("button", { className: "btn ghost small", disabled: job && job.running, onClick: () => start({}) }, t("retainAll"))),
          picker ? (picker.loading ? h("div", { className: "row sub" }, "…") : picker.error ? h("div", { className: "row sub" }, picker.error) : !(picker.list || []).length ? h("div", { className: "row sub" }, t("noSessions")) :
            h(React.Fragment, null,
              picker.list.map((s) => h("div", { className: "row", key: s.id },
                h("button", { className: "chk", role: "checkbox", "aria-checked": !!pick[s.id], "aria-label": "select " + s.id, onClick: () => setPick(Object.assign({}, pick, { [s.id]: !pick[s.id] })) }, pick[s.id] ? "✓" : ""),
                h("div", { style: { flex: 1, minWidth: 0 } }, h("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, s.title || s.id), h("div", { className: "sub mono" }, fmtTime(s.createdAt) + " · " + (s.cwd || "").split(/[\\/]/).pop())),
                s.retained ? h("span", { className: "pill ok" }, t("recorded")) : null)),
              h("div", { className: "row" }, h("button", { className: "btn small", disabled: !picked.length || (job && job.running), onClick: () => start({ sessionIds: picked }) }, t("retainPicked") + (picked.length ? " (" + picked.length + ")" : ""))))) : null,
          job ? h(JobRow, { t, job, pct, ops }) : null)));
    }
    function JobRow(p) {
      const { t, job } = p;
      if (job.error && !job.kind) return h("div", { className: "row sub", style: { color: "var(--hs-red)" } }, job.error);
      if (job.reason && !job.kind) return h("div", { className: "row sub" }, job.reason);
      const ops = p.ops || null;
      // No import job this session: show Hindsight's own operation progress only.
      const opsOnly = (!job.kind || job.kind === "ops") && !job.running && !job.total;
      const opsTotal = ops ? (ops.completed || 0) + (ops.processing || 0) + (ops.failed || 0) : 0;
      const pct = opsOnly ? (opsTotal ? Math.round(((ops.completed || 0) / opsTotal) * 100) : 100)
        : job.total ? Math.round((job.done / job.total) * 100) : (job.running ? 0 : 100);
      // "完成" only when Hindsight finished every submitted operation; until then "已提交".
      const busy = job.running || (ops && ops.processing > 0);
      const label = job.running ? t("running") : ops && ops.failed ? t("opsFail") : busy ? t("submitted") : t("done");
      const cls = job.error || (ops && ops.failed) ? "bad" : busy ? "warn" : "ok";
      const parts = opsOnly ? [] : [t("submitted") + " " + (job.scanned || 0)];
      if (ops) parts.push(t("opsDone") + " " + (ops.completed || 0), t("opsProc") + " " + (ops.processing || 0), t("opsFail") + " " + ((ops.failed || 0) + (job.failed || 0)));
      if (!opsOnly) parts.push("↷" + (job.skipped || 0), "🗄" + (job.archived || 0));
      return h("div", { className: "row", style: { flexWrap: "wrap" } },
        h("span", { className: "pill " + cls }, label),
        h("div", { className: "bar", "aria-label": "progress" }, h("i", { style: { width: pct + "%" } })),
        h("span", { className: "sub", title: t("jobTip") }, (opsOnly ? "" : (job.done || 0) + "/" + (job.total || 0) + " · ") + parts.join(" · ")),
        job.current ? h("span", { className: "sub mono" }, job.current) : null,
        job.error ? h("span", { className: "sub", style: { color: "var(--hs-red)" } }, job.error) : null);
    }

    function OpsFailures(p) {
      const { t, api, ops } = p;
      const [msg, setMsg] = useState("");
      const retry = () => api("retryFailed", {}).then((r) => { setMsg(t("retrying").replace("{n}", r.retried || 0)); p.reload && p.reload(); }, (e) => setMsg(String(e.message || e)));
      return h(React.Fragment, null,
        h("div", { className: "row", style: { flexWrap: "wrap" } },
          h("span", { className: "pill bad" }, t("opsFail") + " " + ops.failed),
          h("span", { className: "sub" }, ops.reason || ""),
          h("button", { className: "btn small", onClick: retry }, t("retryFailed")),
          msg ? h("span", { className: "sub" }, msg) : null),
        (ops.failures || []).slice(0, 8).map((f) => h("div", { className: "row", key: f.id },
          h("span", { className: "sub" }, fmtTime(f.at)),
          h("div", { className: "val" }, h("span", { className: "mono" }, f.bank), h("span", { className: "pill bad" }, f.reason || ""), f.nextRetryAt ? h("span", { className: "sub" }, "↻ " + fmtTime(f.nextRetryAt)) : null))));
    }

    // "看看记住了什么": collapsed by default (counts only). Expanded it pages server-side
    // (10 at a time) so a bank with hundreds of memories stays fast; optional privacy blur.
    const PRIV_KEY = "dsh-hindsight.hideMemories";
    const loadPriv = () => { try { return window.localStorage.getItem(PRIV_KEY) === "1"; } catch (_) { return false; } };
    function Browse(p) {
      const { t, api, banks, bank, setBank } = p;
      const PAGE = 10;
      const [open, setOpen] = useState(false);
      const [q, setQ] = useState("");
      const [items, setItems] = useState([]);
      const [total, setTotal] = useState(0);
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState("");
      const [hide, setHide] = useState(loadPriv);
      const [shown, setShown] = useState({});
      const seq = useRef(0);
      const totalAll = banks.reduce((n, b) => n + ((b.stats && b.stats.total_nodes) || 0), 0);
      useEffect(() => {
        if (!open || bank || !banks.length) return;
        setBank(banks.some((b) => b.id === p.lastBank) ? p.lastBank : banks[0].id);
      }, [open, banks.length, p.lastBank]); // eslint-disable-line
      const load = (offset) => {
        const my = ++seq.current;
        setBusy(true); setErr("");
        return api("memories", { bank, q: q.trim(), limit: PAGE, offset }).then((v) => {
          if (my !== seq.current) return;
          setItems((prev) => offset ? prev.concat(v.items || []) : (v.items || []));
          setTotal(v.total || 0); setBusy(false);
        }, (e) => { if (my === seq.current) { setErr(String(e.message || e)); setBusy(false); } });
      };
      useEffect(() => {
        if (!open || !bank) return undefined;
        setItems([]); setShown({});
        const timer = setTimeout(() => load(0), q ? 300 : 0);
        return () => clearTimeout(timer);
      }, [open, bank, q]); // eslint-disable-line
      const togglePriv = () => { const v = !hide; setHide(v); setShown({}); try { window.localStorage.setItem(PRIV_KEY, v ? "1" : "0"); } catch (_) { /* storage off */ } };
      if (!open) return h(Group, { title: t("browse") },
        h("div", { className: "row" },
          h("span", { className: "sub" }, banks.length ? t("browseSum").replace("{n}", totalAll).replace("{b}", banks.length) : t("empty")),
          banks.length ? h("button", { className: "btn small", onClick: () => setOpen(true) }, t("browseOpen")) : null));
      return h(Group, { title: t("browse") },
        h(Row, { label: t("bank") }, h(Select, { label: "browse bank", value: bank, onChange: setBank, options: banks.map((b) => ({ value: b.id, label: bankLabel(b) + " · " + ((b.stats && b.stats.total_nodes) || 0) + " " + t("memories") })) })),
        h(Row, { label: "🔍" }, h("input", { type: "search", value: q, placeholder: t("search"), "aria-label": t("search"), onChange: (e) => setQ(e.target.value), style: { textAlign: "left" } })),
        h(Row, { label: t("hideMem") }, h(Switch, { value: hide, onChange: togglePriv, label: t("hideMem") })),
        err ? h("div", { className: "row sub", style: { color: "var(--hs-red)" } }, err) : null,
        items.map((m) => {
          const blur = hide && !shown[m.id];
          return h("div", { className: "row mem", key: m.id },
            h("div", { className: "sub" }, fmtTime(memTime(m)), m.fact_type ? " · " + m.fact_type : ""),
            h("div", { className: "t" + (blur ? " blur" : ""), title: blur ? t("tapShow") : undefined, onClick: blur ? () => setShown((s) => ({ ...s, [m.id]: true })) : undefined }, m.text));
        }),
        !busy && !err && !items.length ? h("div", { className: "row sub" }, t("empty")) : null,
        h("div", { className: "row" },
          h("span", { className: "sub" }, items.length ? t("shownOf").replace("{a}", items.length).replace("{b}", total) : ""),
          items.length < total ? h("button", { className: "btn small", disabled: busy, onClick: () => load(items.length) }, busy ? "…" : t("loadMore")) : busy ? h("span", { className: "sub" }, "…") : null,
          h("button", { className: "btn ghost small", onClick: () => setOpen(false) }, t("collapse"))));
    }

    // ---- status page ----
    function Status(p) {
      const { t, api } = p;
      const ov = useRpc(api, "overview", {}, [], 3000);
      const banks = useRpc(api, "banks", {}, []);
      const [bank, setBank] = useState("");
      const bl = (banks.value && banks.value.banks) || [];
      if (ov.error) return h(Group, { title: t("health") }, h("div", { className: "row sub" }, t("noRpc") + ": " + ov.error));
      const o = ov.value || {};
      const llm = o.llm || {};
      return h(React.Fragment, null,
        h(Group, { title: t("health") },
          h(Row, { label: t("state") }, o.setup === "unset" && !o.ready ? h("span", { className: "pill" }, "还没设置") : h("span", { className: "pill " + (o.ready ? "ok" : o.state === "starting" ? "warn" : "bad") }, STATE_ZH[o.state] || o.state || "…")),
          h(Row, { label: t("version") }, h("span", { className: "mono" }, (o.version && (o.version.api_version || o.version.version)) || "—")),
          h(Row, { label: t("baseUrl") }, h("span", { className: "mono" }, o.baseUrl || "")),
          o.localPlan ? h(Row, { label: t("deploy") }, (RUNNER_ZH[o.localPlan.runner] || o.localPlan.runner) + " · " + (VARIANT_ZH[o.localPlan.variant] || o.localPlan.variant)) : null,
          h(Row, { label: t("llm") }, h("span", { className: "pill " + (llm.fallback ? "warn" : "ok") }, ({ follow: "和 dsh 用同一个", custom: "自己指定", none: "不整理" })[llm.mode] || llm.mode || ""), h("span", { className: "mono" }, llm.effective || "")),
          o.controlPlaneUrl ? h(Row, { label: "官方管理后台" }, h("a", { href: o.controlPlaneUrl, target: "_blank", rel: "noreferrer" }, t("openCp") + " ↗")) : null,
          o.lastError ? h("div", { className: "row sub", style: { color: o.setup === "unset" && !o.ready ? undefined : "var(--hs-red)" } }, o.lastError) : null),
        o.setup === "local" || o.deploy && o.deploy.startedAt ? h(Deploy, { t, api, d: o.deploy || {}, refresh: ov.reload }) : null,
        llm.fallback ? h("div", { className: "warnbox" }, "⚠︎ " + t("llmFallback") + (llm.reason ? "（" + llm.reason + "）" : "")) : null,
        h(Group, { title: t("banks") },
          bl.length ? bl.map((b) => h("div", { className: "row", key: b.id, style: { cursor: "pointer" }, onClick: () => setBank(b.id) },
            h("span", { className: "lbl" }, b.name && b.name !== b.id ? h(React.Fragment, null, b.name, h("span", { className: "sub mono", style: { display: "block", fontSize: 11, opacity: .6 } }, b.id)) : h("span", { className: "mono" }, b.id)),
            h("div", { className: "val" }, h("span", { className: "pill" + (bank === b.id ? " ok" : "") }, ((b.stats && b.stats.total_nodes) || 0) + " " + t("memories")), h("span", { className: "pill" }, ((b.stats && b.stats.total_documents) || 0) + " " + t("docs")),
              b.stats && b.stats.pending_operations ? h("span", { className: "pill warn", title: t("pendingTip") }, "⏳" + b.stats.pending_operations) : null,
              b.stats && b.stats.failed_operations ? h("span", { className: "pill bad", title: t("failedTip") }, "✗" + b.stats.failed_operations) : null))) : h("div", { className: "row sub" }, banks.loading ? "…" : t("empty"))),
        o.gateway && o.gateway.down ? h("div", { className: "warnbox" }, "⚠︎ " + o.gateway.reason) : null,
        h(Group, { title: t("job") }, o.job ? h(JobRow, { t, job: o.job, ops: o.ops }) : o.ops && (o.ops.processing || o.ops.failed) ? h(JobRow, { t, job: { kind: "ops", running: false, done: 0, total: 0 }, ops: o.ops }) : h("div", { className: "row sub" }, t("empty")),
          o.ops && o.ops.failed ? h(OpsFailures, { t, api, ops: o.ops, reload: ov.reload }) : null),
        h(Group, { title: t("recent") }, (o.recent || []).length ? o.recent.map((r, i) => h("div", { className: "row", key: i }, h("span", { className: "sub" }, fmtTime(r.at)), h("div", { className: "val" }, h("span", { className: "mono" }, r.bank), h("span", { className: "pill" }, (r.turns || 0) + " turns")))) : h("div", { className: "row sub" }, t("empty"))),
        h(Group, { title: t("failures") }, (o.failures || []).length ? o.failures.map((r, i) => h("div", { className: "row", key: i }, h("span", { className: "sub" }, fmtTime(r.at)), h("div", { className: "val" }, h("span", { className: "mono" }, r.bank), h("span", { className: "pill bad", title: r.error }, String(r.error || "").slice(0, 60))))) : h("div", { className: "row sub" }, t("empty"))),
        h(Browse, { t, api, banks: bl, bank, setBank, lastBank: o.lastBank || "" }),
        h(Feedback, { t, api }));
    }
    const ISSUE_URL = "https://github.com/snakejohn/dsh-hindsight-local/issues/new?template=bug_report.yml";
    function Feedback(p) {
      const { t, api } = p;
      const [msg, setMsg] = useState("");
      const run = () => { setMsg("…"); api("exportLogs", { reveal: true }).then((r) => setMsg(t("exported") + r.file), (e) => setMsg(String(e.message || e))); };
      return h(Group, { title: t("feedback"), foot: t("feedbackFoot") },
        h("div", { className: "row", style: { gap: 8 } },
          h("button", { className: "btn small", onClick: run }, t("exportLogs")),
          h("a", { className: "btn ghost small", href: ISSUE_URL, target: "_blank", rel: "noreferrer" }, t("openIssue"))),
        msg ? h("div", { className: "row sub mono", style: { wordBreak: "break-all" } }, msg) : null);
    }

    // ---- local deployment card ----
    const ICON = { done: "✓", running: "◌", failed: "✗", pending: "·" };
    function Deploy(p) {
      const { t, api, d } = p;
      const [conn, setConn] = useState(null);
      const [busy, setBusy] = useState("");
      const env = useRpc(api, "dotenv", {}, [d.startedAt]).value;
      const act = (name) => () => { setBusy(name); api(name, {}).then((v) => { if (name === "checkConnection") setConn(v); }, (e) => setConn({ ok: false, error: String(e.message || e) })).then(() => { setBusy(""); p.refresh && p.refresh(); }); };
      const steps = d.steps || [];
      return h(Group, { title: t("deployTitle") },
        steps.map((s) => h("div", { className: "row step " + s.status, key: s.id },
          h("span", { className: "pill " + (s.status === "done" ? "ok" : s.status === "failed" ? "bad" : s.status === "running" ? "warn" : "") }, ICON[s.status] || "·"),
          h("span", { className: "lbl" }, t("step_" + s.id)),
          h("div", { className: "val sub", style: { whiteSpace: "normal", textAlign: "right" } }, s.detail || ""))),
        h(Row, { label: t("port") + " / " + t("pid") + " / " + t("mem") }, h("span", { className: "mono" }, (d.port || "—") + " · " + (d.pid || "—") + " · " + (d.memoryMb != null ? d.memoryMb + " MB" : "—"))),
        d.hint ? h("div", { className: "warnbox", style: { whiteSpace: "pre-wrap" } }, "⚠︎ " + t("hintT") + "：\n" + d.hint) : null,
        d.config ? h("div", { className: "row sub mono", style: { whiteSpace: "normal", fontSize: 12 } }, d.config) : null,
        (d.tail || []).length ? h("details", { className: "row", open: !!d.error }, h("summary", null, t("logTail") + " (" + d.tail.length + ")"), h("pre", { className: "logtail" }, d.tail.join("\n"))) : null,
        (d.installTail || []).length ? h("details", { className: "row" }, h("summary", null, t("installTail")), h("pre", { className: "logtail" }, d.installTail.join("\n"))) : null,
        h(Row, { label: t("logDir") }, h("span", { className: "mono" }, d.logDir || "~/.dsh-hindsight/logs")),
        env ? h("details", { className: "row" }, h("summary", null, t("envFile") + " · " + env.path), h("pre", { className: "logtail" }, Object.keys(env.env || {}).map((k) => k + "=" + env.env[k]).join("\n") || "(空)")) : null,
        conn ? h("div", { className: "row" }, h("span", { className: "pill " + (conn.ok ? "ok" : "bad") }, conn.ok ? t("connOk") : t("connBad")), h("span", { className: "sub" }, conn.error || conn.baseUrl || "")) : null,
        h("div", { className: "row", style: { gap: 8, justifyContent: "flex-end" } },
          h("button", { className: "btn ghost small", disabled: !!busy, onClick: act("checkConnection") }, busy === "checkConnection" ? "…" : t("checkConn")),
          h("button", { className: "btn ghost small", disabled: !!busy, onClick: act("restart") }, busy === "restart" ? "…" : t("restart")),
          h("button", { className: "btn small", disabled: !!busy, onClick: act("redeploy") }, busy === "redeploy" ? "…" : t("redeploy"))));
    }

    // ---- left-sidebar status indicator (slot sidebar.footer.action) ----
    // User-visible names for option ids (the id stays in parentheses for search/support).
    const RUNNER_ZH = { auto: "自动", venv: "Python 虚拟环境（venv）", uvx: "uv 临时运行（uvx）", docker: "Docker 容器" };
    const VARIANT_ZH = { auto: "自动", slim: "精简版（slim，用在线模型）", full: "完整版（full，含本机模型）" };
    const STATE_ZH = { ready: "正常运行（ready）", starting: "正在启动", degraded: "出问题了", failed: "启动失败", stopped: "已停止", idle: "未启动" };
    const PRESET_ZH = { siliconflow: "硅基流动（siliconflow）", openai: "OpenAI 或兼容接口（openai）", deepseek: "DeepSeek 深度求索", dashscope: "阿里云百炼（dashscope）", alibaba: "阿里云（alibaba）", openrouter: "OpenRouter", anthropic: "Anthropic Claude", gemini: "Google Gemini", groq: "Groq", jina: "Jina", voyage: "Voyage", cohere: "Cohere", zeroentropy: "ZeroEntropy", ollama: "Ollama（本机）", lmstudio: "LM Studio（本机）", tei: "自建 TEI 服务（tei）", local: "本机模型（local）", rrf: "不用模型（rrf）" };
    const LEVEL_COLOR = { green: "var(--hs-green)", yellow: "var(--hs-orange)", gray: "var(--hs-gray)", red: "var(--hs-red)" };
    function useSidebarStatus(api) {
      const [st, setSt] = useState(null);
      useEffect(() => {
        if (!api) return undefined;
        let alive = true, sig = "";
        const loop = async () => {
          while (alive) {
            try { const v = await api("sidebar", { since: sig, wait: !!sig }); if (!alive) return; sig = v.sig; setSt(v); }
            catch (_) { if (!alive) return; setSt((o) => o || { level: "red", text: "插件未连接", reason: "" }); await new Promise((r) => setTimeout(r, 5000)); }
          }
        };
        loop();
        return () => { alive = false; };
      }, [api]);
      return st;
    }
    const bankLabel = (b) => b.name && b.name !== b.id ? b.name + "（" + b.id + "）" : b.id;
    const ago = (iso) => { const ms = iso ? new Date(iso).getTime() : NaN; if (!isFinite(ms)) return "还没有"; const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? "刚刚" : s < 3600 ? Math.floor(s / 60) + " 分钟前" : s < 86400 ? Math.floor(s / 3600) + " 小时前" : s < 86400 * 30 ? Math.floor(s / 86400) + " 天前" : new Date(ms).toLocaleDateString("zh-CN"); };
    /** 侧栏显示状态卡片 (ui.sidebar_card, default on): follows the saved config live, no restart. */
    function sidebarCardOn(form) {
      const v = form && form.getSnapshot && (form.getSnapshot() || {}).value;
      return !(v && v.ui && v.ui.sidebar_card === false);
    }
    const NOOP_SUB = () => () => {};
    function SidebarStatus(p) {
      useStyle();
      const on = useSyncExternalStore(p.hsForm && p.hsForm.subscribe ? (l) => p.hsForm.subscribe(l) : NOOP_SUB, () => sidebarCardOn(p.hsForm), () => sidebarCardOn(p.hsForm));
      const st = useSidebarStatus(on ? p.hsApi : null);
      // Every hook runs before the early return: a hook after it changes the hook count when the
      // card is toggled and React (#300) kills the slot entry until the page reloads.
      const dkc = useDark() ? " dk" : "";
      if (!on) return null;
      const s = st || { level: "gray", text: "记忆服务…" };
      const color = LEVEL_COLOR[s.level] || LEVEL_COLOR.gray;
      // 还没设置：直接打开「设置」页（三步开始），不要落到一片红的状态页。
      const open = () => { const tab = s.setup ? "settings" : "status"; window.__hsOpenTab = tab; window.dispatchEvent(new CustomEvent("hs-open-tab", { detail: tab })); p.openPlugin && p.openPlugin(); };
      const tip = ["记忆服务：" + s.text, s.reason, s.bank ? "记忆库：" + (s.bankName ? s.bankName + "（" + s.bank + "）" : s.bank) : "", "等待记住：" + (s.pending || 0), "上次记住：" + ago(s.lastRetain), "上次回忆：" + ago(s.lastRecall)].filter(Boolean).join("\n");
      const dot = h("span", { className: "hs-dot" + (s.level === "yellow" ? " pulse" : ""), style: { background: color, boxShadow: "0 0 0 3px color-mix(in srgb, " + color + " 22%, transparent)" } });
      if (!p.wide) return h("button", { className: "hs26 hs-side mini glass" + dkc, title: tip, "aria-label": tip, onClick: open }, dot);
      const pr = s.progress;
      return h("button", { className: "hs26 hs-side glass" + dkc, title: tip, "aria-label": "记忆服务 " + s.text, onClick: open },
        h("div", { className: "hs-side-top" }, dot, h("span", { className: "hs-side-t" }, s.text), s.pending ? h("span", { className: "pill warn" }, s.pending + " 条待记住") : null),
        pr ? h("div", { className: "bar", style: { margin: "6px 0 2px" } }, h("i", { style: { width: Math.round(100 * pr.done / Math.max(1, pr.total)) + "%" } })) : null,
        s.reason ? h("div", { className: "hs-side-why", title: s.reason, style: { color: s.level === "red" ? "var(--hs-red)" : undefined } }, s.reason) : null,
        h("div", { className: "hs-side-sub" }, (s.bank ? (s.bankName || s.bank) + " · " : "") + "记住于 " + ago(s.lastRetain) + " · 回忆于 " + ago(s.lastRecall)));
    }

    // ---- 小白模式：选服务商 → 粘贴密钥（自动检测） → 一键开始 ----
    const Q = (p) => h("span", { className: "qm", title: p.tip, "aria-label": p.tip, tabIndex: 0 }, "?");
    function Simple(p) {
      const { t, api, form, isSecretSet, defaults, keyInfo } = p;
      const [key, setKey] = useState("");
      const D0 = defaults || {};
      const [embModel, setEmbModel] = useState("");
      const [rrModel, setRrModel] = useState("");
      const [llmKey, setLlmKey] = useState("");
      const dl = useRpc(api, "dshLlm", {}, []).value;
      const llmMode = p.llmMode || "follow";
      const [chk, setChk] = useState(null);
      const [busy, setBusy] = useState(false);
      const [started, setStarted] = useState(false);
      const [nonce, setNonce] = useState(0);
      const ov = useRpc(api, "overview", {}, [nonce], 3000).value;
      const embInfo = (ov && ov.keyState && ov.keyState.embedding) || (keyInfo ? keyInfo("embedding") : null);
      const hasSaved = !!(embInfo && embInfo.set);
      const sfBase = (D0.embedding && D0.embedding.base_url) || "https://api.siliconflow.cn/v1";
      const [embModels] = useModels(api, { chan: "embedding", preset: "siliconflow", provider: (D0.embedding && D0.embedding.provider) || "openai", baseUrl: sfBase, keyDraft: key, hasKey: hasSaved });
      const [rrModels] = useModels(api, { chan: "reranker", preset: "siliconflow", provider: "siliconflow", baseUrl: (D0.reranker && D0.reranker.base_url) || sfBase, keyDraft: key, hasKey: hasSaved });
      const check = (k) => { setChk({ checking: true }); api("checkKey", { api_key: k }).then(setChk, (e) => setChk({ ok: false, what: "检查时出错", how: "点「重试」再试一次。", detail: String(e.message || e) })); };
      useEffect(() => { if (!key.trim()) { setChk(null); return; } const id = setTimeout(() => check(key), 700); return () => clearTimeout(id); }, [key]);
      async function go() {
        setBusy(true);
        const D = defaults || {};
        const ops = [{ op: "set", path: ["setup"], value: "local" }];
        if (llmKey.trim() && dl && dl.llm) { ops.push({ op: "set", path: ["llm", "mode"], value: "custom" }, { op: "set", path: ["llm", "preset"], value: "" }, { op: "set", path: ["llm", "provider"], value: dl.llm.provider || "openai" }, { op: "set", path: ["llm", "base_url"], value: dl.llm.base_url || "" }, { op: "set", path: ["llm", "model"], value: dl.llm.model || "" }, { op: "set", path: ["llm", "api_key"], value: llmKey.trim() }); }
        for (const c of ["embedding", "reranker"]) for (const f of ["preset", "provider", "base_url", "model"]) if (D[c] && D[c][f]) ops.push({ op: "set", path: [c, f], value: D[c][f] });
        if (embModel) ops.push({ op: "set", path: ["embedding", "model"], value: embModel });
        if (rrModel) ops.push({ op: "set", path: ["reranker", "model"], value: rrModel });
        if (key.trim()) ops.push({ op: "set", path: ["embedding", "api_key"], value: key.trim() });
        const ok = await mutateKeys(form, api, ops);
        setBusy(false);
        if (ok) { setStarted(true); setKey(""); setLlmKey(""); setNonce(nonce + 1); }
        else setChk({ ok: false, what: "设置没有保存成功", how: "再点一次「一键开始」；还不行就重启 dsh。" });
      }
      const retry = () => { api("redeploy", {}).then(() => setNonce(nonce + 1)); };
      const d = (ov && ov.deploy) || {};
      const steps = d.steps || [];
      const ready = ov && ov.ready;
      const failed = ov && !ready && (d.error || ov.lastError) && ov.setup === "local";
      const canGo = (key.trim() ? chk && chk.ok : hasSaved) && !busy;
      return h("div", null,
        h("div", { className: "hdr" }, t("sTitle")),
        h("div", { className: "group glass simple" },
          h("div", { className: "row" }, h("span", { className: "lbl" }, t("s1")), h("div", { className: "val" }, h("span", { className: "pill ok" }, t("sfName")))),
          h("div", { className: "row col" },
            h("span", { className: "lbl" }, t("s2"), " ", h(Q, { tip: t("s2help") })),
            h("input", { type: "password", value: key, placeholder: hasSaved ? t("keySaved") : t("keyPh"), "aria-label": t("s2"), onChange: (e) => setKey(e.target.value), autoComplete: "off" }),
            h("div", { className: "keysrc", "data-testid": "key-state" }, hasSaved ? keyText(t, embInfo, "embedding") : t("keyUnset")),
            h("div", { className: "sub" }, t("s2help")),
            chk ? (chk.checking ? h("div", { className: "sub" }, t("keyChecking"))
              : chk.ok ? h("div", { className: "okbox" }, t("keyOk") + (chk.balance != null ? "（余额 ¥" + chk.balance + "）" : ""))
              : h(Guide, { t, what: chk.what, how: chk.how, onRetry: () => check(key) })) : null),
          (key.trim() || hasSaved) ? h(React.Fragment, null,
            h("div", { className: "row" }, h("span", { className: "lbl" }, t("emb")), h("div", { className: "val" }, h(ModelPicker, { t, chan: "embedding", value: embModel || (D0.embedding && D0.embedding.model) || "", onChange: setEmbModel, models: embModels }))),
            h("div", { className: "row" }, h("span", { className: "lbl" }, t("rr")), h("div", { className: "val" }, h(ModelPicker, { t, chan: "reranker", value: rrModel || (D0.reranker && D0.reranker.model) || "", onChange: setRrModel, models: rrModels }))),
            h(ModelStatus, { t, models: embModels.loading || embModels.error ? embModels : rrModels.loading || rrModels.error ? rrModels : embModels })) : null,
          llmMode === "follow" ? h("div", { className: "row col" },
            h("span", { className: "lbl" }, t("sLlm"), " ", h(Q, { tip: t("sLlmTip") })),
            !dl ? h("div", { className: "sub" }, t("loading"))
              : dl.ok ? h("div", { className: "okbox" }, t("sLlmOk") + (dl.llm ? "：" + dl.llm.model : "") + " · " + t("keyUseDsh"))
              : h(React.Fragment, null,
                h("div", { className: "sub" }, t("sLlmNeed").replace("{m}", dl.llm ? dl.llm.model + "（" + (hostOf(dl.llm.base_url) || dl.llm.provider) + "）" : "dsh 默认模型")),
                h("input", { type: "password", value: llmKey, placeholder: t("sLlmPh"), "aria-label": t("sLlm"), onChange: (e) => setLlmKey(e.target.value), autoComplete: "off" }))) : null,
          h("div", { className: "row" }, h("span", { className: "lbl" }, t("s3")),
            h("button", { className: "btn", disabled: !canGo, onClick: go }, busy ? "…" : ready && !key ? "✓ " + t("connOk") : t("go")))),
        (started || (ov && ov.setup === "local")) && !ready && !failed ? h("div", { className: "group glass" },
          h("div", { className: "row col" }, h("div", null, t("going")),
            h("div", { className: "bar" }, h("i", { style: { width: Math.round(100 * steps.filter((x) => x.status === "done").length / Math.max(1, steps.length)) + "%" } })),
            h("div", { className: "sub" }, (steps.find((x) => x.status === "running") || {}).detail || ""))) : null,
        failed ? h(Guide, { t, what: d.error || ov.lastError, how: d.hint || "点「重试」。如果反复失败，把「高级设置 → 运行记录」截图发给我们。", onRetry: retry }) : null);
    }
    function Guide(p) {
      return h("div", { className: "warnbox guide" },
        h("div", null, h("b", null, p.t("whatHappened") + "："), String(p.what || "").split("\n")[0]),
        h("div", { style: { whiteSpace: "pre-wrap" } }, h("b", null, p.t("howFix") + "："), p.how || ""),
        p.onRetry ? h("button", { className: "btn small", style: { marginTop: 8 }, onClick: p.onRetry }, p.t("retry")) : null);
    }

    // ---- settings ----
    // API keys are never written into dsh's plugin config (cordis.patch.yml): they go to the
    // plugin .env through the saveKeys RPC, and any key left in the config is unset.
    const KEY_PATHS = [["embedding", "api_key"], ["reranker", "api_key"], ["llm", "api_key"], ["service", "api_key"]];
    // Unset only inside sections the saved config already has: unsetting under a missing section
    // would make dsh write that section's defaults into cordis.patch.yml. (Secrets are redacted
    // from the snapshot, so presence of the key itself cannot be checked.)
    const keyUnsets = (form) => { const sn = form.getSnapshot() || {}; const u = (sn.user && typeof sn.user === "object") ? sn.user : (sn.value || {}); return KEY_PATHS.filter(([a]) => u[a] && typeof u[a] === "object").map((path) => ({ op: "unset", path })); };
    async function mutateKeys(form, api, ops) {
      const isKey = (o) => o.path[o.path.length - 1] === "api_key";
      const keys = {};
      for (const o of ops) if (o.op === "set" && isKey(o) && typeof o.value === "string" && o.value.trim()) keys[o.path.join(".")] = o.value.trim();
      if (Object.keys(keys).length) {
        const r = await api("saveKeys", { keys }).catch(() => null);
        if (!r || !r.ok) return false;
      }
      let rest = ops.filter((o) => !isKey(o)).concat(keyUnsets(form));
      // Config is fully volatile: form.mutate replaces the whole user overlay. Re-assert a
      // completed setup choice so a settings save never drops the user back to 「需要设置」.
      const sn = form.getSnapshot() || {};
      const u = (sn.user && typeof sn.user === "object") ? sn.user : (sn.value || {});
      const setupNow = u.setup;
      if ((setupNow === "local" || setupNow === "existing") && !rest.some((o) => o.op === "set" && o.path && o.path[0] === "setup")) {
        rest = [{ op: "set", path: ["setup"], value: setupNow }].concat(rest);
      }
      if (!rest.length) return true;
      return form.mutate(rest);
    }
    function Settings(p) {
      const { t, api, form } = p;
      const snap = useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form), form.getSnapshot.bind(form));
      const [edits, setEdits] = useState({});
      const [wizard, setWizard] = useState(false);
      const [msg, setMsg] = useState("");
      const presets = useRpc(api, "presets", {}, []).value;
      const banksR = useRpc(api, "banks", {}, []);
      const dshLlm = useRpc(api, "dshLlm", {}, []);
      // The redacted settings snapshot hides secrets; overview reports which keys are saved (booleans only).
      const ovS = useRpc(api, "overview", {}, [], 5000).value;
      // Keys saved by older versions: once the server has copied them into .env, strip them from dsh's config.
      const keysInPatch = !!(ovS && ovS.keysInPatch);
      useEffect(() => { const u = keysInPatch ? keyUnsets(form) : []; if (u.length) Promise.resolve(form.mutate(u)).catch(() => {}); }, [keysInPatch]); // eslint-disable-line
      // Server may have healed setup from .env / local install evidence while the volatile
      // overlay still shows unset — write it back so the next save cannot lose it again.
      useEffect(() => {
        const healed = ovS && (ovS.setup === "local" || ovS.setup === "existing") ? ovS.setup : "";
        if (!healed) return;
        const sn = form.getSnapshot() || {};
        const u = (sn.user && typeof sn.user === "object") ? sn.user : (sn.value || {});
        if (u.setup === healed) return;
        if (u.setup && u.setup !== "unset") return;
        Promise.resolve(form.mutate([{ op: "set", path: ["setup"], value: healed }])).catch(() => {});
      }, [ovS && ovS.setup]); // eslint-disable-line
      const [extraBanks, setExtraBanks] = useState([]);
      if (snap.status === "loading") return h("p", null, t("loading"));
      if (snap.status !== "ready") return h("p", null, t("unavailable"));
      const value = snap.value || {};
      const key = (path) => path.join(".");
      const defaults = (presets && presets.defaults) || {};
      // Channel fields fall back to the plugin's built-in defaults (SiliconFlow) as pre-filled values.
      const cur = (path) => { if (key(path) in edits) return edits[key(path)].v; const v = get(value, path); return (v === undefined || v === "") && path.length === 2 && defaults[path[0]] && path[1] !== "api_key" ? defaults[path[0]][path[1]] : v; };
      const set = (path) => (v) => setEdits((e) => Object.assign({}, e, { [key(path)]: { path, v } }));
      // Each key field is judged on its own, from the plugin's own sources only (see lib/keystate.js):
      // a follow-dsh LLM or a reranker borrowing the embedding key is not "已设置".
      const keyInfo = (chan) => (ovS && ovS.keyState && ovS.keyState[chan]) || { set: false, source: "" };
      const isSecretSet = (path) => { if (path[path.length - 1] !== "api_key") return false; if (path[0] === "service") { const v = get(value, path); return typeof v === "string" && v.trim() !== "" && !/^(undefined|null)$/i.test(v.trim()); } return !!keyInfo(path[0]).set; };
      const clearKeys = async () => {
        if (!window.confirm(t("clearKeysAsk"))) return;
        const u = keyUnsets(form); const ok = u.length ? await form.mutate(u) : true;
        await api("clearKeys", {}).catch(() => null);
        setEdits((e) => { const n = Object.assign({}, e); delete n["embedding.api_key"]; delete n["reranker.api_key"]; delete n["llm.api_key"]; return n; });
        setMsg(ok ? t("clearKeysDone") : t("failed"));
      };
      async function save() {
        const ops = Object.values(edits).filter((e) => e.v !== undefined && !(e.v === "" && /api_key$/.test(e.path[e.path.length - 1]))).map((e) => ({ op: "set", path: e.path, value: e.v }));
        const ok = await mutateKeys(form, api, ops);
        setMsg(ok ? t("saved") : t("failed"));
        if (ok) { setEdits({}); setWizard(false); }
      }
      const setupRaw = cur(["setup"]) || "unset";
      const setup = setupRaw === "unset" ? "local" : setupRaw;
      if (wizard) {
        const pick = (choice) => () => { set(["setup"])(choice); setWizard(false); };
        return h("div", null,
          h("div", { className: "hdr" }, t("choose")),
          h("div", { className: "card glass", role: "button", onClick: pick("existing") }, h("div", { style: { fontSize: 17, fontWeight: 600 } }, "☁︎ " + t("existing")), h("div", { className: "sub" }, t("existingHint"))),
          h("div", { className: "card glass", role: "button", onClick: pick("local") }, h("div", { style: { fontSize: 17, fontWeight: 600 } }, "⌂ " + t("local")), h("div", { className: "sub" }, t("localHint"))));
      }
      const remoteList = (banksR.value && banksR.value.banks) || [];
      const remoteBanks = remoteList.map((b) => b.id);
      const remoteNames = {}; remoteList.forEach((b) => { if (b.name && b.name !== b.id) remoteNames[b.id] = b.name; });
      const allBanks = Array.from(new Set(remoteBanks.concat(extraBanks).concat(Object.values(cur(["bank", "workspace_bank_mapping"]) || {})).filter(Boolean)));
      const bankOptions = () => allBanks.map((b) => ({ value: b, label: b + (remoteBanks.includes(b) ? "" : " ✦") }));
      const askNewBank = () => { const id = (window.prompt(t("newBankPrompt")) || "").trim().slice(0, 60); if (id) setExtraBanks(extraBanks.concat([id])); return id; };
      const mapping = cur(["bank", "workspace_bank_mapping"]) || {};
      const llmMode = cur(["llm", "mode"]) || "follow";
      const dl = dshLlm.value;
      const llmTop = h(React.Fragment, null,
        h(Row, { label: "" }, h(Seg, { label: "llm mode", value: llmMode, onChange: set(["llm", "mode"]), options: [{ value: "follow", label: t("follow") }, { value: "custom", label: t("custom") }, { value: "none", label: t("none") }] })));
      const chanProps = { t, api, cur, set, isSecretSet, keyInfo, presets, edits };
      // Picking "local" in the wizard is saved by 一键开始 itself; only advanced edits need the save bar.
      const dirty = Object.keys(edits).filter((k) => !(k === "setup" && setup === "local")).length > 0;
      return h("div", null,
        setup === "local" ? h(Simple, { t, api, form, isSecretSet, keyInfo, defaults, llmMode, presets }) : null,
        h("details", { className: "adv", open: setup !== "local" },
        h("summary", null, t("advanced")),
        h(Group, { title: setup === "existing" ? t("conn") : t("deploy") },
          h(Row, { label: setup === "existing" ? "☁︎ " + t("existing") : "⌂ " + t("local") }, h("button", { className: "btn ghost small", onClick: () => setWizard(true) }, t("rechoose"))),
          setup === "existing" ? h(React.Fragment, null,
            h(Row, { label: t("baseUrl") }, h(Text, { label: "service base_url", value: cur(["service", "base_url"]), placeholder: "http://127.0.0.1:8888", onChange: set(["service", "base_url"]) })),
            h(Row, { label: t("apiKey") }, h(Text, { type: "password", label: "service api_key", value: edits["service.api_key"] ? edits["service.api_key"].v : "", placeholder: isSecretSet(["service", "api_key"]) ? t("secretSet") : "", onChange: set(["service", "api_key"]) })),
            h(Row, { label: t("apiPrefix") }, h(Text, { label: "api_prefix", value: cur(["service", "api_prefix"]), placeholder: "/v1/default", onChange: set(["service", "api_prefix"]) })))
          : h(React.Fragment, null,
            h(Row, { label: t("runner") }, h(Seg, { label: "runner", value: cur(["service", "local", "runner"]) || "auto", onChange: set(["service", "local", "runner"]), options: ["auto", "venv", "uvx", "docker"].map((v) => ({ value: v, label: RUNNER_ZH[v] || v })) })),
            h(Row, { label: t("variant") }, h(Seg, { label: "variant", value: cur(["service", "local", "variant"]) || "auto", onChange: set(["service", "local", "variant"]), options: ["auto", "slim", "full"].map((v) => ({ value: v, label: VARIANT_ZH[v] || v })) })),
            h(Row, { label: t("port") }, h(Text, { type: "number", label: "port", value: cur(["service", "local", "port"]), placeholder: "8888", onChange: set(["service", "local", "port"]) })),
            h(Row, { label: h("span", { title: t("concHint") }, t("conc") + " ⓘ") }, h(Seg, { label: "concurrency", value: String(cur(["service", "local", "concurrency"]) || 1), onChange: (v) => set(["service", "local", "concurrency"])(Number(v)), options: ["1", "2", "3", "4"].map((v) => ({ value: v, label: v })) })),
            h(Row, { label: h("span", { title: t("dataDirHint") }, t("dataDir") + " ⓘ") }, h(Text, { label: "data_dir", value: cur(["service", "local", "data_dir"]), placeholder: t("dataDirPh"), onChange: set(["service", "local", "data_dir"]) })),
            h(Row, { label: t("cp") }, h(Switch, { label: "control plane", value: cur(["service", "local", "control_plane", "enabled"]) === true, onChange: set(["service", "local", "control_plane", "enabled"]) })),
            h(Row, { label: t("proxy") }, h(Seg, { label: "proxy", value: cur(["service", "proxy", "mode"]) || "auto", onChange: set(["service", "proxy", "mode"]), options: [{ value: "auto", label: t("proxyAuto") }, { value: "off", label: t("proxyOff") }, { value: "custom", label: t("proxyCustom") }] })),
            (cur(["service", "proxy", "mode"]) || "auto") === "custom" ? h(Row, { label: t("proxy") + " URL" }, h(Text, { label: "proxy url", value: cur(["service", "proxy", "url"]), placeholder: "http://127.0.0.1:7890", onChange: set(["service", "proxy", "url"]) })) : null,
            h(Row, { label: t("clearKeys") }, h("button", { className: "btn ghost small", onClick: clearKeys }, t("clearKeys"))))),
        setup === "local" ? h("div", { className: "foot" }, t("proxyFoot")) : null,
        setup === "local" ? h("div", { className: "foot" }, t("localHint") + " " + t("cpHint")) : null,
        setup === "local" ? h(Channel, Object.assign({ chan: "embedding", title: t("emb"), foot: t("embFoot") + " " + t("dimFoot") }, chanProps)) : null,
        setup === "local" ? h(Channel, Object.assign({ chan: "reranker", title: t("rr"), foot: t("rrFoot") }, chanProps)) : null,
        llmMode === "custom" && setup === "local" ? h(Channel, Object.assign({ chan: "llm", title: t("llm"), extraTop: llmTop }, chanProps))
          : h(Group, { title: t("llm"), foot: llmMode === "none" ? t("noneFoot") : setup !== "local" ? t("followOnlyLocal") : null },
            llmTop,
            llmMode === "follow" && dl ? h(React.Fragment, null,
              h(Row, { label: t("followOk") }, h("span", { className: "mono" }, dl.llm ? dl.llm.provider + " · " + dl.llm.model : "—")),
              dl.llm ? h(Row, { label: t("baseUrl") }, h("span", { className: "mono" }, dl.llm.base_url)) : null,
              h(Row, { label: t("followInfo") }, h("span", { className: "pill " + (dl.ok ? "ok" : "warn") }, dl.ok ? (dl.keyRef + " · " + dl.keySource) : (dl.keyRef || "—")))) : null,
            llmMode === "follow" && dl && !dl.ok ? h("div", { className: "row sub", style: { color: "var(--hs-orange)" } }, t("followNoKey") + (dl.reason ? "（" + dl.reason + "）" : "")) : null),
        h(Group, { title: t("bank") },
          null),
        h(Workspaces, { t, api, mapping, setMapping: set(["bank", "workspace_bank_mapping"]), bankOptions, askNewBank, remoteBanks, remoteNames }),
        h(Group, { title: t("rcTitle"), foot: t("rcFoot") },
          [["include_user", true, "rcUser", "rcUserH"], ["retain_assistant", true, "rcAsst", "rcAsstH"], ["include_tool_calls", false, "rcTool", "rcToolH"],
            ["include_reasoning", false, "rcReason", "rcReasonH"], ["include_system", false, "rcSys", "rcSysH"], ["include_archived", false, "rcArch", "rcArchH"], ["include_subagents", false, "rcSub", "rcSubH"]].map(([k, def, lk, hk]) => {
            const v = cur(["retain", k]); const on = v === undefined ? def : !!v;
            return h(React.Fragment, { key: k },
              h("div", { className: "row" }, h("span", { className: "lbl" }, t(lk), h("span", { className: "sub", style: { display: "block", fontSize: 11.5, marginTop: 2 } }, t(hk))), h("div", { className: "val" }, h(Switch, { label: t(lk), value: on, onChange: set(["retain", k]) }))),
              k === "include_tool_calls" && on ? h(Row, { label: t("rcToolMax") }, h(Text, { type: "number", label: "max_tool_chars", value: cur(["retain", "max_tool_chars"]), placeholder: "400", onChange: set(["retain", "max_tool_chars"]) })) : null);
          }),
          h("div", { className: "row" }, h("span", { className: "lbl" }, t("rcMin"), h("span", { className: "sub", style: { display: "block", fontSize: 11.5, marginTop: 2 } }, t("rcMinH"))), h("div", { className: "val" }, h(Text, { type: "number", label: "min_turn_chars", value: cur(["retain", "min_turn_chars"]), placeholder: "24", onChange: set(["retain", "min_turn_chars"]) }))),
          h("div", { className: "row" }, h("span", { className: "lbl" }, t("rcInj"), h("span", { className: "sub", style: { display: "block", fontSize: 11.5, marginTop: 2 } }, t("rcInjH"))), h("div", { className: "val" }, h("span", { className: "pill" }, t("rcAlwaysOff"))))),
        h(Group, { title: t("other") },
          h("div", { className: "row" }, h("span", { className: "lbl" }, t("sideCard"), h("span", { className: "sub", style: { display: "block", fontSize: 11.5, marginTop: 2 } }, t("sideCardH"))), h("div", { className: "val" }, h(Switch, { label: t("sideCard"), value: cur(["ui", "sidebar_card"]) !== false, onChange: set(["ui", "sidebar_card"]) }))),
          h(Row, { label: t("recall") }, h(Switch, { label: "recall", value: cur(["recall", "enabled"]) !== false, onChange: set(["recall", "enabled"]) })),
          h(Row, { label: t("topN") }, h(Text, { type: "number", label: "top_n", value: cur(["recall", "top_n"]), onChange: set(["recall", "top_n"]) })),
          h(Row, { label: t("retain") }, h(Switch, { label: "retain", value: cur(["retain", "enabled"]) !== false, onChange: set(["retain", "enabled"]) })),
          h(Row, { label: t("backfill") }, h(Switch, { label: "backfill", value: cur(["backfill", "enabled"]) !== false, onChange: set(["backfill", "enabled"]) })),
          h(Row, { label: t("timezone") }, h(Text, { label: "timezone", value: cur(["time", "timezone"]), placeholder: "Asia/Shanghai", onChange: set(["time", "timezone"]) })))),
        dirty ? h("div", { style: { height: 84 }, "aria-hidden": true }) : null,
        dirty ? h("div", { className: "savebar glass" }, h("span", { className: "sub" }, msg || (dirty ? t("unsaved") : "")), h("button", { className: "btn", onClick: save, disabled: !dirty }, t("save"))) : null);
    }

    function Panel(props) {
      useStyle();
      const dark = useDark();
      const t = props.t || ((k) => zh[k] || k);
      const [tab, setTab] = useState(() => { const w = typeof window !== "undefined" && window.__hsOpenTab; if (w) window.__hsOpenTab = ""; return w || "settings"; });
      useEffect(() => { const on = (e) => setTab(e.detail || "status"); window.addEventListener("hs-open-tab", on); return () => window.removeEventListener("hs-open-tab", on); }, []);
      if (props.view === "summary") return t("summary");
      const api = props.hsApi || makeApi(null);
      return h("div", { className: "hs26" + (dark ? " dk" : "") },
        h("div", { className: "tabs" }, h(Seg, { label: "tabs", value: tab, onChange: setTab, options: [{ value: "settings", label: t("tabSettings") }, { value: "status", label: t("tabStatus") }] })),
        tab === "settings" ? h(Settings, { t, api, form: props.hsForm }) : h(Status, { t, api }));
    }

    function Activation(props) {
      const dkA = useDark();
      useStyle();
      const t = props.t || ((k) => zh[k] || k);
      return h("div", { className: "hs26" + (dkA ? " dk" : "") }, h("div", { className: "card glass" }, h("p", null, t("activation")),
        h("div", { style: { display: "flex", gap: 10 } }, h("button", { className: "btn small", onClick: props.onOpenDetails }, t("openDetails")), h("button", { className: "btn ghost small", onClick: props.onDismiss }, t("later")))));
    }

    /**
     * Legacy bank.default_bank: the server already routes by the explicit mapping it migrated
     * into (lib/bankmigrate.js). Persist that mapping into dsh's config and unset default_bank,
     * once, as soon as the settings form is ready. Idempotent: nothing to do once it is gone.
     */
    function migrateLegacyBank(form, api) {
      if (!form || !form.subscribe || !form.getSnapshot) return () => {};
      let busy = false, done = false;
      const check = () => {
        if (busy || done) return;
        const sn = form.getSnapshot() || {};
        if (sn.status !== "ready") return;
        const legacy = get(sn.value || {}, ["bank", "default_bank"]);
        if (!legacy) { done = true; return; }
        busy = true;
        Promise.resolve(api("bankMigration", {})).then((m) => {
          if (!m || !m.pending || !m.complete) return false;
          return form.mutate([{ op: "set", path: ["bank", "workspace_bank_mapping"], value: m.mapping || {} }, { op: "unset", path: ["bank", "default_bank"] }]);
        }).then((ok) => { if (ok) done = true; }, () => {}).finally(() => { busy = false; });
      };
      const off = form.subscribe(check);
      check();
      return () => { done = true; if (typeof off === "function") off(); };
    }
    const inject = ["slots", "locale", "configForms"];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-hindsight: dictionaries");
      const form = ctx.configForms.get(NS_FORM);
      ctx.effect(() => () => { try { form.dispose && form.dispose(); } catch (_) {} }, "dsh-hindsight: form");
      const hsApi = makeApi(null);
      ctx.effect(() => migrateLegacyBank(form, hsApi), "dsh-hindsight: default_bank migration");
      ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
        name: "plugins.bundle.config", key: PKG, locale: NS, inject: () => ({ hsForm: form, hsApi })
      }, Panel));
      // Left-sidebar indicator: the sidebar foot's documented `sidebar.footer.action` list.
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action", id: "dsh-hindsight.status", order: 50, label: "Hindsight",
        inject: () => ({ hsApi, hsForm: form, openPlugin: () => { const nav = ctx.get && ctx.get("pluginNavigation"); if (nav) nav.openBundle(PKG); } })
      }, SidebarStatus));
      ctx.slots.inject("plugins.bundle.activation", () => ctx.slots.register({
        name: "plugins.bundle.activation", key: PKG, locale: NS
      }, Activation));
    }
    exports.sidebarCardOn = sidebarCardOn;
    exports.apply = apply;
    exports.inject = inject;
    exports.Panel = Panel;
    exports.SidebarStatus = SidebarStatus;
    exports.makeApi = makeApi;
    return module.exports;
  }
});
