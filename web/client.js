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
      port: "端口", pid: "PID", mem: "内存", logTail: "运行记录（给技术支持看）", installTail: "下载记录", logDir: "记录保存位置", envFile: "设置文件（.env）", checkConn: "检查一下", redeploy: "重新安装", restart: "重新启动", connOk: "一切正常", connBad: "连不上", hintT: "怎么办",
      rechoose: "重新选择", save: "保存", saved: "已保存，正在按新设置重新准备", failed: "保存没有成功，请再点一次保存；还不行就重启 dsh", unsaved: "有未保存的修改",
      conn: "连接", baseUrl: "Base URL", apiKey: "API Key", apiPrefix: "API 前缀", secretSet: "已设置（留空不修改）",
      deploy: "本地部署", runner: "安装方式", variant: "版本", port: "端口", cp: "同时启动 Control Plane", cpHint: "官方后台 UI（npm @vectorize-io/hindsight-control-plane，端口 9999，需要 Node/npx，首次运行需联网下载约 80MB）",
      emb: "理解文字的模型", embFoot: "用来理解每句话的意思，找回相关的记忆。必须设置。", rr: "排序模型", rrFoot: "把找回的记忆按相关程度排好。选 rrf 表示不用模型。", llm: "整理记忆的模型",
      preset: "服务商", provider: "接口类型", model: "模型", fetchModels: "获取模型", modelsN: "个模型", modelsErr: "获取模型失败",
      follow: "和 dsh 用同一个", custom: "自己指定", none: "不整理",
      followOk: "使用 dsh 默认模型", followNoKey: "dsh 的模型还没有密钥，所以暂时只保存原话、不做整理。", followInfo: "密钥来自", followOnlyLocal: "只对装在本机的记忆服务有效。", noneFoot: "不整理，只原样保存对话。",
      bank: "记忆库", defaultBank: "所有工作区共用一个记忆库", noDefault: "（不共用：每个工作区各记各的）", newBank: "新建记忆库…", newBankPrompt: "给新记忆库起个名字（英文/数字）", scope: "按什么分开记",
      ws: "工作区", wsFoot: "对话数不含已归档的对话；归档的对话不会被记住。", sessions: "个对话", archivedN: "个已归档", unmapped: "（默认路由）", addPath: "手动添加路径", path: "工作区文件夹", bankId: "记忆库名字", remove: "删除", noWs: "dsh 未提供工作区服务，可手动添加路径。",
      retainNow: "现在就记住", retainSel: "记住这个工作区的对话", retainAll: "记住全部对话（不含已归档）", retainHint: "已经记住过的内容不会重复记。", running: "进行中", done: "完成",
      other: "其他", recall: "聊天时自动回忆", retain: "自动记住对话", backfill: "启动时把以前的对话也记住", timezone: "时区", topN: "每次最多回忆几条",
      health: "记忆服务", state: "状态", version: "版本", openCp: "打开官方管理后台", banks: "记忆库", memories: "条记忆", docs: "段对话",
      job: "记住进度", recent: "最近记住的", failures: "没记住的", empty: "暂无", browse: "看看记住了什么", search: "搜索记忆", llmFallback: "整理记忆的模型暂时不可用，目前只保存原话",
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
@media (prefers-color-scheme:dark){.hs26{--hs-bg:rgba(44,44,46,.55);--hs-bg2:rgba(58,58,60,.4);--hs-line:rgba(84,84,88,.45);--hs-text:#f2f2f7;--hs-sub:rgba(235,235,245,.6);--hs-fill:rgba(120,120,128,.28);--hs-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.08)}}
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
@media (prefers-color-scheme:dark){.hs26 .pill.ok{color:#30d158}.hs26 .pill.bad{color:#ff6961}.hs26 .pill.warn{color:#ffb340}}
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
    const Select = (p) => h("select", { value: p.value == null ? "" : p.value, "aria-label": p.label, onChange: (e) => p.onChange(e.target.value) }, p.options.map((o) => typeof o === "string" ? h("option", { key: o, value: o }, o || "—") : h("option", { key: o.value, value: o.value }, o.label)));

    // ---- provider channel (preset -> base URL auto-fill, model list) ----
    function Channel(p) {
      const { t, api, chan, cur, set, isSecretSet, presets, title, foot, extraTop } = p;
      const base = [chan];
      const list = presets ? Object.keys(presets[chan] || {}) : [];
      const preset = cur([chan, "preset"]) || "";
      const baseUrl = cur([chan, "base_url"]) || "";
      const keyDraft = p.edits[chan + ".api_key"] ? p.edits[chan + ".api_key"].v : "";
      const [models, setModels] = useState({});
      const touched = useRef(false);
      const pick = (name) => {
        set([chan, "preset"])(name);
        const pr = presets && presets[chan] && presets[chan][name];
        if (!pr) return;
        set([chan, "provider"])(pr.provider);
        // Auto-fill the URL unless the user typed their own one.
        if (!touched.current || !baseUrl) set([chan, "base_url"])(pr.base_url);
        if (!cur([chan, "model"]) && pr.model) set([chan, "model"])(pr.model);
      };
      const load = () => {
        if (!baseUrl) return;
        setModels({ loading: true });
        api("models", { channel: chan, preset, provider: cur([chan, "provider"]) || "", base_url: baseUrl, api_key: keyDraft })
          .then((v) => setModels({ list: v.models || [], note: v.note }), (e) => setModels({ error: String(e.message || e) }));
      };
      // Fetch as soon as a key is present (typed, or already saved) and the endpoint is known.
      useEffect(() => {
        if (!baseUrl || !(keyDraft || isSecretSet(base.concat("api_key")) || /localhost|127\.0\.0\.1/.test(baseUrl))) return;
        const timer = setTimeout(load, 600);
        return () => clearTimeout(timer);
      }, [keyDraft, baseUrl, preset]); // eslint-disable-line
      const dl = "hs-models-" + chan;
      return h(Group, { title, foot },
        extraTop,
        h(Row, { label: t("preset") }, h(Select, { label: chan + " preset", value: preset, onChange: pick, options: [{ value: "", label: "—" }].concat(list.map((n) => ({ value: n, label: n }))) })),
        h(Row, { label: t("provider") }, h(Text, { label: chan + " provider", value: cur([chan, "provider"]), onChange: set([chan, "provider"]) })),
        h(Row, { label: t("baseUrl") }, h(Text, { label: chan + " base_url", value: baseUrl, placeholder: "https://…", onChange: (v) => { touched.current = true; set([chan, "base_url"])(v); } })),
        h(Row, { label: t("apiKey") }, h(Text, { type: "password", label: chan + " api_key", value: keyDraft, placeholder: isSecretSet(base.concat("api_key")) ? t("secretSet") : (chan !== "embedding" && hostOf(baseUrl) && hostOf(baseUrl) === hostOf(cur(["embedding", "base_url"])) ? t("shareKey") : "sk-…"), onChange: set([chan, "api_key"]) })),
        h(Row, { label: t("model") },
          h(Text, { label: chan + " model", list: dl, value: cur([chan, "model"]), onChange: set([chan, "model"]) }),
          models.list && models.list.length ? h(Select, { label: chan + " model list", value: "", onChange: (v) => v && set([chan, "model"])(v), options: [{ value: "", label: models.list.length + " " + t("modelsN") }].concat(models.list.map((m) => ({ value: m, label: m }))) }) : null,
          h("datalist", { id: dl }, (models.list || []).map((m) => h("option", { key: m, value: m }))),
          h("button", { className: "btn ghost small", onClick: load, disabled: !baseUrl }, models.loading ? "…" : t("fetchModels"))),
        models.error ? h("div", { className: "row sub", style: { color: "var(--hs-red)" } }, t("modelsErr") + ": " + models.error) : null);
    }

    // ---- workspace mapping + manual retain ----
    function Workspaces(p) {
      const { t, api, mapping, setMapping, bankOptions, askNewBank } = p;
      const ws = useRpc(api, "workspaces", {}, []);
      const [sel, setSel] = useState({});
      const [job, setJob] = useState(null);
      const [poll, setPoll] = useState(false);
      useEffect(() => {
        if (!poll) return;
        const timer = setInterval(() => api("overview").then((o) => { setJob(o.job); if (!o.job || !o.job.running) setPoll(false); }, () => setPoll(false)), 800);
        return () => clearInterval(timer);
      }, [poll]); // eslint-disable-line
      const list = (ws.value && ws.value.workspaces) || [];
      const known = new Set(list.map((w) => w.path));
      const manual = Object.keys(mapping).filter((k) => !known.has(k));
      const bankSel = (path) => h(Select, { label: "bank for " + path, value: mapping[path] || "", options: [{ value: "", label: t("unmapped") }].concat(bankOptions(mapping[path])).concat([{ value: "__new", label: t("newBank") }]),
        onChange: (v) => { if (v === "__new") { const id = askNewBank(); if (id) setMapping(Object.assign({}, mapping, { [path]: id })); return; } const n = Object.assign({}, mapping); if (v) n[path] = v; else delete n[path]; setMapping(n); } });
      const start = (filter) => api("retainNow", filter).then((r) => { setJob(r.job || r); setPoll(true); }, (e) => setJob({ error: String(e.message || e) }));
      const chosen = Object.keys(sel).filter((k) => sel[k]);
      const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
      return h(React.Fragment, null,
        h(Group, { title: t("ws"), foot: t("wsFoot") },
          ws.loading ? h("div", { className: "row sub" }, "…") : null,
          ws.value && !ws.value.available ? h("div", { className: "row sub" }, t("noWs")) : null,
          ws.error ? h("div", { className: "row sub" }, t("noRpc") + ": " + ws.error) : null,
          list.map((w) => h("div", { className: "row", key: w.path },
            h("button", { className: "chk", role: "checkbox", "aria-checked": !!sel[w.path], "aria-label": "select " + w.path, onClick: () => setSel(Object.assign({}, sel, { [w.path]: !sel[w.path] })) }, sel[w.path] ? "✓" : ""),
            h("div", { style: { flex: 1, minWidth: 0 } }, h("div", null, w.title || w.path.split(/[\\/]/).pop()), h("div", { className: "sub mono", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, w.path)),
            h("span", { className: "pill" }, w.sessions + " " + t("sessions")),
            w.archived ? h("span", { className: "pill", title: t("archivedN") }, w.archived + " " + t("archivedN")) : null,
            bankSel(w.path))),
          manual.map((path, i) => h("div", { className: "row", key: "m" + i },
            h("input", { type: "text", style: { textAlign: "left" }, value: path, "aria-label": t("path"), placeholder: t("path"), onChange: (e) => { const n = {}; Object.keys(mapping).forEach((k) => { n[k === path ? e.target.value : k] = mapping[k]; }); setMapping(n); } }),
            bankSel(path),
            h("button", { className: "btn ghost small", onClick: () => { const n = Object.assign({}, mapping); delete n[path]; setMapping(n); } }, t("remove")))),
          h("div", { className: "row" }, h("button", { className: "btn ghost small", onClick: () => setMapping(Object.assign({}, mapping, { ["/path/" + (manual.length + 1)]: "" })) }, "+ " + t("addPath")))),
        h(Group, { title: t("retainNow"), foot: t("retainHint") },
          h("div", { className: "row" },
            h("button", { className: "btn small", disabled: !chosen.length || (job && job.running), onClick: () => start({ workspaces: chosen }) }, t("retainSel") + (chosen.length ? " (" + chosen.length + ")" : "")),
            h("button", { className: "btn ghost small", disabled: job && job.running, onClick: () => start({}) }, t("retainAll"))),
          job ? h(JobRow, { t, job, pct }) : null));
    }
    function JobRow(p) {
      const { t, job } = p;
      if (job.error && !job.kind) return h("div", { className: "row sub", style: { color: "var(--hs-red)" } }, job.error);
      if (job.reason && !job.kind) return h("div", { className: "row sub" }, job.reason);
      const pct = job.total ? Math.round((job.done / job.total) * 100) : (job.running ? 0 : 100);
      return h("div", { className: "row", style: { flexWrap: "wrap" } },
        h("span", { className: "pill " + (job.running ? "warn" : job.error ? "bad" : "ok") }, job.running ? t("running") : t("done")),
        h("div", { className: "bar", "aria-label": "progress" }, h("i", { style: { width: pct + "%" } })),
        h("span", { className: "sub" }, (job.done || 0) + "/" + (job.total || 0) + " · ✓" + (job.scanned || 0) + " · ↷" + (job.skipped || 0) + " · 🗄" + (job.archived || 0) + " · ✗" + (job.failed || 0)),
        job.current ? h("span", { className: "sub mono" }, job.current) : null,
        job.error ? h("span", { className: "sub", style: { color: "var(--hs-red)" } }, job.error) : null);
    }

    // ---- status page ----
    function Status(p) {
      const { t, api } = p;
      const ov = useRpc(api, "overview", {}, [], 3000);
      const banks = useRpc(api, "banks", {}, []);
      const [bank, setBank] = useState("");
      const [q, setQ] = useState("");
      const [mem, setMem] = useState(null);
      const bl = (banks.value && banks.value.banks) || [];
      useEffect(() => { if (!bank && bl.length) setBank(bl[0].id); }, [bl.length]); // eslint-disable-line
      useEffect(() => {
        if (!bank) return;
        const timer = setTimeout(() => api("memories", { bank, q, limit: 30 }).then((v) => setMem(v), (e) => setMem({ error: String(e.message || e) })), 300);
        return () => clearTimeout(timer);
      }, [bank, q]); // eslint-disable-line
      if (ov.error) return h(Group, { title: t("health") }, h("div", { className: "row sub" }, t("noRpc") + ": " + ov.error));
      const o = ov.value || {};
      const llm = o.llm || {};
      return h(React.Fragment, null,
        h(Group, { title: t("health") },
          h(Row, { label: t("state") }, h("span", { className: "pill " + (o.ready ? "ok" : o.state === "starting" ? "warn" : "bad") }, o.state || "…")),
          h(Row, { label: t("version") }, h("span", { className: "mono" }, (o.version && (o.version.api_version || o.version.version)) || "—")),
          h(Row, { label: t("baseUrl") }, h("span", { className: "mono" }, o.baseUrl || "")),
          o.localPlan ? h(Row, { label: t("deploy") }, o.localPlan.runner + " · " + o.localPlan.variant) : null,
          h(Row, { label: t("llm") }, h("span", { className: "pill " + (llm.fallback ? "warn" : "ok") }, llm.mode || ""), h("span", { className: "mono" }, llm.effective || "")),
          o.controlPlaneUrl ? h(Row, { label: "Control Plane" }, h("a", { href: o.controlPlaneUrl, target: "_blank", rel: "noreferrer" }, t("openCp") + " ↗")) : null,
          o.lastError ? h("div", { className: "row sub", style: { color: "var(--hs-red)" } }, o.lastError) : null),
        o.setup === "local" || o.deploy && o.deploy.startedAt ? h(Deploy, { t, api, d: o.deploy || {}, refresh: ov.reload }) : null,
        llm.fallback ? h("div", { className: "warnbox" }, "⚠︎ " + t("llmFallback") + (llm.reason ? "（" + llm.reason + "）" : "")) : null,
        h(Group, { title: t("banks") },
          bl.length ? bl.map((b) => h("div", { className: "row", key: b.id, style: { cursor: "pointer" }, onClick: () => setBank(b.id) },
            h("span", { className: "lbl mono" }, b.id),
            h("div", { className: "val" }, h("span", { className: "pill" + (bank === b.id ? " ok" : "") }, ((b.stats && b.stats.total_nodes) || 0) + " " + t("memories")), h("span", { className: "pill" }, ((b.stats && b.stats.total_documents) || 0) + " " + t("docs")),
              b.stats && b.stats.failed_operations ? h("span", { className: "pill bad" }, "✗" + b.stats.failed_operations) : null))) : h("div", { className: "row sub" }, banks.loading ? "…" : t("empty"))),
        h(Group, { title: t("job") }, o.job ? h(JobRow, { t, job: o.job }) : h("div", { className: "row sub" }, t("empty"))),
        h(Group, { title: t("recent") }, (o.recent || []).length ? o.recent.map((r, i) => h("div", { className: "row", key: i }, h("span", { className: "sub" }, fmtTime(r.at)), h("div", { className: "val" }, h("span", { className: "mono" }, r.bank), h("span", { className: "pill" }, (r.turns || 0) + " turns")))) : h("div", { className: "row sub" }, t("empty"))),
        h(Group, { title: t("failures") }, (o.failures || []).length ? o.failures.map((r, i) => h("div", { className: "row", key: i }, h("span", { className: "sub" }, fmtTime(r.at)), h("div", { className: "val" }, h("span", { className: "mono" }, r.bank), h("span", { className: "pill bad", title: r.error }, String(r.error || "").slice(0, 60))))) : h("div", { className: "row sub" }, t("empty"))),
        h(Group, { title: t("browse") },
          h(Row, { label: "Bank" }, h(Select, { label: "browse bank", value: bank, onChange: setBank, options: bl.map((b) => ({ value: b.id, label: b.id })) })),
          h(Row, { label: "🔍" }, h("input", { type: "search", value: q, placeholder: t("search"), "aria-label": t("search"), onChange: (e) => setQ(e.target.value), style: { textAlign: "left" } })),
          mem && mem.error ? h("div", { className: "row sub" }, mem.error) : null,
          ((mem && mem.items) || []).map((m) => h("div", { className: "row mem", key: m.id },
            h("div", { className: "sub" }, fmtTime(memTime(m)), m.fact_type ? " · " + m.fact_type : ""),
            h("div", { className: "t" }, m.text))),
          mem && mem.items && !mem.items.length ? h("div", { className: "row sub" }, t("empty")) : null));
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
    const LEVEL_COLOR = { green: "var(--hs-green)", yellow: "var(--hs-orange)", gray: "var(--hs-gray)", red: "var(--hs-red)" };
    function useSidebarStatus(api) {
      const [st, setSt] = useState(null);
      useEffect(() => {
        let alive = true, sig = "";
        const loop = async () => {
          while (alive) {
            try { const v = await api("sidebar", { since: sig, wait: !!sig }); if (!alive) return; sig = v.sig; setSt(v); }
            catch (_) { if (!alive) return; setSt((o) => o || { level: "red", text: "插件未连接", reason: "" }); await new Promise((r) => setTimeout(r, 5000)); }
          }
        };
        loop();
        return () => { alive = false; };
      }, []);
      return st;
    }
    const ago = (iso) => { if (!iso) return "—"; const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? "刚刚" : s < 3600 ? Math.floor(s / 60) + " 分钟前" : s < 86400 ? Math.floor(s / 3600) + " 小时前" : Math.floor(s / 86400) + " 天前"; };
    function SidebarStatus(p) {
      useStyle();
      const st = useSidebarStatus(p.hsApi);
      const s = st || { level: "gray", text: "Hindsight…" };
      const color = LEVEL_COLOR[s.level] || LEVEL_COLOR.gray;
      const open = () => { window.__hsOpenTab = "status"; window.dispatchEvent(new CustomEvent("hs-open-tab", { detail: "status" })); p.openPlugin && p.openPlugin(); };
      const tip = ["Hindsight：" + s.text, s.reason, s.bank ? "记忆库：" + s.bank : "", "等待记住：" + (s.pending || 0), "上次记住：" + ago(s.lastRetain), "上次回忆：" + ago(s.lastRecall)].filter(Boolean).join("\n");
      const dot = h("span", { className: "hs-dot" + (s.level === "yellow" ? " pulse" : ""), style: { background: color, boxShadow: "0 0 0 3px color-mix(in srgb, " + color + " 22%, transparent)" } });
      if (!p.wide) return h("button", { className: "hs26 hs-side mini glass", title: tip, "aria-label": tip, onClick: open }, dot);
      const pr = s.progress;
      return h("button", { className: "hs26 hs-side glass", title: tip, "aria-label": "Hindsight " + s.text, onClick: open },
        h("div", { className: "hs-side-top" }, dot, h("span", { className: "hs-side-t" }, s.text), s.pending ? h("span", { className: "pill warn" }, s.pending + " 条待记住") : null),
        pr ? h("div", { className: "bar", style: { margin: "6px 0 2px" } }, h("i", { style: { width: Math.round(100 * pr.done / Math.max(1, pr.total)) + "%" } })) : null,
        s.reason ? h("div", { className: "hs-side-sub", style: { color: s.level === "red" ? "var(--hs-red)" : undefined } }, s.reason) : null,
        h("div", { className: "hs-side-sub" }, (s.bank ? s.bank + " · " : "") + "记住于 " + ago(s.lastRetain) + " · 回忆于 " + ago(s.lastRecall)));
    }

    // ---- 小白模式：选服务商 → 粘贴密钥（自动检测） → 一键开始 ----
    const Q = (p) => h("span", { className: "qm", title: p.tip, "aria-label": p.tip, tabIndex: 0 }, "?");
    function Simple(p) {
      const { t, api, form, isSecretSet, defaults } = p;
      const [key, setKey] = useState("");
      const [llmKey, setLlmKey] = useState("");
      const dl = useRpc(api, "dshLlm", {}, []).value;
      const llmMode = p.llmMode || "follow";
      const [chk, setChk] = useState(null);
      const [busy, setBusy] = useState(false);
      const [started, setStarted] = useState(false);
      const [nonce, setNonce] = useState(0);
      const ov = useRpc(api, "overview", {}, [nonce], 3000).value;
      const hasSaved = isSecretSet(["embedding", "api_key"]) || !!(ov && ov.keysSet && ov.keysSet.embedding);
      const check = (k) => { setChk({ checking: true }); api("checkKey", { api_key: k }).then(setChk, (e) => setChk({ ok: false, what: "检查时出错", how: "点「重试」再试一次。", detail: String(e.message || e) })); };
      useEffect(() => { if (!key.trim()) { setChk(null); return; } const id = setTimeout(() => check(key), 700); return () => clearTimeout(id); }, [key]);
      async function go() {
        setBusy(true);
        const D = defaults || {};
        const ops = [{ op: "set", path: ["setup"], value: "local" }];
        if (llmKey.trim() && dl && dl.llm) { ops.push({ op: "set", path: ["llm", "mode"], value: "custom" }, { op: "set", path: ["llm", "preset"], value: "" }, { op: "set", path: ["llm", "provider"], value: dl.llm.provider || "openai" }, { op: "set", path: ["llm", "base_url"], value: dl.llm.base_url || "" }, { op: "set", path: ["llm", "model"], value: dl.llm.model || "" }, { op: "set", path: ["llm", "api_key"], value: llmKey.trim() }); }
        for (const c of ["embedding", "reranker"]) for (const f of ["preset", "provider", "base_url", "model"]) if (D[c] && D[c][f]) ops.push({ op: "set", path: [c, f], value: D[c][f] });
        if (key.trim()) ops.push({ op: "set", path: ["embedding", "api_key"], value: key.trim() });
        const ok = await form.mutate(ops);
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
            h("div", { className: "sub" }, t("s2help")),
            chk ? (chk.checking ? h("div", { className: "sub" }, t("keyChecking"))
              : chk.ok ? h("div", { className: "okbox" }, t("keyOk") + (chk.balance != null ? "（余额 ¥" + chk.balance + "）" : ""))
              : h(Guide, { t, what: chk.what, how: chk.how, onRetry: () => check(key) })) : null),
          llmMode === "follow" ? h("div", { className: "row col" },
            h("span", { className: "lbl" }, t("sLlm"), " ", h(Q, { tip: t("sLlmTip") })),
            !dl ? h("div", { className: "sub" }, t("loading"))
              : dl.ok ? h("div", { className: "okbox" }, t("sLlmOk") + (dl.llm ? "：" + dl.llm.model : ""))
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
      const [extraBanks, setExtraBanks] = useState([]);
      if (snap.status === "loading") return h("p", null, t("loading"));
      if (snap.status !== "ready") return h("p", null, t("unavailable"));
      const value = snap.value || {};
      const key = (path) => path.join(".");
      const defaults = (presets && presets.defaults) || {};
      // Channel fields fall back to the plugin's built-in defaults (SiliconFlow) as pre-filled values.
      const cur = (path) => { if (key(path) in edits) return edits[key(path)].v; const v = get(value, path); return (v === undefined || v === "") && path.length === 2 && defaults[path[0]] && path[1] !== "api_key" ? defaults[path[0]][path[1]] : v; };
      const set = (path) => (v) => setEdits((e) => Object.assign({}, e, { [key(path)]: { path, v } }));
      const isSecretSet = (path) => { const v = get(value, path); if (v !== undefined && v !== "") return true; return path[path.length - 1] === "api_key" && !!(ovS && ovS.keysSet && ovS.keysSet[path[0]]); };
      async function save() {
        const ops = Object.values(edits).filter((e) => e.v !== undefined && !(e.v === "" && /api_key$/.test(e.path[e.path.length - 1]))).map((e) => ({ op: "set", path: e.path, value: e.v }));
        const ok = await form.mutate(ops);
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
      const remoteBanks = ((banksR.value && banksR.value.banks) || []).map((b) => b.id);
      const allBanks = Array.from(new Set(remoteBanks.concat(extraBanks).concat(Object.values(cur(["bank", "workspace_bank_mapping"]) || {})).concat([cur(["bank", "default_bank"])]).filter(Boolean)));
      const bankOptions = () => allBanks.map((b) => ({ value: b, label: b + (remoteBanks.includes(b) ? "" : " ✦") }));
      const askNewBank = () => { const id = (window.prompt(t("newBankPrompt")) || "").trim(); if (id) setExtraBanks(extraBanks.concat([id])); return id; };
      const mapping = cur(["bank", "workspace_bank_mapping"]) || {};
      const llmMode = cur(["llm", "mode"]) || "follow";
      const dl = dshLlm.value;
      const llmTop = h(React.Fragment, null,
        h(Row, { label: "" }, h(Seg, { label: "llm mode", value: llmMode, onChange: set(["llm", "mode"]), options: [{ value: "follow", label: t("follow") }, { value: "custom", label: t("custom") }, { value: "none", label: t("none") }] })));
      const chanProps = { t, api, cur, set, isSecretSet, presets, edits };
      // Picking "local" in the wizard is saved by 一键开始 itself; only advanced edits need the save bar.
      const dirty = Object.keys(edits).filter((k) => !(k === "setup" && setup === "local")).length > 0;
      return h("div", null,
        setup === "local" ? h(Simple, { t, api, form, isSecretSet, defaults, llmMode }) : null,
        h("details", { className: "adv", open: setup !== "local" },
        h("summary", null, t("advanced")),
        h(Group, { title: setup === "existing" ? t("conn") : t("deploy") },
          h(Row, { label: setup === "existing" ? "☁︎ " + t("existing") : "⌂ " + t("local") }, h("button", { className: "btn ghost small", onClick: () => setWizard(true) }, t("rechoose"))),
          setup === "existing" ? h(React.Fragment, null,
            h(Row, { label: t("baseUrl") }, h(Text, { label: "service base_url", value: cur(["service", "base_url"]), placeholder: "http://127.0.0.1:8888", onChange: set(["service", "base_url"]) })),
            h(Row, { label: t("apiKey") }, h(Text, { type: "password", label: "service api_key", value: edits["service.api_key"] ? edits["service.api_key"].v : "", placeholder: isSecretSet(["service", "api_key"]) ? t("secretSet") : "", onChange: set(["service", "api_key"]) })),
            h(Row, { label: t("apiPrefix") }, h(Text, { label: "api_prefix", value: cur(["service", "api_prefix"]), placeholder: "/v1/default", onChange: set(["service", "api_prefix"]) })))
          : h(React.Fragment, null,
            h(Row, { label: t("runner") }, h(Seg, { label: "runner", value: cur(["service", "local", "runner"]) || "auto", onChange: set(["service", "local", "runner"]), options: ["auto", "venv", "uvx", "docker"].map((v) => ({ value: v, label: v })) })),
            h(Row, { label: t("variant") }, h(Seg, { label: "variant", value: cur(["service", "local", "variant"]) || "auto", onChange: set(["service", "local", "variant"]), options: ["auto", "slim", "full"].map((v) => ({ value: v, label: v })) })),
            h(Row, { label: t("port") }, h(Text, { type: "number", label: "port", value: cur(["service", "local", "port"]), placeholder: "8888", onChange: set(["service", "local", "port"]) })),
            h(Row, { label: t("cp") }, h(Switch, { label: "control plane", value: cur(["service", "local", "control_plane", "enabled"]) === true, onChange: set(["service", "local", "control_plane", "enabled"]) })))),
        setup === "local" ? h("div", { className: "foot" }, t("localHint") + " " + t("cpHint")) : null,
        setup === "local" ? h(Channel, Object.assign({ chan: "embedding", title: t("emb"), foot: t("embFoot") }, chanProps)) : null,
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
          h(Row, { label: t("defaultBank") }, h(Select, { label: "default bank", value: cur(["bank", "default_bank"]) || "", onChange: (v) => { if (v === "__new") { const id = askNewBank(); if (id) set(["bank", "default_bank"])(id); } else set(["bank", "default_bank"])(v); }, options: [{ value: "", label: t("noDefault") }].concat(bankOptions()).concat([{ value: "__new", label: t("newBank") }]) })),
          h(Row, { label: t("scope") }, h(Seg, { label: "scope", value: cur(["bank", "scope"]) || "workspace", onChange: set(["bank", "scope"]), options: ["workspace", "preset", "session"].map((v) => ({ value: v, label: v })) }))),
        h(Workspaces, { t, api, mapping, setMapping: set(["bank", "workspace_bank_mapping"]), bankOptions, askNewBank }),
        h(Group, { title: t("other") },
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
      const t = props.t || ((k) => zh[k] || k);
      const [tab, setTab] = useState(() => { const w = typeof window !== "undefined" && window.__hsOpenTab; if (w) window.__hsOpenTab = ""; return w || "settings"; });
      useEffect(() => { const on = (e) => setTab(e.detail || "status"); window.addEventListener("hs-open-tab", on); return () => window.removeEventListener("hs-open-tab", on); }, []);
      if (props.view === "summary") return t("summary");
      const api = props.hsApi || makeApi(null);
      return h("div", { className: "hs26" },
        h("div", { className: "tabs" }, h(Seg, { label: "tabs", value: tab, onChange: setTab, options: [{ value: "settings", label: t("tabSettings") }, { value: "status", label: t("tabStatus") }] })),
        tab === "settings" ? h(Settings, { t, api, form: props.hsForm }) : h(Status, { t, api }));
    }

    function Activation(props) {
      useStyle();
      const t = props.t || ((k) => zh[k] || k);
      return h("div", { className: "hs26" }, h("div", { className: "card glass" }, h("p", null, t("activation")),
        h("div", { style: { display: "flex", gap: 10 } }, h("button", { className: "btn small", onClick: props.onOpenDetails }, t("openDetails")), h("button", { className: "btn ghost small", onClick: props.onDismiss }, t("later")))));
    }

    const inject = ["slots", "locale", "configForms"];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-hindsight: dictionaries");
      const form = ctx.configForms.get(NS_FORM);
      ctx.effect(() => () => { try { form.dispose && form.dispose(); } catch (_) {} }, "dsh-hindsight: form");
      const hsApi = makeApi(null);
      ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
        name: "plugins.bundle.config", key: PKG, locale: NS, inject: () => ({ hsForm: form, hsApi })
      }, Panel));
      // Left-sidebar indicator: the sidebar foot's documented `sidebar.footer.action` list.
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action", id: "dsh-hindsight.status", order: 50, label: "Hindsight",
        inject: () => ({ hsApi, openPlugin: () => { const nav = ctx.get && ctx.get("pluginNavigation"); if (nav) nav.openBundle(PKG); } })
      }, SidebarStatus));
      ctx.slots.inject("plugins.bundle.activation", () => ctx.slots.register({
        name: "plugins.bundle.activation", key: PKG, locale: NS
      }, Activation));
    }
    exports.apply = apply;
    exports.inject = inject;
    exports.Panel = Panel;
    exports.makeApi = makeApi;
    return module.exports;
  }
});
