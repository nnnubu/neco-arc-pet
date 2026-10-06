# 猫姬桌宠（Neco Arc Pet）

本地桌宠 + Neco Arc 语音管道成品。
技术栈：Electron + Pixi.js（像素动画桌宠）+ edge-tts / RVC（Neco Arc 音色语音）。

## 快速启动

双击 `启动桌宠.vbs`（无控制台窗口，最省事）。

## 功能

- 透明置顶像素桌宠，右下角初始位置
- 右键菜单切换动作（思考/后空翻/得意/吐舌/挡脸等 13+ 种）
- WASD / 方向键移动，Shift 加速奔跑（循环动画），滚轮缩放大小
- **说句话…**：右键 → 输入文字 → 生成 Neco Arc 音色语音并播放（Aggressive 600e 模型，已验收）

## 语音管道

| 文件 | 作用 |
|---|---|
| `voice/voice_server.py` | 长驻服务（stdin/stdout JSON），桌宠懒启动、模型常驻，转换约 10~40 秒 |
| `voice/neco_speak.py` | 命令行入口：`voice-env310\Scripts\python.exe voice\neco_speak.py "文本" --model agg` |
| `voice/scan_sids.py` | 多说话人扫描工具（原模型 109 说话人用） |

- 模型：`voice/models/agg/`（Neco Arc Aggressive 600e，英语+日语训练数据，已验收）；备选 `voice/models/lumina/`（Melty Blood 官方游戏数据 600e）
- **已知坑**：faiss（C++）无法读取中文路径下的 index 文件，模型 index 已复制到纯 ASCII 路径 `C:\neco-voice\models\`（voice_server / neco_speak 已指向该处，勿删除）

## 环境（本目录已内置完整可运行副本）

- Node 依赖：`node_modules/`（Electron 44 + Pixi.js 7 + pixi-live2d-display，可 `npm install` 重建）
- Python 3.10 venv：`voice-env310/`（torch CPU + tts-with-rvc + edge-tts + ffmpeg；重建步骤见下）
- 语音辅助模型：`voice/assets/`（hubert_base.pt + rmvpe.pt，tts-with-rvc 首次运行自动下载到 models_dir，已预置）

### 重建 Python 环境（如需）

```
# 需 Python 3.10（RVC 生态硬性要求，3.11+ 装不了）
python -m venv voice-env310
voice-env310\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cpu
voice-env310\Scripts\pip install "setuptools<70" tts-with-rvc
# ffmpeg.exe 放 voice\bin\（脚本启动时自动加入 PATH）
```

## Git 说明

模型文件（约 1.4GB）与依赖目录（node_modules / voice-env310）体积大，已由 `.gitignore` 排除，不入版本库；它们物理保留在本目录内，因此本文件夹整体可独立运行。git 仓库仅管理代码与素材。

## 项目结构（代码分层）

```
猫姬桌宠-成品/
├── main/                          # 主进程（Node/Electron 侧）—— 窗口、菜单、语音服务
│   ├── index.js                   # 入口：应用生命周期，装配下面三个模块
│   ├── window.js                  # 窗口模块：透明置顶窗口、拖拽、走动、缩放、鼠标轮询、调试截图
│   ├── menu.js                    # 右键菜单模块：菜单模板与点击分发
│   └── voice.js                   # 语音服务模块：Python 子进程管理、stdin/stdout 协议、排队
├── preload.js                     # 桥接层：contextBridge 暴露 window.pet API（渲染进程唯一入口）
├── renderer/                      # 渲染进程（浏览器侧）—— 画面与交互
│   ├── index.html                 # 页面骨架：canvas 舞台 + 语音输入条 UI + 脚本加载顺序
│   ├── index.js                   # 入口：创建 PIXI 应用、共享状态、装配模块、主循环
│   ├── sprite.js                  # 精灵动画核心：帧加载、动画播放、循环规则、缩放适配
│   ├── controls.js                # 交互控制：拖拽、滚轮缩放、右键菜单、键盘移动
│   ├── voice-ui.js                # 语音输入条：显示/发送/播放/状态提示
│   └── debug.js                   # 调试序列：PET_DEBUG=1 时自动抽帧验证动画
├── voice/                         # 语音管道（Python 3.10）
│   ├── voice_server.py            # 长驻服务：模型常驻，stdin/stdout JSON 协议（桌宠调用）
│   ├── neco_speak.py              # 命令行入口：edge-tts + RVC 转换（可独立测试）
│   ├── scan_sids.py               # 说话人扫描工具（原 300e 模型用）
│   ├── models/                    # RVC 模型（agg=已验收 / lumina=备选），不入 git
│   ├── assets/                    # hubert / rmvpe 辅助模型，不入 git
│   ├── bin/                       # ffmpeg.exe，不入 git
│   ├── output/                    # 生成的语音 wav（运行时产物）
│   └── tmp/                       # 临时文件
├── assets/                        # 素材
│   ├── sprite/animations/         # 像素帧图（每动作一个目录：standing/walking/running/…）
│   └── vendor/pixi.min.js         # PixiJS 7 本地库
├── voice-env310/                  # Python 3.10 虚拟环境（torch CPU + tts-with-rvc），不入 git
├── node_modules/                  # npm 依赖（Electron/Pixi），不入 git
├── 启动桌宠.vbs                   # 双击启动（路径无关：按自身位置定位，无控制台窗口）
├── package.json                   # npm 配置：入口 main/index.js、依赖、npm start
└── README.md / .gitignore
```

### 分层原则

- **三进程边界清晰**：主进程（main/）只做窗口/系统能力与子进程管理，绝不碰画面；渲染进程（renderer/）只做画面与交互，绝不直接访问 Node；两者通过 `preload.js` 的 `window.pet` API 通信（IPC）。
- **模块按职责拆分**：每个模块只做一件事，改动一处不影响其他。例如想改动画规则只动 `renderer/sprite.js`；想改菜单项只动 `main/menu.js`；想改语音协议只动 `main/voice.js` + `voice/voice_server.py`。
- **共享状态收敛**：键盘/鼠标/缩放等跨模块状态集中在 `renderer/index.js` 的 `shared` 对象，模块间不互相引用，通过参数注入。

### 关键配置（想自己调整时看这里）

| 想改什么 | 改哪里 |
|---|---|
| 走路/跑步速度 | `renderer/sprite.js` update() 里 `spd = run ? 430 : 260` |
| 滚动缩放的步长/最小倍率 | `renderer/controls.js` `SCALE_STEP = 0.1` / `SCALE_MIN = 0.5` |
| 待机随机动作频率 | `renderer/sprite.js` `nextActionAt` 间隔（12000~20000ms） |
| 某动作重复几遍 | `renderer/sprite.js` `ACTION_REPEATS`（如 thinking: 3） |
| 某动作是否停留末帧 | `renderer/sprite.js` `SMUG_HOLD_MS = 2000`（smug 专属） |
| 右键菜单项 | `main/menu.js` 的 template |
| 语音默认参数（模型/音高/声线） | `voice/neco_speak.py` 顶部 `DEFAULT_*` 常量 |
| 窗口初始大小 | `main/window.js` `WIN_W / WIN_H` |

## 历史版本要点（v1.0）

- 像素模式（Live2D 已移除，仅保留 pixi-live2d-display 依赖）
- 动作循环规则：走路/跑步按住循环（跑步用 ping-pong 帧序列衔接平滑）；thinking/push/star/pose1/hide/lie 重复 3 遍；smug 播完保持最后一帧 2 秒
- 语音：Aggressive 600e（默认，原音高 pitch 0）+ 中文声线 zh-CN-XiaoxiaoNeural
