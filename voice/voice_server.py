# -*- coding: utf-8 -*-
"""
桌宠语音长驻服务：stdin/stdout JSON 协议（配合 Electron main 进程）

启动即加载 RVC 模型（约 1 分钟，加载一次后常驻），之后每行一条 JSON 请求：
    -> {"id": 1, "text": "你好呀", "pitch": 0}
    <- {"id": 1, "ok": true, "wav": "C:/.../speak_xxx.wav"}
    <- {"id": 1, "ok": false, "error": "..."}
首条消息固定为 {"event": "ready"} 表示模型就绪。

协议要求：
- stdin 每行一个完整 JSON，stdout 每行一个完整 JSON（UTF-8）
- 转换结果 wav 输出到 output 目录，由调用方负责播放/清理
"""

import json
import os
import sys
import time
import traceback
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
BIN_DIR = os.path.join(BASE_DIR, "bin")
os.environ["PATH"] = BIN_DIR + os.pathsep + os.environ.get("PATH", "")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

# 复用 neco_speak 的模型配置（默认 agg + 中文声线，用户已验收）
from neco_speak import build_tts

_tts = None


def ensure_tts():
    global _tts
    if _tts is None:
        _tts = build_tts(model="agg", voice="zh-CN-XiaoxiaoNeural")
    return _tts


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    # 模型就绪握手（加载较慢，调用方在此前排队）
    print(json.dumps({"event": "ready"}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            text = (req.get("text") or "").strip()
            if not text:
                print(json.dumps({"id": req.get("id"), "ok": False, "error": "empty text"}), flush=True)
                continue
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            out = os.path.join(OUTPUT_DIR, f"speak_{ts}.wav")
            pitch = int(req.get("pitch", 0))
            # edge-tts 偶发网络超时，重试 1 次
            last_err = None
            for attempt in range(2):
                try:
                    ensure_tts()(text=text, pitch=pitch, index_rate=0.75, output_filename=out)
                    last_err = None
                    break
                except Exception as e:
                    last_err = e
                    if attempt == 0:
                        time.sleep(1)
            if last_err is not None:
                raise last_err
            print(json.dumps({"id": req.get("id"), "ok": True, "wav": out.replace(os.sep, "/")}), flush=True)
        except Exception as e:
            traceback.print_exc()
            print(json.dumps({"id": req.get("id"), "ok": False, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
