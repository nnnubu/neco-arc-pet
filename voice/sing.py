#!/usr/bin/env python
# 翻唱脚本：python sing.py "<歌曲路径>"
# 链路：demucs 人声分离 → agg RVC 变声（Neco Arc 音色）→ 44100/16bit +6dB → ffmpeg 混回伴奏
# 输出：voice/sing_output/<歌名>/<歌名>_猫姬翻唱.wav（完整版）+ neco_vocal_g.wav（人声轨）
# stdout 进度（JSON 行）：{"stage":"separate"} {"stage":"convert"} {"stage":"mix"}
#                        {"done":{"full":"...","vocal":"..."}} {"error":"..."}
import os, sys, shutil, subprocess, json, re
import numpy as np
import wave as _wave

# Windows 管道下 Python stdout 默认按 GBK 编码，Electron 按 UTF-8 解码 → 中文路径乱码
# （同 voice_server.py 的 stdin 乱码根因）。强制 UTF-8 输出，保证 done 里的中文歌名/路径完好
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根（voice/ 的上级）
# 解释器：优先独立 Python（voice-env310\python\python.exe，随包分发可移植）；
# 旧语音包回退 venv 启动器（曾因 pyvenv.cfg 硬编码开发机路径导致换机后 No Python at ...）
_py_standalone = os.path.join(ROOT, 'voice-env310', 'python', 'python.exe')
PY = _py_standalone if os.path.exists(_py_standalone) else os.path.join(ROOT, 'voice-env310', 'Scripts', 'python.exe')
FFMPEG = os.path.join(ROOT, 'voice', 'bin', 'ffmpeg.exe')
# 项目内 ffmpeg 不在 PATH，脚本内注入（与其他脚本一致）
os.environ['PATH'] = os.path.join(ROOT, 'voice', 'bin') + os.pathsep + os.environ['PATH']


