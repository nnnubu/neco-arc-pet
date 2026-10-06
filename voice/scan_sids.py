# -*- coding: utf-8 -*-
"""
Neco Arc 模型说话人(sid)扫描工具
模型是 109 说话人的 RVC v2 模型，不同 sid 对应不同音色。
本脚本用同一句源音频批量转换多个 sid，找出最像 Neco Arc 原声（沙哑猫娘音）的说话人。

用法：
    python scan_sids.py --start 0 --end 12
    python scan_sids.py --text "にゃーん！" --pitch -3
输出：voice/output/sid_scan/sidXX.wav
"""

import argparse
import asyncio
import os
import sys

import numpy as np
from scipy.io import wavfile

# 路径配置
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BIN_DIR = os.path.join(BASE_DIR, "bin")
os.environ["PATH"] = BIN_DIR + os.pathsep + os.environ.get("PATH", "")
MODEL_PATH = r"C:\Users\nnnubu\Desktop\neco arc\Neco_Arc_v2\Neco_Arc_300e_5700s.pth"
INDEX_PATH = r"C:\Users\nnnubu\Desktop\neco arc\Neco_Arc_v2\added_Neco_Arc_v2.index"
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
SCAN_DIR = os.path.join(BASE_DIR, "output", "sid_scan")


def make_source_audio(text, voice, pitch_hz=0, rate_pct=0):
    """用 edge-tts 生成源音频，返回路径"""
    from tts_with_rvc.inference import tts_communicate

    tmp = os.path.join(BASE_DIR, "tmp")
    os.makedirs(tmp, exist_ok=True)
    path, _ = asyncio.run(
        tts_communicate(text, tmp_directory=tmp, voice=voice, tts_add_pitch=pitch_hz, tts_add_rate=rate_pct)
    )
    return path


def scan_sids(source_wav, start, end, pitch, index_rate, filter_radius, protect, f0_method, rms_mix_rate):
    from tts_with_rvc.assets import ModelStore
    from tts_with_rvc.infer.vc.modules import VC
    from tts_with_rvc.runtime import RuntimeConfig

    config = RuntimeConfig(device="cpu", is_half=False)
    vc = VC(config, model_store=ModelStore(ASSETS_DIR))
    vc.load_model(MODEL_PATH)
    os.makedirs(SCAN_DIR, exist_ok=True)
    try:
        for sid in range(start, end + 1):
            try:
                tgt_sr, audio = vc.vc_single(
                    sid, source_wav, pitch, None, f0_method,
                    INDEX_PATH, "", index_rate, filter_radius, 0,
                    rms_mix_rate, protect,
                )
                out = os.path.join(SCAN_DIR, f"sid{sid:02d}.wav")
                wavfile.write(out, tgt_sr, audio)
                rms = 20 * np.log10(np.sqrt(np.mean(audio.astype(float) ** 2)) + 1e-9)
                print(f"sid {sid:02d} -> {os.path.basename(out)}  ({len(audio)/tgt_sr:.1f}s, {rms:.0f}dB)")
            except Exception as e:
                print(f"sid {sid:02d} ERROR: {e}")
    finally:
        vc.close()
        try:
            os.remove(source_wav)
        except FileNotFoundError:
            pass


def main():
    parser = argparse.ArgumentParser(description="Neco Arc 说话人扫描")
    parser.add_argument("--text", default="にゃーん！お前の声、最高だぜ！", help="源文本（建议日语短句）")
    parser.add_argument("--voice", default="ja-JP-NanamiNeural", help="TTS 声线")
    parser.add_argument("--start", type=int, default=0, help="起始 sid")
    parser.add_argument("--end", type=int, default=11, help="结束 sid（含）")
    parser.add_argument("--pitch", type=int, default=-3, help="音高偏移（半音）")
    parser.add_argument("--index-rate", type=float, default=0.75, help="index 影响度")
    parser.add_argument("--filter-radius", type=int, default=3, help="呼吸中值滤波半径")
    parser.add_argument("--protect", type=float, default=0.33, help="辅音保护")
    parser.add_argument("--f0-method", default="rmvpe", help="音高提取方法")
    parser.add_argument("--rms-mix-rate", type=float, default=0.5, help="音量包络混合")
    args = parser.parse_args()

    print(f"[1/2] 生成源音频（{args.voice}）…")
    source = make_source_audio(args.text, args.voice)
    print(f"源音频: {source}")
    print(f"[2/2] 扫描 sid {args.start}~{args.end}…（首次加载模型约 20s）")
    scan_sids(
        source, args.start, args.end, args.pitch,
        args.index_rate, args.filter_radius, args.protect,
        args.f0_method, args.rms_mix_rate,
    )
    print(f"\n完成 → {SCAN_DIR}")


if __name__ == "__main__":
    main()
