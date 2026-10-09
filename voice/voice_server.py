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
# 用户请求优先：主循环收到合成请求时置位，预生成线程检测到后让路（用户说话不被预生成排队）
_user_waiting = threading.Event()

# 复用 neco_speak 的模型配置（默认 agg + 中文声线，用户已验收）
from neco_speak import build_tts, _ensure_ascii_index

_tts = None

# ── 情绪化合成（方案 B：CosyVoice 情绪源头 → RVC 变声保持 Neco Arc 音色）──
# 用户逐版验收的参数表：voice=CosyVoice 声线 / desc=情绪指令 / gain=API 增益dB / post_gain=变声后增益dB
EMOTION_CFG = {
    'happy':     {'voice': 'diana', 'desc': '开心欢快', 'gain': 5, 'post_gain': 3},
    'angry':     {'voice': 'bella', 'desc': '生气',     'gain': 0, 'post_gain': 6},
    'sad':       {'voice': 'bella', 'desc': '悲伤低沉', 'gain': 5, 'post_gain': 3},
    'surprised': {'voice': 'bella', 'desc': '震惊惊讶', 'gain': 5, 'post_gain': 3},
    'neutral':   {'voice': 'bella', 'desc': '平静自然', 'gain': 0, 'post_gain': 0},
}
COSY_MODEL = 'FunAudioLLM/CosyVoice2-0.5B'


