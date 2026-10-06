# -*- coding: utf-8 -*-
"""模拟桌宠语音链路 v2：非阻塞读 stdout，验证长驻服务生成内容"""
import json
import os
import subprocess
import sys
import threading
import time
import queue
import wave

BASE = r"C:\Users\nnnubu\Desktop\neco arc\猫姬桌宠-成品"
PY = os.path.join(BASE, "voice-env310", "Scripts", "python.exe")
SERVER = os.path.join(BASE, "voice", "voice_server.py")

q = queue.Queue()


def reader(proc):
    for line in proc.stdout:
        q.put(line.decode("utf-8", "replace").strip())


def duration(p):
    with wave.open(p, "rb") as w:
        return w.getnframes() / w.getframerate()


def run_case(proc, text, case_id, timeout=120):
    req = {"id": case_id, "text": text}
    proc.stdin.write((json.dumps(req) + "\n").encode("utf-8"))
    proc.stdin.flush()
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            line = q.get(timeout=5)
        except queue.Empty:
            continue
        msg = json.loads(line)
        if msg.get("id") == case_id:
            if msg.get("ok"):
                return f"OK dur={duration(msg['wav']):.2f}s"
            return f"FAIL: {msg.get('error')}"
    return "TIMEOUT"


proc = subprocess.Popen(
    [PY, SERVER],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    cwd=os.path.join(BASE, "voice"),
    text=False,
)
t = threading.Thread(target=reader, args=(proc,), daemon=True)
t.start()
# 等 ready
while True:
    line = q.get(timeout=180)
    if '"ready"' in line:
        print("ready OK", flush=True)
        break

print("case1(长驻, 13字):", run_case(proc, "你好我是猫姬桌宠，今天天气不错", 1), flush=True)
print("case2(长驻, 3字):", run_case(proc, "喵喵喵", 2), flush=True)
proc.kill()
