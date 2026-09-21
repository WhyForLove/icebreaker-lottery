# Desktop V1.0.0

Windows x64 桌面版，使用 Tauri 2。正式发布为免安装便携版，不制作安装程序。

## 普通使用者

请从 GitHub Releases 下载 `icebreaker-lottery-desktop-v1.0.0-windows-x64.zip`，完整解压后双击 `下一位.exe`。压缩包顶层只有：

```text
下一位.exe
头像/
```

`头像/` 必须和 EXE 放在同一目录。桌面版会直接读写这里的名册和图片，不依赖源码目录，也不需要安装 Node.js、Rust 或其他开发工具。

## 重新生成 EXE

首次运行前，在本目录安装依赖：

```text
npm install
```

在本目录执行：

```text
npm run build:exe
```

构建完成后会更新本目录中的 `下一位.exe`。如果本目录还没有 `头像/`，脚本会从 `../shared/defaults/头像` 初始化一份；已经存在时不会覆盖用户数据。

开发调试时仍可使用 `npm run tauri dev`。

生成 Web 与 Desktop 两个发布压缩包：

```text
npm run package:releases
```

结果位于 `desktop/release/`。Desktop 包使用当前提交中的默认头像，不会带入本机 `desktop/头像/` 或未提交的名册修改；Web 包固定取自 `v1.0.1` 标签。

## 当前结构

- `index.html`：桌面页面入口，沿用 Web V1 的页面结构。
- `desktop-adapter.js`：桌面文件适配器，实现与浏览器适配器相同的名册接口。
- `build-exe.ps1`：构建并复制可双击启动的 Release EXE。
- `package-releases.ps1`：生成 Web V1.0.1 和 Desktop V1.0.0 发布压缩包。
- `src-tauri/src/main.rs`：集中实现必要的 Rust 文件命令。
- `../shared/`：两端共用抽签核心、界面逻辑、样式、卡背和默认头像。

源码调试模式直接管理 `../shared/defaults/头像`；Release EXE 只管理同目录的 `头像/`，不会回退读取开发目录。桌面版不显示浏览器的“临时更换图片文件夹”和“绑定头像文件夹”流程。第一阶段仅支持 Windows，不包含安装程序、自动更新和代码签名。
