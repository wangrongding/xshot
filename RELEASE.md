# Release

## 发版步骤

1. 更新版本号：
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. 更新 README 文档：
   - 先更新 `README.md`，简体中文 README 是文档维护基准。
   - 再同步 `README.en.md`、`README.zh-TW.md`、`README.ja.md`、`README.ko.md`、`README.es.md`、`README.fr.md`、`README.de.md`、`README.pt-BR.md` 和 `README.ru.md`。
   - 确认所有语言版本的功能说明、安装提示、限制说明、路线图和顶部语言导航一致。
3. 运行检查：

```bash
pnpm tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

4. 构建 macOS 安装包：

```bash
pnpm build
```

5. 计算 DMG 校验值：

```bash
shasum -a 256 src-tauri/target/release/bundle/dmg/xshot_<version>_aarch64.dmg
```

6. 提交代码并推送：

```bash
git add .
git commit -m "feat: 添加 OCR 与截图翻译功能"
git push origin main
```

7. 创建 GitHub Release 并上传 DMG：

```bash
gh release create v<version> \
  src-tauri/target/release/bundle/dmg/xshot_<version>_aarch64.dmg \
  --title "xshot v<version>" \
  --notes-file /tmp/xshot-release-notes.md \
  --latest
```

## 注意

- 当前 macOS 安装包使用 ad-hoc 签名，未 notarize。
- 用户首次打开如果被 macOS 拦截，需要在 `系统设置` -> `隐私与安全性` 中选择 `仍要打开`。
- 截图需要屏幕录制权限；截长图需要辅助功能权限。

## 多语言文档维护

- 多语言 README 采用主流项目常见的顶部语言导航方式，当前覆盖简体中文、English、繁體中文、日本語、한국어、Español、Français、Deutsch、Português (Brasil) 和 Русский。
- 文档内容以 `README.md` 为准。功能、权限、限制、路线图或发版说明有变化时，先改中文版本，再同步其它语言。
- 如果某个版本暂时无法完整同步，不要只改部分段落；应在发版前补齐或明确移除对应语言入口。
