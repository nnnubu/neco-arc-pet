# -*- coding: utf-8 -*-
"""
桌宠语音长驻服务：stdin/stdout JSON 协议（配合 Electron main 进程）

启动即加载 RVC 模型（约 1 分钟，加载一次后常驻），之后每行一条 JSON 请求：
    -> {"id": 1, "text": "你好呀", "pitch": 0}
    <- {"id": 1, "ok": true, "wav": "C:/.../cache/xxxx.wav", "cached": false}
首条消息固定为 {"event": "ready"} 表示模型就绪。

缓存与预生成：
- 合成结果统一写入 cache/<md5(text+pitch)>.wav，相同文本命中缓存直接返回（cached=true）
- 缓存有上限（CACHE_MAX_FILES 个），超出自动删除最旧，避免无限积累
- {"cmd": "preset"} 触发后台预生成 presets.json 里的常用短语（预热缓存，不阻塞主循环）
- output 为废弃临时目录：启动时清空残留，播放后不保留临时文件

协议要求：
- stdin 每行一个完整 JSON，stdout 每行一个完整 JSON（UTF-8）
- 转换结果 wav 输出到 cache 目录，由调用方负责播放
"""

import json
import os
import sys
import time
import glob
import hashlib
import threading
import traceback
from datetime import datetime

# Windows 控制台默认 GBK，traceback/日志里的异常字符可能二次崩溃；统一 UTF-8 容错
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
BIN_DIR = os.path.join(BASE_DIR, "bin")
os.environ["PATH"] = BIN_DIR + os.pathsep + os.environ.get("PATH", "")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
CACHE_DIR = os.path.join(BASE_DIR, "cache")
PRESETS_FILE = os.path.join(BASE_DIR, "presets.json")
CACHE_MAX_FILES = 30  # 缓存上限：超出自动删除最旧，避免无限积累
# 合成调用全局锁：预生成线程与主循环并发时串行化（RVC/torch 非线程安全）
_synth_lock = threading.Lock()

# 复用 neco_speak 的模型配置（默认 agg + 中文声线，用户已验收）
from neco_speak import build_tts

_tts = None


def ensure_tts():
    global _tts
    if _tts is None:
        _tts = build_tts(model="agg", voice="zh-CN-XiaoxiaoNeural")
    return _tts


def cache_path(text, pitch):
    """文本+音调 → 缓存文件路径（内容寻址，相同文本命中同一文件）"""
    key = f"{text}\x00{pitch}".encode("utf-8")
    return os.path.join(CACHE_DIR, hashlib.md5(key).hexdigest() + ".wav")


def trim_cache():
    """缓存超限：按修改时间删除最旧条目"""
    files = sorted(glob.glob(os.path.join(CACHE_DIR, "*.wav")), key=os.path.getmtime)
    while len(files) > CACHE_MAX_FILES:
        try:
            os.remove(files.pop(0))
        except OSError:
            break


def synth(text, pitch, out_path):
    """加锁合成（edge-tts 在线 + RVC 变声），写 to out_path"""
    with _synth_lock:
        ensure_tts()(text=text, pitch=pitch, index_rate=0.75, output_filename=out_path)


def run_preset():
    """后台预生成常用短语（读 presets.json，逐个写入缓存预热）"""
    presets = []
    try:
        if os.path.exists(PRESETS_FILE):
            with open(PRESETS_FILE, encoding="utf-8") as f:
                presets = json.load(f)
    except Exception:
        presets = []
    if not isinstance(presets, list):
        presets = []
    done = 0
    for t in presets:
        if not isinstance(t, str) or not t.strip():
            continue
        cp = cache_path(t.strip(), 0)
        if os.path.exists(cp):
            continue
        try:
            synth(t.strip(), 0, cp)
            trim_cache()
            done += 1
        except Exception:
            traceback.print_exc()
    print(json.dumps({"event": "preset_done", "count": done}), flush=True)


def clean_text(s):
    """清理不可编码字符（孤立代理项等），避免 edge-tts / json 编码崩溃"""
    if not s:
        return s
    # 逐码位过滤：U+D800~U+DFFF 是 UTF-16 代理项，无法独立编码为 UTF-8
    return "".join(ch for ch in s if not (0xD800 <= ord(ch) <= 0xDFFF)).strip()


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    # 废弃 output 临时目录：启动时清空残留（播放后不保留临时文件）
    for f in glob.glob(os.path.join(OUTPUT_DIR, "*.wav")):
        try:
            os.remove(f)
        except OSError:
            pass
    # 模型就绪握手（加载较慢，调用方在此前排队）
    print(json.dumps({"event": "ready"}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            # 预生成命令：后台线程预热缓存，不阻塞主循环
            if req.get("cmd") == "preset":
                threading.Thread(target=run_preset, daemon=True).start()
                print(json.dumps({"id": req.get("id"), "ok": True, "preset": "started"}), flush=True)
                continue
            text = clean_text(req.get("text") or "")
            if not text:
                print(json.dumps({"id": req.get("id"), "ok": False, "error": "empty text"}), flush=True)
                continue
            pitch = int(req.get("pitch", 0))
            cp = cache_path(text, pitch)
            # 缓存命中：直接返回，不再合成
            if os.path.exists(cp):
                print(json.dumps({"id": req.get("id"), "ok": True, "wav": cp.replace(os.sep, "/"), "cached": True}), flush=True)
                continue
            # 未命中：合成（edge-tts 偶发网络超时，重试 1 次）到缓存文件
            last_err = None
            for attempt in range(2):
                try:
                    synth(text, pitch, cp)
                    last_err = None
                    break
                except Exception as e:
                    last_err = e
                    if attempt == 0:
                        time.sleep(1)
            if last_err is not None:
                raise last_err
            trim_cache()
            print(json.dumps({"id": req.get("id"), "ok": True, "wav": cp.replace(os.sep, "/"), "cached": False}), flush=True)
        except Exception as e:
            traceback.print_exc()
            print(json.dumps({"id": req.get("id"), "ok": False, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
