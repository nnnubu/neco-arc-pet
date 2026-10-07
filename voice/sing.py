#!/usr/bin/env python
# 翻唱脚本：python sing.py "<歌曲路径>"
# 链路：demucs 人声分离 → agg RVC 变声（Neco Arc 音色）→ 44100/16bit +6dB → ffmpeg 混回伴奏
# 输出：voice/sing_output/<歌名>/<歌名>_猫姬翻唱.wav（完整版）+ neco_vocal_g.wav（人声轨）
# stdout 进度（JSON 行）：{"stage":"separate"} {"stage":"convert"} {"stage":"mix"}
#                        {"done":{"full":"...","vocal":"..."}} {"error":"..."}
import os, sys, shutil, subprocess, json, re
import numpy as np
import wave as _wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根（voice/ 的上级）
PY = os.path.join(ROOT, 'voice-env310', 'Scripts', 'python.exe')
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
    src = sys.argv[1] if len(sys.argv) > 1 else ''
    if not src or not os.path.exists(src):
        log({'error': '找不到歌曲文件: ' + src}); return
    name = re.sub(r'\.[^.]+$', '', os.path.basename(src))
    OUT = os.path.join(ROOT, 'voice', 'sing_output', name)
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT, exist_ok=True)

    # ── 1. 人声分离（demucs htdemucs，模型已缓存在用户目录）──
    log({'stage': 'separate'})
    rr = subprocess.run([PY, '-m', 'demucs', '--two-stems', 'vocals', '-o', OUT, src],
                        capture_output=True, text=True, timeout=1800)
    if rr.returncode != 0:
        log({'error': '人声分离失败: ' + (rr.stderr[-300:] if rr.stderr else '未知')}); return
    sepdir = os.path.join(OUT, 'htdemucs', name)
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
        rvc_out = rvc.convert(model_path=MODEL, f0_up_key=0, input_path=vocal,
                              file_index=INDEX_ASCII, index_rate=0.75,
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
                            capture_output=True, text=True, timeout=600)
        if rr.returncode != 0:
            log({'error': '混音失败: ' + (rr.stderr[-300:] if rr.stderr else '未知')}); return
    except Exception as e:
        log({'error': '混音失败: ' + str(e)}); return

    log({'done': {'full': full, 'vocal': tmp}})


if __name__ == '__main__':
    main()
