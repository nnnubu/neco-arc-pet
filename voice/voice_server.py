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
import re
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
    """读取 LLM_API_KEY（SiliconFlow，TTS 与 LLM 共用）。来源优先级：
    1. 环境变量 LLM_API_KEY（Electron 主进程 spawn 时传入，打包态/密钥变更即时生效）
    2. 程序根 .env 的 LLM_API_KEY（开发态/旧配置）
    3. assets/ai-config.json 的 apiKey（总面板 AI 设置保存的密钥；打包态无 .env 时兜底）
    """
    _env_key = os.environ.get('LLM_API_KEY', '').strip()
    if _env_key:
        return _env_key
    env_path = os.path.join(os.path.dirname(BASE_DIR), '.env')
    try:
        with open(env_path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('LLM_API_KEY='):
                    return line.split('=', 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    # 打包态兜底：读 assets/ai-config.json（与 main/ai.js 同一配置文件）
    # 开发态/语音包在程序根：程序根/assets；便携打包态：程序根/resources/assets
    for ai_cfg in (
        os.path.join(os.path.dirname(BASE_DIR), 'assets', 'ai-config.json'),
        os.path.join(os.path.dirname(BASE_DIR), 'resources', 'assets', 'ai-config.json'),
    ):
        try:
            with open(ai_cfg, encoding='utf-8') as f:
                import json
                data = json.load(f)
                key = data.get('apiKey') or ''
                if str(key).strip():
                    return str(key).strip()
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
    """校验音频时长与文本长度是否匹配（内容错乱/缺字/空音频时长为异常短）。
    中文语速约 0.25s/字，下限按 0.1s/字 + 最短 0.3s 兜底；明显过短视为生成异常，
    抛错拒绝写入缓存（防止坏内容被缓存复用，下次命中仍然错乱）。
    上限按 0.6s/字 + 0.8s 兜底：CosyVoice 偶发"跑飞"念出无关大段内容（时长明显超长），
    同样拒绝写入缓存并触发重试。系数从 0.45 放宽到 0.6：正常慢读/拖长音（如 2 字 1.44s）
    会被 0.45 误杀报生成失败；0.6 仍能拦截真正的跑飞（跑飞时长通常超过 2 倍正常值）。"""
    dur = _wav_duration(path)
    if dur is None:
        raise RuntimeError(tag + " 音频文件无效或损坏")
    min_dur = max(0.3, len(text) * 0.1)
    if dur < min_dur:
        raise RuntimeError(
            f"{tag} 音频时长异常（{dur:.2f}s < 预期 {min_dur:.1f}s），"
            f"可能内容错乱，已拒绝写入缓存"
        )
    max_dur = len(text) * 0.6 + 0.8
    if dur > max_dur:
        raise RuntimeError(
            f"{tag} 音频时长异常（{dur:.2f}s > 上限 {max_dur:.1f}s），"
            f"可能念出无关内容，已拒绝写入缓存"
        )


def _cosy_synth(text, voice, desc, gain, tmp_path):
    """CosyVoice API 合成带情绪的中文源音频到 tmp_path（在线，按 UTF-8 字节计费）"""
    if not API_KEY:
        raise RuntimeError('未配置 LLM_API_KEY（项目根 .env）')
    import requests
    payload = {
        'model': COSY_MODEL,
        'voice': COSY_MODEL + ':' + voice,
        'input': f'请用{desc}的情感说这句话：<|endofprompt|>{text}',
        'response_format': 'wav',
        'sample_rate': 44100,
        'gain': gain,
    }
    r = requests.post(
        'https://api.siliconflow.cn/v1/audio/speech',
        headers={'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json'},
        json=payload,
        timeout=120,
        # 强制直连：绕过环境/系统代理（防 Clash 等代理残留把请求转发到异常节点）
        proxies={'http': None, 'https': None},
    )
    if r.status_code != 200:
        raise RuntimeError(f'CosyVoice API {r.status_code}: {r.text[:200]}')
    # 校验响应是合法 wav（网络异常时可能返回 HTML 错误页/空内容但状态码 200）
    if len(r.content) < 100 or r.content[:4] != b'RIFF':
        raise RuntimeError('CosyVoice 返回内容异常（非有效 wav），已拒绝写入缓存')
    with open(tmp_path, 'wb') as f:
        f.write(r.content)
    # 服务端间歇性把 wav 头 size 字段写成 int32 溢出值（0xFFFFFFxx），
    # 会导致 wave 解析出 48695s 假时长；先按实际长度修复头，再校验时长
    _repair_wav(tmp_path)
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


def cache_path(text, emotion, f0=0, index_rate=0.75, intensity=1.0, voice=''):
    """文本+情绪+音色参数 → 缓存文件路径（内容寻址：相同文本+情绪+参数命中同一文件；
    f0/index_rate/intensity/voice 影响变声结果，必须进 key，否则不同参数串缓存）"""
    key = f"{_normalize_key_text(text)}\x00{emotion}\x00{f0}\x00{index_rate}\x00{intensity}\x00{voice}".encode("utf-8")
    return os.path.join(CACHE_DIR, hashlib.md5(key).hexdigest() + ".wav")


def _effective_cfg(emotion, voice_override='', intensity=1.0):
    """情绪配置 → 实际生效配置：声线可覆盖；情绪强度量化（0~1）→
    desc 加程度词 + post_gain 线性缩放（低强度=情绪更收敛，变声后增益更小）"""
    cfg = dict(EMOTION_CFG.get(emotion, EMOTION_CFG['neutral']))
    if voice_override:
        cfg['voice'] = str(voice_override).strip()
    try:
        iv = float(intensity)
    except (TypeError, ValueError):
        iv = 1.0
    if not (0 < iv <= 1):
        iv = 1.0
    if iv >= 0.99:
        return cfg
    # 程度词：低强度情绪更"淡"
    word = '一点点' if iv < 0.4 else ('略微' if iv < 0.85 else '')
    if word:
        cfg['desc'] = f"{word}{cfg['desc']}"
    cfg['post_gain'] = int(round(cfg['post_gain'] * iv))
    return cfg


def trim_cache():
    """缓存超限：按修改时间删除最旧条目"""
    files = sorted(glob.glob(os.path.join(CACHE_DIR, "*.wav")), key=os.path.getmtime)
    while len(files) > CACHE_MAX_FILES:
        try:
            os.remove(files.pop(0))
        except OSError:
            break


def synth(text, emotion, out_path, f0=0, index_rate=0.75, intensity=1.0, voice=''):
    """兼容入口：整段纯 TTS 合成（无口癖拼接时使用）"""
    _synth_tts(text, emotion, out_path, apply_post_gain=True, f0=f0, index_rate=index_rate,
               intensity=intensity, voice=voice)


def _synth_tts(text, emotion, out_path, apply_post_gain=True, f0=0, index_rate=0.75,
               intensity=1.0, voice=''):
    """加锁合成（CosyVoice 情绪源 → RVC 变声），写 to out_path；
    RVC 输出 40000Hz 统一转标准 44100Hz 16bit，再按情绪表后处理增益。
    f0=变声音高偏移（半音），index_rate=索引强度（0~1，越高越贴模型音色），
    intensity=情绪强度（0~1，低=情绪收敛），voice=声线覆盖（空=随情绪默认）"""
    cfg = _effective_cfg(emotion, voice, intensity)
    with _synth_lock:
        src = os.path.join(CACHE_DIR, '_cosy_src.wav')
        _cosy_synth(text, cfg['voice'], cfg['desc'], cfg['gain'], src)
        rvc = _ensure_rvc()
        rvc.convert(
            model_path=_rvc_model,
            f0_up_key=float(f0),
            input_path=src,
            file_index=_rvc_index,
            index_rate=float(index_rate),
            output_dir_path=CACHE_DIR,
            output_filename='_cosy_out.wav',
        )
        rvc_out = os.path.join(CACHE_DIR, '_cosy_out.wav')
        # 变声后先校验时长与文本匹配（内容错乱/缺字则拒绝写入缓存），再落位
        _check_text_duration(text, rvc_out, 'RVC 变声后')
        os.replace(rvc_out, out_path)
    _to_44100(out_path)
    if apply_post_gain:
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
            time.sleep(1.5)  # 预生成间隔：避免瞬时连发触发 SiliconFlow 高频风控
        except Exception:
            traceback.print_exc()
    print(json.dumps({"event": "preset_done", "count": done}), flush=True)


def clean_text(s):
    """清理不可编码字符（孤立代理项等），避免 edge-tts / json 编码崩溃"""
    if not s:
        return s
    # 逐码位过滤：U+D800~U+DFFF 是 UTF-16 代理项，无法独立编码为 UTF-8
    return "".join(ch for ch in s if not (0xD800 <= ord(ch) <= 0xDFFF)).strip()


# 句末"喵+语气符号"正则（用户实测仅"喵"需要处理；"呀/哦"等保留原语气）
# 覆盖感叹号/波浪号/省略号等常见尾缀——CosyVoice 对"喵！""喵～"都会顿读，统一降级为句号
_TAIL_MEOW_EXCLAM = re.compile(r'(喵)([！!～~…]+)\s*$')


def soften_tail_meow(text, emotion):
    """句末拟声词后的语气符号降级为句号。

    实测：CosyVoice 对"身影喵！"会把喵单独顿读并生成莫名拟声音效；
    "身影喵"或"身影喵。"则自然连读（用户试听 B/D 变体验收）。
    仅处理非 angry 情绪——生气版"谁干的喵！！！"的爆发语气是用户验收过的，保留。
    注意：必须在缓存 key 计算之前调用，让"喵！"与"喵。"不共享同一缓存。
    """
    if emotion == 'angry':
        return text
    m = _TAIL_MEOW_EXCLAM.search(text)
    if not m:
        return text
    return text[:m.start(1)] + m.group(1) + '。'


# ── 口癖原版音频替换：AI 文本里的猫语怪叫（Burenyuu!/Nya! 等）TTS 读出来很怪，
#    改为从 assets/voice-clips 取原版语音片段拼接进整句（映射表可配置）──
CLIPS_DIR = os.path.join(BASE_DIR, '..', 'assets', 'voice-clips')
MEOW_MAPPING_FILE = os.path.join(CLIPS_DIR, 'meow-mapping.json')
_meow_map = None      # {口癖词: 音频文件名}
_meow_patterns = None # [(口癖词, 编译好的正则)]，长词在前

def _load_meow_mapping():
    """加载 口癖词→原版音频 映射（启动后缓存；文件缺失/损坏则空映射=不替换）"""
    global _meow_map, _meow_patterns
    if _meow_map is not None:
        return _meow_map
    _meow_map = {}
    try:
        with open(MEOW_MAPPING_FILE, encoding='utf-8') as f:
            data = json.load(f)
        for k, v in data.items():
            if isinstance(k, str) and isinstance(v, str) and os.path.exists(os.path.join(CLIPS_DIR, v)):
                _meow_map[k.strip()] = v
    except Exception:
        _meow_map = {}
    keys = sorted(_meow_map.keys(), key=len, reverse=True)  # 长词优先（Nya hahahaha 先于 Nya）
    _meow_patterns = []
    for k in keys:
        stem = re.sub(r'[！!～~…\.。\s]+$', '', k)  # 去尾部语气符号/空格，匹配更宽松
        # 前后都要非字母数字边界：防误伤招式名（Nyanbushi 里的 Nya）
        # 后缀只允许紧跟的语气符号，不含空格——避免 "Nya hahahaha!" 被 "Nya" 提前吞掉前半
        _meow_patterns.append((k, re.compile(r'(?<![A-Za-z0-9])' + re.escape(stem) + r'(?![A-Za-z0-9])[！!～~…\.。]*', re.IGNORECASE)))
    return _meow_map


def split_meow_clips(text):
    """把文本按口癖词拆成片段列表 [(kind, value)]：
    kind='text' 走 TTS 合成，kind='clip' 用原版音频。无口癖命中返回 None（走原流程）。"""
    _load_meow_mapping()
    if not _meow_patterns:
        return None
    parts = []
    buf = []
    pos = 0
    n = len(text)
    while pos < n:
        hit = None
        for k, pat in _meow_patterns:
            m = pat.match(text, pos)
            if m:
                hit = (k, m)
                break
        if hit:
            if buf:
                parts.append(('text', ''.join(buf)))
                buf = []
            parts.append(('clip', _meow_map[hit[0]]))
            pos = hit[1].end()
        else:
            buf.append(text[pos])
            pos += 1
    if buf:
        parts.append(('text', ''.join(buf)))
    if not any(kind == 'clip' for kind, _ in parts):
        return None
    return parts


def _resample(x, src_sr, dst_sr):
    """一维 float32 数组线性重采样（与 _to_44100 同思路）"""
    import numpy as np
    n = int(len(x) * dst_sr / src_sr)
    idx = np.linspace(0, len(x) - 1, n)
    return np.interp(idx, np.arange(len(x)), x)


def _assemble_meow(parts, seg_paths, out_path):
    """按 parts 顺序拼接：text 段读 seg_paths[idx] 的 44100 单声道音频，
    clip 段读素材（48k→重采样 44100）交错拼接成最终 wav。素材缺失则跳过该口癖。"""
    import numpy as np
    import wave as _wave
    segs = []
    ti = 0
    for kind, val in parts:
        if kind == 'text':
            try:
                with _wave.open(seg_paths[ti], 'rb') as w:
                    sr = w.getframerate()
                    segs.append(np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16))
                ti += 1
            except Exception:
                ti += 1
        else:
            clip_path = os.path.join(CLIPS_DIR, val)
            try:
                with _wave.open(clip_path, 'rb') as w:
                    sr = w.getframerate()
                    ch = w.getnchannels()
                    d = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
                if ch > 1:
                    d = d.reshape(-1, ch).mean(axis=1).astype(np.int16)
                if sr != 44100:
                    d = (_resample(d.astype(np.float32) / 32768.0, sr, 44100) * 32767).astype(np.int16)
                segs.append(d)
            except Exception:
                pass  # 素材读失败：直接跳过该口癖，不中断合成
    if not segs:
        raise RuntimeError('口癖拼接失败：所有音频段均无效')
    out = np.concatenate(segs)
    with _wave.open(out_path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(out.astype(np.int16).tobytes())


def _export_out(cp, out_path):
    """可选持久保存：把缓存 wav 复制到 TTS 面板指定路径（自动建目录；失败静默，仅返回缓存路径）"""
    if not out_path or not cp or cp == out_path:
        return
    try:
        d = os.path.dirname(out_path)
        if d:
            os.makedirs(d, exist_ok=True)
        if not os.path.exists(cp):
            return
        import shutil
        shutil.copy2(cp, out_path)
    except Exception:
        pass  # 保存失败不阻断主链路（面板仍可用缓存路径播放）


def _synth_meow_parts(parts, full_text, emotion, out_path, f0=0, index_rate=0.75,
                      intensity=1.0, voice=''):
    """口癖拼接合成：逐段 TTS 合成 text 片段（不单独加情绪增益），
    与原版口癖音频拼接成整句后统一施加情绪增益。临时段文件用完即删。"""
    import numpy as np
    cfg = _effective_cfg(emotion, voice, intensity)
    text_idxs = [i for i, (k, _) in enumerate(parts) if k == 'text']
    seg_paths = {}
    try:
        for i in text_idxs:
            seg = parts[i][1]
            tmp = os.path.join(CACHE_DIR, f'_meow_seg_{i}.wav')
            _synth_tts(seg, emotion, tmp, apply_post_gain=False, f0=f0, index_rate=index_rate,
                       intensity=intensity, voice=voice)
            seg_paths[i] = tmp
        # 拼接结果整体应用情绪后处理增益（生气变响等，与纯 TTS 一致）
        _assemble_meow(parts, [seg_paths[i] for i in text_idxs], out_path)
        _apply_gain(out_path, cfg['post_gain'])
    finally:
        for p in seg_paths.values():
            try:
                os.remove(p)
            except OSError:
                pass


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    # 关键修复：Electron 以 UTF-8 写 stdin，而 Windows 上 sys.stdin 对管道默认按
    # 本地代码页(GBK/cp936)解码 → 中文变乱码 → CosyVoice 收到乱码文本 → 瞎念。
    # 必须显式指定 UTF-8 读取，否则所有中文输入都会错乱。
    if hasattr(sys.stdin, 'reconfigure'):
        try:
            sys.stdin.reconfigure(encoding='utf-8')
        except Exception:
            pass
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
            # 音色参数（TTS 面板可调）：变声音高偏移（半音）+ 索引强度（0~1）
            try:
                f0 = float(req.get("f0", 0) or 0)
            except (TypeError, ValueError):
                f0 = 0.0
            try:
                index_rate = float(req.get("index_rate", 0.75) or 0.75)
            except (TypeError, ValueError):
                index_rate = 0.75
            if not (0 <= index_rate <= 1):
                index_rate = 0.75
            # 情绪强度（0~1，TTS 面板滑杆；低=情绪收敛，desc 加程度词+post_gain 缩放）
            try:
                intensity = float(req.get("intensity", 1.0) or 1.0)
            except (TypeError, ValueError):
                intensity = 1.0
            if not (0 < intensity <= 1):
                intensity = 1.0
            # 声线覆盖（TTS 面板可选手动声线；空=随情绪默认）
            voice_override = str(req.get("voice") or "").strip()
            # 可选持久保存路径（TTS 面板）：合成结果复制到该路径（缓存仍保留，供再次命中）
            out_path = str(req.get("out_path") or "").strip()
            # 句末"喵！"类顿读修复：感叹号降级为句号（缓存 key 前处理，避免复用旧坏缓存）
            text = soften_tail_meow(text, emotion)
            # 口癖原版音频开关（TTS 面板可切）：true=遇到口癖词用原版音频拼接（默认）；
            # false=不做映射，直接 TTS 朗读口癖词（未做口癖替换的原始样子）
            try:
                meow_clips = bool(req.get("meow_clips", True))
            except Exception:
                meow_clips = True
            # 口癖替换：文本含 Burenyuu!/Nya! 等 → 拆段合成后与原版音频拼接
            meow_parts = split_meow_clips(text) if meow_clips else None
            # 口癖拼接走独立缓存 key（前缀标记），旧"纯 TTS 念怪叫"缓存不会命中
            cp = cache_path(('\x01meowmix\x02' + text) if meow_parts else text,
                            emotion, f0, index_rate, intensity, voice_override)
            force = bool(req.get("force"))
            # 缓存命中（非 force 重试）：直接返回，不再合成
            if not force and os.path.exists(cp):
                _export_out(cp, out_path)
                print(json.dumps({"id": req.get("id"), "ok": True,
                                  "wav": cp.replace(os.sep, "/"),
                                  "out": (out_path or cp).replace(os.sep, "/"),
                                  "dur": _wav_duration(cp) or 0,
                                  "cached": True}), flush=True)
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
                        if meow_parts:
                            _synth_meow_parts(meow_parts, text, emotion, cp, f0, index_rate,
                                              intensity, voice_override)
                        else:
                            synth(text, emotion, cp, f0, index_rate, intensity, voice_override)
                        last_err = None
                        break
                    except Exception as e:
                        last_err = e
                        if attempt == 0:
                            time.sleep(1)
                if last_err is not None:
                    raise last_err
                trim_cache()
                _export_out(cp, out_path)
            finally:
                _user_waiting.clear()
            print(json.dumps({"id": req.get("id"), "ok": True,
                              "wav": cp.replace(os.sep, "/"),
                              "out": (out_path or cp).replace(os.sep, "/"),
                              "dur": _wav_duration(cp) or 0,
                              "cached": False}), flush=True)
        except Exception as e:
            traceback.print_exc()
            print(json.dumps({"id": req.get("id"), "ok": False, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
