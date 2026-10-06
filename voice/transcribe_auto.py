# -*- coding: utf-8 -*-
"""自动检测语言重新转写，确认乱码音频是什么内容"""
import os

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

from faster_whisper import WhisperModel

FILES = [
    r"C:\Users\nnnubu\AppData\Local\Doubao\User Data\ClipboardTemp\speak_a.wav",
    r"C:\Users\nnnubu\AppData\Local\Doubao\User Data\ClipboardTemp\speak_b.wav",
    r"C:\Users\nnnubu\AppData\Local\Doubao\User Data\ClipboardTemp\speak_c.wav",
]

model = WhisperModel("base", device="cpu", compute_type="int8")

for p in FILES:
    segments, info = model.transcribe(p, beam_size=5)
    text = "".join(s.text for s in segments).strip()
    print(f"{os.path.basename(p)} [lang={info.language} prob={info.language_probability:.2f}] => {text}", flush=True)
