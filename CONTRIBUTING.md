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
3. **文档链接钉到新标签**：把 `docs/使用文档.md`、`docs/小黑盒文章.md`、`README.md` 里的 `cdn.jsdelivr.net/gh/snakejohn/dsh-hindsight-local@vX.Y.Z` 全部改成新版本（文章首图也一样，不要用 `@main`，jsDelivr 会缓存旧图）。`npm test` 同样会检查。
4. `npm test` 全部通过，检查暂存区里没有密钥。
5. 推 `dev`，`main` 只做快进合并；打标签 `vX.Y.Z` 并推送（**不要移动已有标签**）。
6. 发 GitHub Release，附件 `dsh-hindsight-local-vX.Y.Z.zip`：
   ```bash
   git archive --format=zip --prefix=dsh-hindsight-local-vX.Y.Z/ -o dsh-hindsight-local-vX.Y.Z.zip vX.Y.Z
   ```
7. 逐个打开文档里的 jsDelivr 链接，确认都返回 200。
8. GitHub 仓库 Settings → Social preview 重新上传 `docs/images/banner.png`（GitHub 不提供接口，只能手动）。
