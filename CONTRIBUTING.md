# 参与开发 / 发版清单

## 跑测试

```bash
npm test            # 全部测试（不需要真实密钥）
```

密钥只通过环境变量传入，不要写进仓库、测试或日志。

## 发版清单（按顺序）

1. **改版本号**：`package.json` 的 `version`，并在 `CHANGELOG.md` 写好这一版的内容。
2. **重新生成首图**：`npm run release:assets`
   - 会读取 `package.json` 的版本，重画 `docs/images/banner.png`（GitHub 社交预览，1280×640）和 `docs/images/cover.png`（文章首图，1920×1080）。
   - 设计和吉祥物来自 `scripts/make-banner.py` 与 `docs/images/mascot.png`。
   - 需要 Python 3 + Pillow（`pip install pillow`）和 Noto Sans CJK 字体（Debian/Ubuntu：`apt install fonts-noto-cjk`；其他系统可用 `--font-dir` 指定字体目录）。
   - 版本号同时写进 PNG 的文本块；`npm test` 会检查它和 `package.json` 一致，忘了这一步测试会失败。
3. **小黑盒文章的图片**：`npm run release:assets` 会顺带运行 `npm run article:assets`，把文章用到的图复制成纯 ASCII 文件名 `docs/article-img/NN.png`（小黑盒不接受带 `%` 或中文的图片链接，会报「图片链接不合法」）。文章里所有链接都必须是纯 ASCII，也不能用 Markdown 表格（小黑盒不支持）：表格做成图片，「状态颜色」表由 `scripts/render-tables.py` 生成，「记忆存在哪」表是 `docs/images/table-storage.png`。`npm test` 会检查。
   小黑盒编辑器只支持：一到三级标题、段落、加粗、引用（「> 」）、单层列表、图片（单独一行，PNG）、链接。所以文章里不要用代码/反引号（路径和名字用「」括起来）、嵌套或缩进的内容、HTML、分隔线和脚注。外链发布后会按白名单过滤成纯文字，所以重要链接旁边都写出完整网址。需要用 Word 导入时：`npm run article:docx` 生成内嵌图片的 `小黑盒文章.docx`。
4. **文档链接钉到新标签**：把 `docs/使用文档.md`、`docs/小黑盒文章.md`、`README.md` 里的 `cdn.jsdelivr.net/gh/snakejohn/dsh-hindsight-local@vX.Y.Z` 全部改成新版本（文章首图也一样，不要用 `@main`，jsDelivr 会缓存旧图）。`npm test` 同样会检查。
   文章的图片链接用 `npm run article:assets -- --ref vX.Y.Z` 一次改好。标签发出后又要改文章图片时（标签不能移动），先提交图片，再用 `--ref <那次提交的完整 sha>` 钉到提交上，推送后再提交文章。
5. `npm test` 全部通过，检查暂存区里没有密钥。
6. 推 `dev`，`main` 只做快进合并；打标签 `vX.Y.Z` 并推送（**不要移动已有标签**）。
7. 发 GitHub Release，附件 `dsh-hindsight-local-vX.Y.Z.zip`：
   ```bash
   git archive --format=zip --prefix=dsh-hindsight-local-vX.Y.Z/ -o dsh-hindsight-local-vX.Y.Z.zip vX.Y.Z
   ```
8. 逐个打开文档里的 jsDelivr 链接，确认都返回 200，图片的 content-type 是 `image/png`。
9. GitHub 仓库 Settings → Social preview 重新上传 `docs/images/banner.png`（GitHub 不提供接口，只能手动）。
