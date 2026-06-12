# Tauri 桌面应用图标包 - WorkCraft

基于 `ox-mascot.png` (1024x1024) 生成的完整 Tauri 桌面应用图标集合，覆盖 macOS、Windows、Linux 三大平台。

## 📁 目录结构

```
icons/
├── icon.png                          # 主图标 (1024x1024, 原始分辨率)
├── icon.ico                          # Windows 图标 (多分辨率: 16~256px)
├── icon.icns                         # macOS 图标 (多分辨率: 16~1024px)
├── icon.iconset/                     # macOS iconset 源文件包
│   ├── icon_16x16.png                #   16x16 (标准)
│   ├── icon_16x16@2x.png             #   32x32 (Retina)
│   ├── icon_32x32.png                #   32x32 (标准)
│   ├── icon_32x32@2x.png             #   64x64 (Retina)
│   ├── icon_128x128.png              #   128x128 (标准)
│   ├── icon_128x128@2x.png           #   256x256 (Retina)
│   ├── icon_256x256.png              #   256x256 (标准)
│   ├── icon_256x256@2x.png           #   512x512 (Retina)
│   ├── icon_512x512.png              #   512x512 (标准)
│   └── icon_512x512@2x.png           #   1024x1024 (Retina)
│
├── 16x16.png ~ 1024x1024.png        # 通用 PNG 尺寸系列 (Linux/跨平台)
├── tray-*.png                        # 系统托盘图标 (常规 + Retina)
├── Store-*.png                       # 应用商店图标 (256/512/1024)
└── Foreground-432x432.png            # Android/Linux 自适应图标前景
```

---

## 🖥️ 各平台配置说明

### 1. Windows 配置
在 `tauri.conf.json` 中：

```json
{
  "bundle": {
    "icon": [
      "icons/icon.ico",
      "icons/icon.png"
    ]
  }
}
```

| 文件 | 尺寸 | 说明 |
|------|------|------|
| `icon.ico` | 16,24,32,48,64,128,256 | Windows 多分辨率 ICO，自动适配任务栏/桌面/资源管理器 |

### 2. macOS 配置
在 `tauri.conf.json` 中：

```json
{
  "bundle": {
    "icon": [
      "icons/icon.icns",
      "icons/icon.png"
    ]
  }
}
```

| 文件 | 说明 |
|------|------|
| `icon.icns` | 完整的多分辨率 ICNS，包含 16px~1024px 所有标准尺寸 |
| `icon.iconset/` | Xcode 兼容的 iconset 源文件夹，可直接导入 Xcode 重新打包 |

**macOS 图标规范**：
- 16x16, 32x32:  Finder 列表视图 / 工具栏
- 128x128:        Finder 图标视图
- 256x256:        Quick Look 预览
- 512x512:        App Store 展示
- 1024x1024:      Retina 高分辨率

### 3. Linux 配置
在 `tauri.conf.json` 中：

```json
{
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/256x256.png",
      "icons/512x512.png",
      "icons/icon.png"
    ]
  }
}
```

| 文件 | 用途 |
|------|------|
| `16x16.png`   | 面板/小尺寸显示 |
| `32x32.png`   | 任务栏/菜单 |
| `64x64.png`   | 中等尺寸 |
| `128x128.png` | 标准应用图标 |
| `256x256.png` | HiDPI 显示 |
| `512x512.png` | 应用商店/大尺寸 |

---

## 🎯 图标规格总览

| 平台 | 格式 | 尺寸覆盖 | 文件 |
|------|------|----------|------|
| Windows | ICO | 16,24,32,48,64,128,256 | `icon.ico` |
| macOS | ICNS | 16,32,64,128,256,512,1024 | `icon.icns` |
| Linux | PNG | 16,32,64,128,256,512 | `*.png` |
| 托盘图标 | PNG | 16,18,22,32 + @2x | `tray-*.png` |
| 应用商店 | PNG | 256,512,1024 | `Store-*.png` |

---

## 🚀 Tauri 配置示例 (tauri.conf.json)

```json
{
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico",
      "icons/icon.png"
    ],
    "linux": {
      "deb": {
        "files": {}
      }
    }
  }
}
```

---

*图标源文件: 1024x1024 PNG with alpha transparency*
*生成时间: 2026-05-16*
