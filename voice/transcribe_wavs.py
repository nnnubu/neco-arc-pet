# -*- coding: utf-8 -*-
"""用 faster-whisper 转写 wav 内容，确认生成的语音实际说了什么"""
import os

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

from faster_whisper import WhisperModel

FILES = [
    r"C:\Users\nnnubu\AppData\Local\Doubao\User Data\ClipboardTemp\speak_a.wav",
    r"C:\Users\nnnubu\AppData\Local\Doubao\User Data\ClipboardTemp\speak_b.wav",
    r"C:\Users\nnnubu\AppData\Local\Doubao\User Data\ClipboardTemp\speak_c.wav",
    r"C:\Users\nnnubu\AppData\Local\Doubao\User Data\ClipboardTemp\test_compare_1.wav",
]

print("加载 Whisper base 模型（首次自动下载）…", flush=True)
model = WhisperModel("base", device="cpu", compute_type="int8")
print("模型就绪\n", flush=True)

for p in FILES:
    try:
        segments, info = model.transcribe(p, language="zh", beam_size=5)
        text = "".join(s.text for s in segments).strip()
        print(f"{os.path.basename(p)} => {text}", flush=True)
    except Exception as e:
        print(f"{os.path.basename(p)} => ERROR: {e}", flush=True)