def _load_api_key():
    """从项目根 .env 读取 LLM_API_KEY（SiliconFlow，TTS 与 LLM 共用）"""
    env_path = os.path.join(os.path.dirname(BASE_DIR), '.env')
    try:
        with open(env_path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('LLM_API_KEY='):
                    return line.split('=', 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ''


API_KEY = _load_api_key()

# RVC 变声：复用单实例（避免每次重建加载模型，慢）；index 经 ascii 复制（faiss 读不了中文路径）
_rvc = None
_rvc_model = os.path.join(BASE_DIR, 'models', 'agg', 'model.pth')
_rvc_index = _ensure_ascii_index(os.path.join(BASE_DIR, 'models', 'agg', 'model.index'))


def _ensure_rvc():
    global _rvc
    if _rvc is None:
        from tts_with_rvc.vc_infer import RVCConverter
        _rvc = RVCConverter(models_dir=os.path.join(BASE_DIR, 'assets'))
    return _rvc


def _repair_wav(path):
    """修复 wav 头的 RIFF/data size 字段（服务端可能把 size 写成 int32 溢出值，
    如 0xFFFFFF00，导致 wave 模块解析出 >1800s 假时长被判损坏）。
    仅当字段与实际不符时改写，正常文件不动。返回是否修复。"""
    import struct
    try:
        with open(path, 'rb') as f:
            data = f.read()
        if len(data) < 12 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
            return False
        changed = False
        buf = bytearray(data)
        correct_riff = len(data) - 8
        if struct.unpack('<I', data[4:8])[0] != correct_riff:
            struct.pack_into('<I', buf, 4, correct_riff)
            changed = True
        off = 12
        while off + 8 <= len(data):
            cid = data[off:off + 4]
            csz = struct.unpack('<I', data[off + 4:off + 8])[0]
            if cid == b'data':
                correct_data = len(data) - off - 8
                if csz != correct_data:
                    struct.pack_into('<I', buf, off + 4, correct_data)
                    changed = True
                break
            off += 8 + csz + (csz & 1)
        if changed:
            with open(path, 'wb') as f:
                f.write(buf)
        return changed
    except Exception:
        return False


def _wav_duration(path):
    """读取 wav 时长（秒）；非 wav/损坏/头异常返回 None。
    wave 模块对损坏头可能解析出 int32 溢出的帧数（如 2^31-1），
    超过 30 分钟视为头损坏，返回 None。"""
    try:
        import wave as _wave
        with _wave.open(path, "rb") as w:
            dur = w.getnframes() / w.getframerate()
            if dur > 1800:  # >30min 不可能是正常合成结果
                return None
            return dur
    except Exception:
        return None


def _check_text_duration(text, path, tag):
    """校验音频时长与文本长度是否匹配（内容错乱/缺字/空音频为异常短；念出无关大段内容为异常长）。
    中文语速约 0.25s/字：下限按 0.1s/字 + 最短 0.3s 兜底；上限按 0.45s/字 + 0.5s 兜底
    （留足停顿/中英混合余量，避免误杀正常长句）。明显超范围视为生成异常，
    抛错拒绝写入缓存（防止坏内容被缓存复用，下次命中仍然错乱）。"""
    dur = _wav_duration(path)
    if dur is None:
        raise RuntimeError(
            f"{tag} 音频文件无效或损坏（可能为 API 返回异常数据），已拒绝写入缓存"
        )
    n = len(text)
    min_dur = max(0.3, n * 0.1)
    max_dur = n * 0.45 + 0.5
    if dur < min_dur:
        raise RuntimeError(
            f"{tag} 音频时长过短（{dur:.2f}s < 预期 {min_dur:.1f}s），"
            f"可能内容缺失/错乱，已拒绝写入缓存"
        )
    if dur > max_dur:
        raise RuntimeError(
            f"{tag} 音频时长过长（{dur:.2f}s > 预期上限 {max_dur:.1f}s，文本 {n} 字），"
            f"可能念出无关大段内容，已拒绝写入缓存"
        )


def _doh_resolve(host):
    """系统 DNS 解析失败时的兜底：用 HTTPS-DNS(DoH, 阿里 223.5.5.5 是 IP 直连不依赖域名解析)
    解析域名，返回 A 记录 IP 列表；全部失败返回 None。"""
    import requests as _r
    for url in ("https://223.5.5.5/resolve", "https://dns.alidns.com/resolve"):
        try:
            rr = _r.get(url, params={"name": host, "type": "A"}, timeout=6)
            if rr.status_code == 200:
                ips = [a["data"] for a in rr.json().get("Answer", []) if a.get("type") == 1 and a.get("data")]
                if ips:
                    return ips
        except Exception as _e:
            sys.stderr.write(f"[doh] {url} 失败: {type(_e).__name__} {_e}\n")
            sys.stderr.flush()
    return None


def _curl_doh_resolve(host):
    """用系统 curl 直连 DoH（IP，不解析域名）拿 A 记录，完全绕开系统 DNS 客户端。
    本机系统 DNS 客户端间歇性 getaddrinfo 失败（nslookup 显式查询/curl IP 直连均正常），
    因此解析也不走系统栈。返回 IPv4 列表；全失败返回 []。"""
    import subprocess, json
    for doh in ('https://223.5.5.5/resolve', 'https://1.12.12.12/resolve'):
        try:
            r = subprocess.run(
                ['curl.exe', '-s', '--max-time', '8',
                 f'{doh}?name={host}&type=A'],
                capture_output=True, timeout=12)
            if r.returncode != 0:
                continue
            data = json.loads(r.stdout.decode('utf-8', 'replace'))
            ans = data.get('Answer') or []
            ips = [a['data'] for a in ans if a.get('type') == 1]
            if ips:
                return ips
        except Exception:
            continue
    return []


def _cosy_synth(text, voice, desc, gain, tmp_path):
    """CosyVoice API 合成带情绪的中文源音频到 tmp_path（在线，按 UTF-8 字节计费）。

    网络链路设计（本机已踩坑总结）：
    1. voice-env310 加载 RVC 链路后 Python 进程 winsock 被污染（socket 10038），
       requests 无法连网 → 改用系统 curl.exe 子进程（独立进程、系统栈正常）；
    2. 系统 DNS 客户端间歇性 getaddrinfo 失败（11003/rc=6）→ 普通 curl 解析失败时，
       用 curl 直连 DoH（IP 223.5.5.5，无需域名解析）拿真实 IP，
       再以 --resolve 指定 IP 连接（curl 保留域名 SNI/Host/证书语义，无需 -k）。
    JSON 经临时文件传入（--data-binary @file），避免命令行转义/编码问题。"""
    if not API_KEY:
        raise RuntimeError('未配置 LLM_API_KEY（项目根 .env）')
    import subprocess, json
    payload = {
        'model': COSY_MODEL,
        'voice': COSY_MODEL + ':' + voice,
        'input': f'请用{desc}的情感说这句话：<|endofprompt|>{text}',
        'response_format': 'wav',
        'sample_rate': 44100,
        'gain': gain,
    }
    req_file = tmp_path + '.req.json'
    base = ['curl.exe', '-s', '-S', '--max-time', '120',
            '-o', tmp_path, '-w', '%{http_code}',
            '-X', 'POST', 'https://api.siliconflow.cn/v1/audio/speech',
            '-H', 'Authorization: Bearer ' + API_KEY,
            '-H', 'Content-Type: application/json',
            '--data-binary', '@' + req_file]
    r = None
    try:
        with open(req_file, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False)
        # 第 1 次：走系统 DNS 解析（系统正常时一次成功）
        r = subprocess.run(base, capture_output=True, timeout=130)
        ok = (r.returncode == 0 and r.stdout.decode('utf-8', 'replace').strip() == '200')
        # 兜底：系统解析失败 → DoH 拿 IP → --resolve 直连（逐个 IP 试）
        if not ok:
            ips = _curl_doh_resolve('api.siliconflow.cn')
            if ips:
                for ip in ips:
                    rr = subprocess.run(
                        base + ['--resolve', 'api.siliconflow.cn:443:' + ip],
                        capture_output=True, timeout=130)
                    if rr.returncode == 0 and rr.stdout.decode('utf-8', 'replace').strip() == '200':
                        r, ok = rr, True
                        break
        if not ok:
            raise RuntimeError(f'CosyVoice API curl 失败 rc={r.returncode}: {r.stderr[:200]}')
        code = r.stdout.decode('utf-8', 'replace').strip()
        if code != '200':
            # 出错时响应体可能写入了 tmp_path，读前 200 字符辅助定位
            err = ''
            try:
                with open(tmp_path, 'rb') as f:
                    err = f.read(200).decode('utf-8', 'replace')
            except Exception:
                pass
            raise RuntimeError(f'CosyVoice API {code}: {err}')
    finally:
        try:
            os.remove(req_file)
        except Exception:
            pass
    # 校验响应是合法 wav（网络异常时可能返回 HTML 错误页/空内容但状态码 200）
    try:
        with open(tmp_path, 'rb') as f:
            head = f.read(4)
            size = os.path.getsize(tmp_path)
    except Exception as e:
        raise RuntimeError(f'CosyVoice 响应写入失败: {e}')
    if size < 100 or head != b'RIFF':
        raise RuntimeError('CosyVoice 返回内容异常（非有效 wav），已拒绝写入缓存')
    _repair_wav(tmp_path)  # 服务端可能写坏 size 字段（int32 溢出），修复后 wave 模块才能正常解析
    _check_text_duration(text, tmp_path, 'CosyVoice 源音频')


def ensure_tts():
    global _tts
    if _tts is None:
        _tts = build_tts(model="agg", voice="zh-CN-XiaoxiaoNeural")
    return _tts


def _normalize_key_text(text):
    """缓存 key 归一化：全角标点→半角、压缩空白。
    仅用于缓存命中判断（人眼看不出差异的输入共享同一缓存），合成仍用原文。"""
    out = []
    for ch in text:
        o = ord(ch)
        if o == 0x3000:  # 全角空格
            out.append(" ")
        elif 0xFF01 <= o <= 0xFF5E:  # 全角 ASCII 区 → 半角
            out.append(chr(o - 0xFEE0))
        else:
            out.append(ch)
    return "".join(out).strip()


def cache_path(text, emotion):
    """文本+情绪 → 缓存文件路径（内容寻址，相同文本+情绪命中同一文件）"""
    key = f"{_normalize_key_text(text)}\x00{emotion}".encode("utf-8")
    return os.path.join(CACHE_DIR, hashlib.md5(key).hexdigest() + ".wav")


def trim_cache():
    """缓存超限：按修改时间删除最旧条目"""
    files = sorted(glob.glob(os.path.join(CACHE_DIR, "*.wav")), key=os.path.getmtime)
    while len(files) > CACHE_MAX_FILES:
        try:
            os.remove(files.pop(0))
        except OSError:
            break


def synth(text, emotion, out_path):
    """加锁合成（CosyVoice 情绪源 → RVC 变声），写 to out_path；
    RVC 输出 40000Hz 统一转标准 44100Hz 16bit，再按情绪表后处理增益"""
    cfg = EMOTION_CFG.get(emotion, EMOTION_CFG['neutral'])
    with _synth_lock:
        src = os.path.join(CACHE_DIR, '_cosy_src.wav')
        _cosy_synth(text, cfg['voice'], cfg['desc'], cfg['gain'], src)
        rvc = _ensure_rvc()
        rvc.convert(
            model_path=_rvc_model,
            f0_up_key=0,
            input_path=src,
            file_index=_rvc_index,
            index_rate=0.75,
            output_dir_path=CACHE_DIR,
            output_filename='_cosy_out.wav',
        )
        rvc_out = os.path.join(CACHE_DIR, '_cosy_out.wav')
        # 变声后先校验时长与文本匹配（内容错乱/缺字则拒绝写入缓存），再落位
        _check_text_duration(text, rvc_out, 'RVC 变声后')
        os.replace(rvc_out, out_path)
    _to_44100(out_path)
    _apply_gain(out_path, cfg['post_gain'])


def _apply_gain(src, db):
    """音量增益（dB：正=更响、负=更轻；生气 +6dB 提音量）；就地覆盖，失败静默"""
    if not db:
        return
    try:
        import numpy as np
        import wave as _wave
        with _wave.open(src, "rb") as w:
            sr = w.getframerate()
            ch = w.getnchannels()
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        g = 10 ** (db / 20)
        x = data.astype(np.float32) / 32768.0 * g
        out = (np.clip(x, -1, 1) * 32767).astype(np.int16)
        with _wave.open(src, "wb") as w:
            w.setnchannels(ch)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(out.tobytes())
    except Exception:
        pass  # 增益失败保留原文件


def _to_44100(src):
    """40000Hz -> 44100Hz 16bit 标准 wav（就地覆盖；已是 44100 则跳过）"""
    try:
        import numpy as np
        import wave as _wave
    except Exception:
        return
    try:
        with _wave.open(src, "rb") as w:
            sr = w.getframerate()
            ch = w.getnchannels()
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        if sr == 44100:
            return
        x = data.astype(np.float32) / 32768.0
        n = int(len(x) * 44100 / sr)
        x2 = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
        out = (np.clip(x2, -1, 1) * 32767).astype(np.int16)
        with _wave.open(src, "wb") as w:
            w.setnchannels(ch)
            w.setsampwidth(2)
            w.setframerate(44100)
            w.writeframes(out.tobytes())
    except Exception:
        pass  # 转码失败保留原文件，不影响播放主链路


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
        # 用户请求优先：预生成期间若用户要说话，暂停预生成，等用户合成完再继续
        while _user_waiting.is_set():
            time.sleep(0.3)
        cp = cache_path(t.strip(), "neutral")
        if os.path.exists(cp):
            continue
        try:
            synth(t.strip(), "neutral", cp)
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
    # 就绪握手（RVC 模型懒加载：首次合成时初始化，故此处立即 ready）
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
            emotion = str(req.get("emotion", "neutral"))
            if emotion not in EMOTION_CFG:
                emotion = "neutral"
            cp = cache_path(text, emotion)
            force = bool(req.get("force"))
            # 缓存命中（非 force 重试）：直接返回，不再合成
            if not force and os.path.exists(cp):
                print(json.dumps({"id": req.get("id"), "ok": True, "wav": cp.replace(os.sep, "/"), "cached": True}), flush=True)
                continue
            # 用户请求优先标记：预生成线程看到后让路
            _user_waiting.set()
            try:
                # force 重试：先删旧缓存（可能存有偶发错误内容），再重新合成覆盖
                if force and os.path.exists(cp):
                    try:
                        os.remove(cp)
                    except OSError:
                        pass
                # 未命中：合成（CosyVoice 偶发网络超时，重试 1 次）到缓存文件
                last_err = None
                for attempt in range(2):
                    try:
                        synth(text, emotion, cp)
                        last_err = None
                        break
                    except Exception as e:
                        last_err = e
                        if attempt == 0:
                            time.sleep(1)
                if last_err is not None:
                    raise last_err
                trim_cache()
            finally:
                _user_waiting.clear()
            print(json.dumps({"id": req.get("id"), "ok": True, "wav": cp.replace(os.sep, "/"), "cached": False}), flush=True)
        except Exception as e:
            traceback.print_exc()
            print(json.dumps({"id": req.get("id"), "ok": False, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
