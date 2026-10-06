# -*- coding: utf-8 -*-
"""对比 output 目录下 wav：大小/哈希/时长/内容指纹"""
import os, hashlib, wave, struct

OUT = r"C:\Users\nnnubu\Desktop\neco arc\猫姬桌宠-成品\voice\output"

def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def probe(p):
    try:
        with wave.open(p, "rb") as w:
            n = w.getnframes(); rate = w.getframerate(); ch = w.getnchannels(); sw = w.getsampwidth()
            return n / rate, rate, ch, sw
    except Exception as e:
        return None, str(e)

files = sorted(f for f in os.listdir(OUT) if f.endswith(".wav"))
for f in files:
    p = os.path.join(OUT, f)
    dur, rate, ch, sw = probe(p)
    print(f"{f}\t{os.path.getsize(p)}B\t{md5(p)[:12]}\tdur={dur:.2f}s rate={rate} ch={ch} sw={sw}")
