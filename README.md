# 猫姬桌宠（Neco Arc Pet）

像素风 Neco Arc 桌面宠物。技术栈：Electron + Pixi.js（像素动画）+ Python（TTS / RVC 变声 / 翻唱）。

## 快速启动

- 双击 `启动桌宠.vbs`（无控制台窗口，路径无关，按自身位置定位）
- 或 `npm start`

## 功能

| 模块 | 说明 |
|---|---|
| 对话 | 与猫姬 AI 聊天（文本生成模型可配置），气泡文本、消息记录、主动说话 |
| 翻唱 | 本地分离人声 → RVC 变声喵声 → 混音；桌面歌词（本地 `.lrc` 优先，网易云兜底）；历史播放 |
| 语音合成 | 文本 → 猫姬音色语音（语音模型可配置）；声线 / 情绪强度 / 音高可调，可应用到聊天与翻唱 |
| 动作 | 100+ 像素动作播放、随机动作、大动作 |
| AI 设置 | 文本 / 语音 / 嵌入三组模型独立配置；角色提示词、触发方式、随机发声、静音等 |
| 随机发声 | 偶尔播放 `assets/voice-clips/` 本地语音素材（基础包自带，无需语音扩展包） |
| 知识库 | 向量检索（嵌入模型可配置）或本地关键词检索（免费离线兜底）；资料放 `assets/arc-knowledge/*.md`，重启生效 |
| 联网搜索 | AI 回答前自动联网检索，触发方式可自定义 |
| 国际化 | 界面中 / 英切换 |

## AI 配置（AI 设置面板）

- **文本生成模型**：模型 / API 密钥 / 接口地址，必填
- **语音合成模型**：可选；模型 / 独立密钥 / 独立接口。未配置且开启「免费兜底」时自动用微软语音（Edge TTS → 系统语音）；未配置且关闭兜底时静默降级为纯文本
- **嵌入模型**：可选；模型 / 独立密钥 / 独立接口。未配置时知识库使用本地关键词检索
- 配置落盘 `assets/ai-config.json`（含密钥，本地保存不入库）

> 兼容旧配置：项目根 `.env`（`LLM_API_KEY / LLM_BASE_URL / LLM_MODEL`）仍可被读取。

## 打包发布

| 产物 | 内容 | 如何生成 |
|---|---|---|
| 基础包 | 桌面宠本体 + 素材 + 代码（无语音引擎） | 开发版侧边栏「生成基础包」（`scripts/build-basic.js`）→ `发布包/NecoArc-基础包.zip`，解压即用 |
| 语音扩展包 | Python 语音引擎 + 模型 + 依赖（约 1.4GB） | 开发版侧边栏「生成语音扩展包」（`scripts/build-voice.js`），解压到程序根目录自动生效 |

基础包即可使用：对话、动作、随机发声、知识库本地检索；语音合成 / 翻唱需安装语音扩展包，并在 AI 设置中填写语音模型（或使用免费兜底）。

## 环境与依赖

```bash
npm install          # Electron + Pixi.js
```

语音扩展包需要 Python 3.10（RVC 生态硬性要求，3.11+ 装不了）：

```bash
python -m venv voice-env310
voice-env310\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cpu
voice-env310\Scripts\pip install "setuptools<70" tts-with-rvc
# ffmpeg.exe 放 voice\bin\（脚本启动时自动加入 PATH）
```

## 项目结构

```
猫姬桌宠-成品/
├── main/            # 主进程（Electron 侧）：窗口、总面板、AI 问答、语音/翻唱/歌词服务、知识库、i18n
├── renderer/        # 渲染进程：桌宠舞台与各面板 UI（对话/翻唱/语音合成/动作/AI 设置）
├── preload.js       # 桥接层：contextBridge 暴露 window.pet API
├── voice/           # 语音管道（Python 3.10）：voice_server.py / sing.py / neco_speak.py / presets.json
├── assets/
│   ├── sprite/      # 像素动画帧（每动作一个目录）
│   ├── icons/       # 应用图标
│   ├── vendor/      # PixiJS 7 本地库
│   ├── voice-clips/ # 随机发声素材
│   └── arc-knowledge/  # RAG 知识库资料（*.md，可自行添加）
├── scripts/         # 打包脚本（build-basic.js / build-voice.js）
├── 启动桌宠.vbs     # 双击启动（无控制台窗口）
├── package.json
└── README.md / .gitignore
```

## Git 说明

- **不入库**：`node_modules/`、`voice-env310/`、`voice/models|assets|bin|output|cache`、`dist/`（体积大，物理保留，可重建）
- **本地配置不入库**：`.env`、`assets/ai-config.json`（含 API 密钥）、`assets/tts-config.json`、`assets/user-config.json`、`assets/ai_cache.json`、`assets/kb_embeddings.json`、日志文件
- 克隆后按需新建上述本地配置；模型文件（约 1.4GB）需通过语音扩展包获取

## 版权声明

Neco Arc 角色素材（`assets/sprite/`、`assets/voice-clips/`）版权归原版权方所有，本项目仅作个人学习与演示用途，请勿商用或再分发。
