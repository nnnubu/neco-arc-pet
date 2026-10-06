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

## 历史版本要点（v1.0）

- 像素模式（Live2D 已移除，仅保留 pixi-live2d-display 依赖）
- 动作循环规则：走路/跑步按住循环（跑步用 ping-pong 帧序列衔接平滑）；thinking/push/star/pose1/hide/lie 重复 3 遍；smug 播完保持最后一帧 2 秒
- 语音：Aggressive 600e（默认，原音高 pitch 0）+ 中文声线 zh-CN-XiaoxiaoNeural
