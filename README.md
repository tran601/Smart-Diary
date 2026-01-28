# Smart Diary 智能日记

基于 Electron 的桌面日记应用，支持传统离线模式和 AI 模式。

## 功能介绍

### 日记功能
- 富文本日记编辑（支持格式化、图片等）
- 日历视图浏览历史日记

### 任务管理
- 创建、编辑、删除待办任务
- 设置任务优先级和截止日期
- 标记任务完成状态

### AI 功能（AI 模式）
- AI 对话生成日记内容
- 从对话中自动提取待办任务
- 基于日记生成周报

### 数据管理
- 本地 SQLite 数据库存储
- 数据导出和导入备份

## 双模式

| 功能 | 传统模式 | AI 模式 |
|------|:--------:|:-------:|
| 日记编辑 | ✓ | ✓ |
| 日历视图 | ✓ | ✓ |
| 任务管理 | ✓ | ✓ |
| 数据备份 | ✓ | ✓ |
| AI 对话 | ✗ | ✓ |
| AI 生成日记 | ✗ | ✓ |
| AI 周报 | ✗ | ✓ |

- **传统模式**：完全离线运行，无网络请求
- **AI 模式**：集成 OpenAI API，支持智能功能

## 环境要求

- Node.js >= 18.x
- npm >= 9.x
- Python（用于编译 better-sqlite3）
- Windows: Visual Studio Build Tools（包含 C++ 桌面开发工具）
- macOS: Xcode Command Line Tools
- Linux: build-essential

## 安装与运行

### 1. 克隆仓库

```bash
git clone https://github.com/your-username/SmartDiary.git
cd SmartDiary
```

### 2. 安装依赖

```bash
npm install
```

> 如果安装 better-sqlite3 失败，请确保已安装 Python 和 C++ 编译工具。
> Windows 用户可运行 `npm install --global windows-build-tools`

### 3. 开发模式运行

```bash
npm run dev
```

应用将以开发模式启动，支持热重载。

### 4. 打包发布

```bash
# Windows（生成安装程序和便携版）
npm run dist:win

# macOS
npm run dist:mac

# Linux
npm run dist:linux
```

打包完成后，可执行文件在 `release/` 目录下：
- Windows: `SmartDiary-x.x.x-win.exe`（安装程序）、`SmartDiary-x.x.x-portable.exe`（便携版）
- macOS: `SmartDiary-x.x.x-mac.dmg`
- Linux: `SmartDiary-x.x.x-linux.AppImage`

## 技术栈

- Electron 28
- React 18 + TypeScript
- Ant Design 组件库
- Zustand 状态管理
- better-sqlite3 数据库
- react-quill 富文本编辑
- OpenAI SDK

## 项目结构

```
SmartDiary/
├── electron/          # 主进程（数据库、AI、备份）
├── src/               # 渲染进程（React UI）
├── database/          # 数据库 schema
└── scripts/           # 测试脚本
```

## 数据存储位置

- Windows: `%APPDATA%/SmartDiary/`
- macOS: `~/Library/Application Support/SmartDiary/`
- Linux: `~/.config/SmartDiary/`
