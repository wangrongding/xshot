# Release

## 发版步骤

1. 更新版本号：
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. 更新 `README.md` 和 `README.en.md`，确认功能说明、安装提示和限制说明准确。
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