def log(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def _to_44100(src):
    """RVC 输出 40000Hz，播放器无法识别，统一线性重采样到 44100Hz 16bit"""
    with _wave.open(src, 'rb') as w:
        sr = w.getframerate(); ch = w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    if sr == 44100:
        return
    x = data.astype(np.float32) / 32768.0
    n = int(len(x) * 44100 / sr)
    x2 = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    out16 = (np.clip(x2, -1, 1) * 32767).astype(np.int16)
    with _wave.open(src, 'wb') as w:
        w.setnchannels(ch); w.setsampwidth(2); w.setframerate(44100); w.writeframes(out16.tobytes())


def main():
    # 命令行：python sing.py "<歌曲路径>" [--f0 半音] [--index-rate 0~1]
    # （TTS 面板"应用到翻唱"时由 sing.js 传入，默认 0 / 0.75 与历史一致）
    args = [a for a in sys.argv[1:]]
    f0_up = 0.0
    index_rate = 0.75
    src = None
    i = 0
    while i < len(args):
        a = args[i]
        if a == '--f0' and i + 1 < len(args):
            try: f0_up = float(args[i + 1])
            except ValueError: pass
            i += 2
        elif a == '--index-rate' and i + 1 < len(args):
            try: index_rate = float(args[i + 1])
            except ValueError: pass
            i += 2
        else:
            src = a
            i += 1
    if not src or not os.path.exists(src):
        log({'error': '找不到歌曲文件: ' + (src or '空')}); return
    # 歌名去扩展名 + 去首尾空白：Windows 会自动剔除目录/文件名末尾空格，
    # 若保留空格（如 "浮夸 - 陈奕迅 .mp3"）→ makedirs 实际创建无空格目录，
    # 而 pre_wav/full 路径字符串仍带空格 → 访问不存在路径报 "No such file or directory"
    name = re.sub(r'\.[^.]+$', '', os.path.basename(src)).strip()
    OUT = os.path.join(ROOT, 'voice', 'sing_output', name)
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT, exist_ok=True)

    # ── 0. 统一转码：ffmpeg 先转 wav（demucs 的 sphn 一定能读；损坏 mp3 也能容错读取，
    #      且绕开 demucs 兜底对 ffprobe 的依赖——项目只有 ffmpeg.exe 没有 ffprobe.exe）──
    log({'stage': 'convert_pre'})
    pre_wav = os.path.join(OUT, '_pre.wav')
    rr = subprocess.run([FFMPEG, '-y', '-i', src, '-ac', '2', '-ar', '44100', pre_wav],
                        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=600)
    if rr.returncode != 0 or not os.path.exists(pre_wav):
        log({'error': '文件无法解码（格式不支持或文件损坏）: ' + (rr.stderr[-200:] if rr.stderr else '')}); return

    # ── 1. 人声分离（demucs htdemucs，模型已缓存在用户目录）──
    log({'stage': 'separate'})
    demucs_cmd = [PY, '-m', 'demucs', '--two-stems', 'vocals', '-o', OUT, pre_wav]
    # encoding/errors：demucs stderr 混有 GBK 字节，text=True 严格 utf-8 会让读取线程抛
    # UnicodeDecodeError 导致 stderr 不完整（日志已出现过一次）；errors='replace' 兜底
    rr = subprocess.run(demucs_cmd, capture_output=True, text=True,
                        encoding='utf-8', errors='replace', timeout=1800)
    if rr.returncode != 0:
        # 偶发环境故障（Windows 上 import _overlapped 偶发 WinError 10038——杀软 winsock 钩子 /
        # 多 python 进程并发竞争句柄等瞬态问题）→ 清理残留产物后自动重试一次
        log({'stage': 'separate_retry'})
        shutil.rmtree(os.path.join(OUT, 'htdemucs'), ignore_errors=True)
        rr = subprocess.run(demucs_cmd, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=1800)
    if rr.returncode != 0:
        log({'error': '人声分离失败: ' + (rr.stderr[-300:] if rr.stderr else '未知')}); return
    sepdir = os.path.join(OUT, 'htdemucs', '_pre')
    vocal = os.path.join(sepdir, 'vocals.wav')
    inst = os.path.join(sepdir, 'no_vocals.wav')
    if not (os.path.exists(vocal) and os.path.exists(inst)):
        log({'error': '分离产物缺失（歌曲可能只有伴奏、没有原唱人声）'}); return

    # ── 2. agg 变声（Neco Arc 音色；中文 index 路径 faiss 读不了 → ASCII 副本）──
    log({'stage': 'convert'})
    try:
        MODEL = os.path.join(ROOT, 'voice', 'models', 'agg', 'model.pth')
        INDEX = os.path.join(ROOT, 'voice', 'models', 'agg', 'model.index')
        INDEX_ASCII = os.path.join(os.environ['TEMP'], 'neco_voice_index', 'agg.index')
        os.makedirs(os.path.dirname(INDEX_ASCII), exist_ok=True)
        if not os.path.exists(INDEX_ASCII):
            shutil.copy2(INDEX, INDEX_ASCII)
        from tts_with_rvc.vc_infer import RVCConverter
        rvc = RVCConverter(models_dir=os.path.join(ROOT, 'voice', 'assets'))
        rvc_out = rvc.convert(model_path=MODEL, f0_up_key=f0_up, input_path=vocal,
                              file_index=INDEX_ASCII, index_rate=index_rate,
                              output_dir_path=OUT, output_filename='neco_vocal.wav')
        rvc.close()
    except Exception as e:
        log({'error': '变声失败: ' + str(e)}); return

    # ── 3. 44100 转换 + 人声 +6dB + 混回伴奏 ──
    log({'stage': 'mix'})
    try:
        _to_44100(rvc_out)
        tmp = os.path.join(OUT, 'neco_vocal_g.wav')
        with _wave.open(rvc_out, 'rb') as w:
            sr = w.getframerate(); ch = w.getnchannels()
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        x = data.astype(np.float32) / 32768.0 * (10 ** (6 / 20))
        out16 = (np.clip(x, -1, 1) * 32767).astype(np.int16)
        with _wave.open(tmp, 'wb') as w:
            w.setnchannels(ch); w.setsampwidth(2); w.setframerate(sr); w.writeframes(out16.tobytes())
        full = os.path.join(OUT, name + '_猫姬翻唱.wav')
        rr = subprocess.run([FFMPEG, '-y', '-i', tmp, '-i', inst,
                             '-filter_complex', '[0:a]volume=1.0[v];[v][1:a]amix=inputs=2:duration=first',
                             '-c:a', 'pcm_s16le', full],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=600)
        if rr.returncode != 0:
            log({'error': '混音失败: ' + (rr.stderr[-300:] if rr.stderr else '未知')}); return
    except Exception as e:
        log({'error': '混音失败: ' + str(e)}); return

    log({'done': {'full': full, 'vocal': tmp}})


if __name__ == '__main__':
    main()
