// 主进程 - 统一路径解析：开发态/便携打包态（基础包+语音扩展包分离）自动切换
// 布局约定：
//   基础包（portable）：NecoArc.exe + resources/（app.asar + assets 资源，assets 可写）
//   语音扩展包：用户解压到程序根目录 → 根/voice + 根/voice-env310（与 NecoArc.exe 同级）
//   开发态：项目根/voice + 项目根/voice-env310 + 项目根/assets
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// 程序根目录：开发态=项目根；打包态=便携版 exe 所在目录（用户把语音扩展包解压到这里）
function getAppRoot() {
  if (app.isPackaged) return path.dirname(process.execPath);
  return path.join(__dirname, '..');
}

// 资源目录（含用户可写配置 assets/*.json）：开发态=项目根/assets；打包态=resources/assets
function getAssetRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'assets');
  return path.join(__dirname, '..', 'assets');
}

// 语音引擎探测：优先程序根（用户解压语音包位置），resources 兜底。
// 返回 { py, script, voiceDir, appRoot }；找不到返回 null（无语音扩展包，功能降级）
function resolveVoiceEnv() {
  const roots = [getAppRoot()];
  if (app.isPackaged && process.resourcesPath !== getAppRoot()) roots.push(process.resourcesPath);
  for (const root of roots) {
    const py = path.join(root, 'voice-env310', 'Scripts', 'python.exe');
    const script = path.join(root, 'voice', 'voice_server.py');
    if (fs.existsSync(py) && fs.existsSync(script)) {
      return { py, script, voiceDir: path.join(root, 'voice'), appRoot: root };
    }
  }
  return null;
}

// 语音数据目录（翻唱历史/缓存/日志）：有引擎=voice 目录；无引擎=程序根/voice（调用方需容错/提示）
function getVoiceRoot() {
  const env = resolveVoiceEnv();
  if (env) return env.voiceDir;
  return path.join(getAppRoot(), 'voice');
}

// 无语音包时调用方用：统一提示文案
const NO_VOICE_MSG = '未安装语音扩展包：请将语音扩展包解压到桌宠程序根目录后重启';

module.exports = { getAppRoot, getAssetRoot, resolveVoiceEnv, getVoiceRoot, NO_VOICE_MSG };
