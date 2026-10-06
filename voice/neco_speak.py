# -*- coding: utf-8 -*-
"""
Neco Arc 桌宠语音管道：文字 → 合成语音 → RVC 变声（Neco Arc 音色）

依赖环境：voice-env310（Python 3.10）
用法：
    python neco_speak.py "你好呀，我是猫姬桌宠！"
    python neco_speak.py "嘿嘿嘿" --pitch 6 --out output/test.wav
    python neco_speak.py "请列出可用的中文声线"

参数：
    --pitch N      RVC 音高偏移（半音，正=更高更尖，建议 0~8，默认 0）
    --voice NAME   edge-tts 声线（默认 zh-CN-XiaoxiaoNeural）
    --out PATH     输出文件路径（默认 output/<时间戳>.wav）
    --index-rate R index 特征影响度（0~1，默认 0.75）
"""

import argparse
import os
import sys

# 路径配置（本机固定路径）
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BIN_DIR = os.path.join(BASE_DIR, "bin")
os.environ["PATH"] = BIN_DIR + os.pathsep + os.environ.get("PATH", "")
MODELS_DIR = os.path.join(BASE_DIR, "models")

# faiss（C++）无法读取中文路径下的 index，模型 index 复制到纯 ASCII 路径 C:\neco-voice
ASCII_MODELS = r"C:\neco-voice\models"

# 可用模型：orig=用户原模型，lumina=Melty Blood LUMINA 600e，agg=Neco Arc Aggressive 600e
MODEL_PATHS = {
    "orig": {
        "pth": r"C:\Users\nnnubu\Desktop\neco arc\Neco_Arc_v2\Neco_Arc_300e_5700s.pth",
        "index": r"C:\Users\nnnubu\Desktop\neco arc\Neco_Arc_v2\added_Neco_Arc_v2.index",
    },
    "lumina": {
        "pth": os.path.join(MODELS_DIR, "lumina", "Neco-ArcLumina.pth"),
        "index": os.path.join(ASCII_MODELS, "lumina", "added_IVF765_Flat_nprobe_1_Neco-ArcLumina_v2.index"),
    },
    "agg": {
        "pth": os.path.join(MODELS_DIR, "agg", "model.pth"),
        "index": os.path.join(ASCII_MODELS, "agg", "model.index"),
    },
}
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_MODEL = "agg"  # 用户已验收：Aggressive 600e + 原音高


def _resolve_auto_device():
    """自动选择推理设备：优先 CUDA（NVIDIA GPU 加速），否则 CPU。
    注意：DirectML（dml:0）虽可运行但实测比 CPU 慢 3 倍以上，故不作为自动选项。"""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda:0"
    except Exception:
        pass
    return None


def build_tts(model=DEFAULT_MODEL, voice=DEFAULT_VOICE, device=None, is_half=None):
    """创建 TTS_RVC 实例（首次调用会加载 RVC 模型 + hubert + rmvpe，较慢）
    device: None=自动（优先 DirectML GPU，其次 CUDA，最后 CPU）
    is_half: None=自动（GPU 自动用 FP16 加速，CPU 用 FP32）"""
    from tts_with_rvc import TTS_RVC
    import torch as _torch
    if device is None:
        device = _resolve_auto_device()
    # DirectML 模式下 rmvpe 走 ONNX Runtime，需要 rmvpe_root 指向含 rmvpe.onnx 的目录
    rmvpe_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "rmvpe")
    if os.path.exists(os.path.join(rmvpe_root, "rmvpe.onnx")):
        os.environ["rmvpe_root"] = rmvpe_root

    if model not in MODEL_PATHS:
        raise SystemExit(f"未知模型：{model}，可选 {list(MODEL_PATHS)}")
    paths = MODEL_PATHS[model]
    return TTS_RVC(
        model_path=paths["pth"],
        index_path=paths["index"],
        device=device,
        is_half=is_half,
        voice=voice,
        output_directory=OUTPUT_DIR,
        models_dir=ASSETS_DIR,
    )


def speak(text, pitch=0, voice=DEFAULT_VOICE, out=None, index_rate=0.75, model=DEFAULT_MODEL):
    """文字 → Neco Arc 语音，返回输出文件路径"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    tts = build_tts(model=model, voice=voice)
    try:
        return tts(
            text=text,
            pitch=pitch,
            index_rate=index_rate,
            output_filename=out,
        )
    finally:
        tts.close()


def list_voices(lang_filter=None):
    """列出 edge-tts 可用声线（可选按语言过滤）"""
    import asyncio

    from tts_with_rvc.inference import get_voices

    voices = asyncio.run(get_voices())
    if lang_filter:
        voices = [v for v in voices if v.lower().startswith(lang_filter.lower())]
    return voices


def main():
    parser = argparse.ArgumentParser(description="Neco Arc 桌宠语音生成")
    parser.add_argument("text", nargs="?", help="要合成的文字")
    parser.add_argument("--pitch", type=int, default=0, help="音高偏移（半音）")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="edge-tts 声线")
    parser.add_argument("--out", default=None, help="输出文件路径")
    parser.add_argument("--index-rate", type=float, default=0.75, help="index 影响度")
    parser.add_argument("--model", default=DEFAULT_MODEL, choices=list(MODEL_PATHS), help="使用哪个模型：orig/lumina/agg")
    parser.add_argument("--list-voices", nargs="?", const="zh", help="列出声线（可按语言前缀过滤，如 zh）")
    args = parser.parse_args()

    if args.list_voices:
        voices = list_voices(args.list_voices)
        for v in voices:
            print(v)
        print(f"\n共 {len(voices)} 条声线")
        return

    if not args.text:
        parser.print_help()
        sys.exit(1)

    print(f"[1/2] 合成并转换中…（首次运行需加载模型，约 1-2 分钟）")
    out_path = speak(
        args.text,
        pitch=args.pitch,
        voice=args.voice,
        out=args.out,
        index_rate=args.index_rate,
        model=args.model,
    )
    print(f"[2/2] 完成 → {out_path}")
    print(f"参数：pitch={args.pitch}, voice={args.voice}, index_rate={args.index_rate}, model={args.model}")


if __name__ == "__main__":
    main()
