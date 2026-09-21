# Desktop V1.0.0

Windows 桌面开发版，使用 Tauri 2，以源码方式运行，暂不制作安装包。

## 日常启动

双击本目录中的 `下一位.exe`。EXE 需要和项目的 `shared/` 目录保持当前相对位置，才能读取并管理默认头像。

## 重新生成 EXE

首次运行前，在本目录安装依赖：

```text
npm install
```

在本目录执行：

```text
npm run build:exe
```

构建完成后会更新本目录中的 `下一位.exe`，不会生成安装包。

开发调试时仍可使用 `npm run tauri dev`。

## 当前结构

- `index.html`：桌面页面入口，沿用 Web V1 的页面结构。
- `desktop-adapter.js`：桌面文件适配器，实现与浏览器适配器相同的名册接口。
- `build-exe.ps1`：构建并复制可双击启动的 Release EXE。
- `src-tauri/src/main.rs`：集中实现必要的 Rust 文件命令。
- `../shared/`：两端共用抽签核心、界面逻辑、样式、卡背和默认头像。

桌面版直接管理 `../shared/defaults/头像`，不显示浏览器的“临时更换图片文件夹”和“绑定头像文件夹”流程。第一阶段仅支持 Windows，不包含安装包、自动更新、签名和正式发布。
