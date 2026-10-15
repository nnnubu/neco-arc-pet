// 主进程 i18n：界面中英双语键值表 + 语言读写（assets/user-config.json 的 lang 字段）+ 广播
// 渲染层通过 IPC 'i18n-get' 拉取 { lang, dict }；'i18n-set-lang' 保存并广播 'i18n-change' 到所有窗口
const fs = require('fs');
const path = require('path');
const { ipcMain, BrowserWindow } = require('electron');
const { getAssetRoot } = require('./paths');

const DICT = {
  zh: {
    // ── 总面板导航 ──
    masterTitle: '猫姬控制台',
    navChat: '对话', navSing: '翻唱', navTts: '语音合成', navAction: '动作', navAi: 'AI 设置',
    navChatTitle: 'AI 对话', navSingTitle: '翻唱面板', navTtsTitle: '文本转语音',
    navActionTitle: '动作面板', navAiTitle: 'AI 设置',
    btnMax: '最大化', btnRestore: '还原', btnQuit: '退出桌宠',
    // ── 托盘 ──
    trayTip: '猫姬桌宠', trayShow: '显示总面板', trayQuit: '退出桌宠',
    // ── 聊天 ──
    chatTitle: '猫姬对话', chatPlaceholder: '说点什么喵…', btnSend: '发送',
    roleMe: '你', rolePet: '猫姬',
    tbMuteOn: '静音中：arc 不说话（翻唱不受影响）',
    tbMuteOff: '静音：点击让 arc 不说话（翻唱不受影响）',
    searchTitleOn: '联网搜索：开（最新/实时问题自动搜索）',
    searchTitleOff: '联网搜索：关（点击开启）',
    bubbleTitle: '气泡显示设置（字号/文字颜色）',
    bsSize: '气泡字号',
    bsColor: '文字颜色', colorPickTitle: '选择文字颜色',
    cacheTitleOn: '缓存：开（同问同答直接返回，点击关闭）',
    cacheTitleOff: '缓存：关（每次重新生成，点击开启）',
    cacheClearTitle: '清空回答缓存',
    statusThinking: '喵…思考中',
    statusNoCache: '喵…正在重新生成（已绕过缓存）',
    statusCleared: '已清空回答缓存',
    statusClearedN: '已清空回答缓存（${n} 条）',
    statusClearedBoth: '已清空 ${ai} 条回答缓存、${wav} 个语音缓存',
    statusGenerating: '生成语音中…',
    statusError: '出错了：',
    statusUnknown: '未知',
    statusSeparate: '正在分离人声…', statusConvert: '正在变声成喵声…', statusMix: '正在混音…',
    statusSinging: '翻唱中…',
    statusSingDone: '翻唱完成喵！',
    msgSingDone: '唱好啦喵！\n完整版：${full}\n人声轨：${vocal}',
    statusSingFail: '翻唱失败：',
    msgSingFail: '翻唱失败喵：',
    statusPlayingSing: '播放翻唱…',
    statusPaused: '已暂停',
    statusEnded: '播放结束',
    fallbackSingName: '翻唱',
    // ── 动作面板 ──
    actionTitle: '✦ 猫姬动作',
    cfgTitle: '动作设置', cfgRandom: '随机表演', cfgOn: '开', cfgOff: '关',
    cfgInterval: '表演间隔', cfgUnit: '秒', cfgLie: '趴下/站起', cfgReset: '重置动作',
    actFallback: '动作',
    // ── 桌面歌词 ──
    lyricNoLyric: '暂无歌词',
    lyricCloseTitle: '关闭歌词',
    lyricPrev: '上一首', lyricNext: '下一首', lyricToggle: '播放/暂停',
    lyricLockTitle: '锁定歌词：点击后鼠标穿透下层，歌词纯展示；再点解锁恢复操作',
    // ── TTS 面板 ──
    ttsTitle: '🎙 猫姬语音', secInput: '朗读文本',
    ttsPlaceholder: '输入想让猫姬朗读的文本…',
    secParam: '音色参数',
    presetV0: 'V0 基线', presetV1: 'V1 升1半音', presetV2: 'V2 升2半音',
    presetV3: 'V3 贴模型', presetV4: 'V4 组合',
    pF0: '音高偏移', unitSemitone: '半音', pIdx: '音色贴合', pVoice: '声线',
    voiceDefault: '随情绪默认',
    grpFemale: '女声', grpMale: '男声',
    vCalm: '沉稳', vWarm: '热情', vGentle: '温柔', vBright: '开朗', vDeep: '深沉', vMagnetic: '磁性',
    pEmotion: '情绪', pValence: '效价', pArousal: '活跃度',
    edgeSad: '难过', edgeHappy: '开心', edgeCalm: '平静', edgeIntense: '激烈',
    emoNeutral: '平静自然', emoHappy: '开心欢快', emoAngry: '生气', emoSad: '难过', emoSurprised: '惊讶',
    intensityFmt: '（强度 ${p}%）',
    chkApplyChat: '应用到聊天语音', chkApplySing: '应用到翻唱（音高/贴合）', chkMeowClips: '口癖用原版音频',
    secDisplay: '显示设置', pBubbleSize: '气泡字号', unitPx: 'px', pBubbleColor: '气泡颜色',
    bubbleColorHint: '文字主色', bubbleColorResetTitle: '恢复默认颜色（#ffd166）',
    btnGen: '生成语音',
    statusTtsGenerating: '正在生成语音…',
    statusTtsDone: '生成完成，正在播放喵！',
    statusTtsFail: '生成失败：',
    statusPlayFail: '播放失败：',
    historyHeadTts: '已生成', dirTitleTts: '打开语音文件夹',
    emptyTts: '还没有生成记录', playTitle: '播放',
    noLyricToShow: '暂无歌词可显示',
    // ── 翻唱面板 ──
    singTitle: '♪ 猫姬翻唱',
    dropHint: '拖拽音频文件到这里\n或点击选择文件',
    dropTitle: '拖拽音频文件到这里，或点击选择',
    chkLrc: '使用歌词文件', chkLrcNote: '（不勾选则自动联网搜索歌词）',
    lrcDropHint: '拖拽歌词文件（.lrc）到这里\n或点击选择',
    lrcDropTitle: '拖拽歌词文件（.lrc/.txt）到这里，或点击选择',
    btnStart: '开始翻唱',
    stepSep: '分离人声', stepCvt: '变声喵声', stepMix: '混音完成',
    pickedPrefix: '已选择：',
    statusSubmitted: '已提交，正在处理…',
    statusSingDonePlay: '翻唱完成，正在播放喵！',
    statusPlaying: '正在播放…',
    historyHeadSing: '已翻唱', dirTitleSing: '打开翻唱文件夹',
    emptySing: '还没有翻唱记录',
    lrcReadFail: '歌词文件读取失败：',
    volTitle: '翻唱音量', lyricColorLabel: '歌词颜色',
    lyricColorResetTitle: '恢复默认颜色（#ffd04d）',
    toggleTitle: '播放 / 暂停', lyricShowTitle: '显示桌面歌词',
    // ── AI 设置 ──
    aiTitle: '⚙ AI 设置',
    lblKey: '文本 API 密钥', lblModel: '文本生成模型', lblBase: '文本接口地址（Base URL）',
    lblTemp: '温度（0~2）', lblMax: '最大回复字数',
    lblPrompt: '角色提示词（system prompt）',
    secSearch: '联网搜索', lblSearchMode: '触发方式（总开关在对话窗 🌐）',
    optAuto: '智能判断（内置规则：疑问句+时效/信息词才搜索）',
    optAlways: '总是搜索（每条消息都联网检索）',
    optCustom: '自定义关键词（按下方填写的词触发）',
    lblSearchWords: '触发关键词（逗号分隔；问题含任一词即联网搜索）',
    searchWordsPh: '例如：今天天气, 最新, 价格, 新闻, 汇率',
    secProactive: '主动说话', lblProactive: '让桌宠定时主动找你搭话',
    lblInterval: '说话间隔（分钟，5~240）',
    lblProactivePrompt: '主动搭话指令（喂给 AI，可自定义）',
    proactivePh: '主动找人类搭一句话：简短一句，用猫姬人设，直接输出台词不要解释',
    secRandVoice: '随机发声', lblRandVoice: '偶尔用语音素材主动叫一声',
    lblRvMin: '最短间隔（分钟）', lblRvMax: '最长间隔（分钟）',
    secMute: '静音模式', lblMute: '让 arc 安静（AI 语音/随机发声静音，翻唱音乐不受影响）',
    secTts: '语音合成模型', lblTtsModel: '语音合成模型 ID',
    lblTtsKey: '语音 API 密钥', lblTtsBase: '语音接口地址',
    msgNoTtsKey: '请填写语音 API 密钥', msgNoTtsBase: '请填写语音接口地址',
    lblKbModel: '嵌入模型 ID', lblKbKey: '嵌入 API 密钥', lblKbBase: '嵌入接口地址',
    lblKbMode: '知识库触发方式', optKbAuto: '智能判断（内置词表：身份/口癖/招式/关系等才检索）',
    optKbAlways: '总是检索（每条消息都查知识库）', optKbCustom: '自定义关键词（按下方填写的词触发）',
    lblKbWords: '触发关键词（逗号分隔；问题含任一词即检索知识库）',
    btnTestKb: '测试嵌入模型', btnTestKbTitle: '用当前嵌入模型配置生成一句向量测试',
    msgNoKbConfig: '请填写嵌入模型/密钥/接口', msgKbTesting: '嵌入测试中…',
    msgKbOk: '嵌入测试成功（维度 {dim}，耗时 {ms} ms）', msgKbFail: '嵌入测试失败：',
    lblEdgeFallback: '指定模型失败时自动用免费兜底（Edge TTS / 系统语音）',
    btnTestCosy: '测试语音模型', btnTestEdge: '测试微软语音模型', btnTestEdgeTitle: '测试微软语音兜底链路（Edge TTS / 系统语音）',
    msgTtsOk: '测试成功（{used}），耗时 {ms} ms 喵！',
    msgTtsFail: '测试失败：', msgNoTtsModel: '请填写语音合成模型 ID（必填）',
    lblLang: '界面语言',
    btnTest: '测试文本模型', btnTesting: '测试中…', btnDefault: '恢复默认', btnTestTitle: '用当前文本生成配置发一条测试消息验证',
    btnProactiveNow: '立即说一句', btnSave: '保存',
    keyEyeTitle: '显示/隐藏密钥',
    msgNoModel: '请填写模型名称', msgNoBase: '请填写接口地址', msgNoKey: '请先填写 API 密钥',
    msgSaved: '已保存并生效喵！',
    msgSaveFail: '保存失败：',
    msgConnOk: '连接成功，猫姬回复：',
    msgConnFail: '连接失败：',
    msgProactiveDone: '已让猫姬开口喵（看桌宠气泡/听声音）',
    msgProactiveFail: '触发失败：',
    msgDefaultRestored: '提示词已恢复为猫姬默认人设',
    // ── 语音扩展包缺失 ──
    noVoiceMsg: '未安装语音扩展包：请将语音扩展包解压到桌宠程序根目录后重启',
    noVoiceTts: '未安装语音扩展包，语音合成不可用',
    noVoiceSing: '未安装语音扩展包，翻唱不可用',
    // ── 桌宠气泡（voice-ui 播放失败等提示）──
    bubblePlayFail: '播放失败喵：',
    bubbleSingFail: '翻唱播放失败喵（文件无法解码）',
    bubbleSingFailMsg: '翻唱播放失败喵：',
    bubbleSingAbnormal: '翻唱播放异常喵：',
    bubbleSingGenFail: '翻唱失败喵：',
    // ── 面板通用按钮 ──
    btnMin: '最小化', btnClose: '关闭',
    singOpenTitle: '打开翻唱面板',
    // ── TTS 面板（HTML/JS 键名）──
    ttsSecText: '朗读文本', ttsTextPh: '输入想让猫姬朗读的文本…',
    ttsSecVoice: '音色参数', ttsF0: '音高偏移', ttsSemitone: '半音',
    ttsIdx: '音色贴合', ttsVoice: '声线', voicePickTitle: '选择声线',
    voiceF: '女声', voiceM: '男声',
    vAnna: 'anna（沉稳）', vBella: 'bella（热情）', vClaire: 'claire（温柔）', vDiana: 'diana（开朗）',
    vAlex: 'alex（沉稳）', vBenjamin: 'benjamin（深沉）', vCharles: 'charles（磁性）', vDavid: 'david（开朗）',
    ttsEmotion: '情绪', ttsValence: '效价', ttsArousal: '活跃度',
    emoCalm: '平静', emoIntense: '激烈',
    emoIntensity: '（强度 ${p}%）',
    ttsApplyChat: '应用到聊天语音', ttsApplySing: '应用到翻唱（音高/贴合）', ttsMeow: '口癖用原版音频',
    ttsSecDisp: '显示设置', ttsBubbleSize: '气泡字号', ttsBubbleColor: '气泡颜色',
    bubbleColorReset: '恢复默认颜色（#ffd166）', ttsTextMain: '文字主色',
    ttsGen: '生成语音', ttsToggle: '播放 / 暂停', ttsLyric: '显示桌面歌词',
    progSeek: '拖动可跳转进度', ttsHistory: '已生成', ttsDir: '打开语音文件夹',
    ttsGenning: '正在生成语音…', ttsGenDone: '生成完成，正在播放喵！', ttsGenFail: '生成失败：',
    ttsEnded: '播放结束', ttsHistoryEmpty: '还没有生成记录',
    ttsPlay: '播放', ttsPlaying: '正在播放…', ttsPlayFail: '播放失败：',
    // ── 翻唱面板（HTML/JS 键名）──
    singDropTitle: '拖拽音频文件到这里，或点击选择',
    singDropHint: '拖拽音频文件到这里\n或点击选择文件',
    singUseLrc: '使用歌词文件', singUseLrcNote: '（不勾选则自动联网搜索歌词）',
    singLrcTitle: '拖拽歌词文件（.lrc/.txt）到这里，或点击选择',
    singLrcHint: '拖拽歌词文件（.lrc）到这里\n或点击选择',
    singStart: '开始翻唱', singToggle: '播放 / 暂停', singLyric: '显示桌面歌词',
    singVolume: '翻唱音量', lyricColorPick: '桌面歌词文本主色',
    singHistory: '已翻唱', singDir: '打开翻唱文件夹',
    singPicked: '已选择：', singSubmitted: '已提交，正在处理…',
    singStageSep: '正在分离人声…', singStageCvt: '正在变声成喵声…', singStageMix: '正在混音…',
    singStageRun: '翻唱中…', singDone: '翻唱完成，正在播放喵！', singFail: '翻唱失败：',
    singEnded: '播放结束', singLrcFail: '歌词文件读取失败：',
    singPlaying: '正在播放…', singHistoryEmpty: '还没有翻唱记录', singPlay: '播放',
    // ── 动作面板（HTML/JS 键名）──
    actTitle: '✦ 猫姬动作', actCfgTitle: '动作设置', actRandom: '随机表演',
    actInterval: '表演间隔', actSec: '秒', actLie: '趴下/站起', actReset: '重置动作',
    // ── AI 设置补充 ──
    msgNoAll: '请先填写密钥、接口地址和模型',
    // ── 语音升级（基础包）──
    btnUpgrade: '语音升级', upgradeTitle: '安装语音扩展包',
    upgradeDropHint: '拖拽 .zip 语音扩展包到这里，或点击选择文件', upgradeCancel: '取消',
    upgradeStage1: '正在解压语音脚本…', upgradeStage2: '脚本就绪，正在解压运行环境…',
    upgradeStage3: '运行环境就绪，收尾中…', upgradeStageDone: '安装完成，正在自动重启应用…',
    upgradeFail: '安装失败：',
    upgradeInvalid: '请选择 .zip 格式的语音扩展包', upgradeAlready: '已安装语音扩展包，无需重复安装',
    upgradeTitleInstalled: '语音扩展包管理', upgradeInstalled: '已安装语音扩展包，桌宠聊天/翻唱/语音合成功能可用',
    upgradeUninstall: '卸载语音扩展包',
    upgradeConfirmYes: '确认卸载',
    upgradeUninstallConfirm: '将删除语音引擎与运行环境，已生成的翻唱/语音文件会保留；卸载后需重启桌宠。确定继续吗？',
    buildBasic: '生成基础包', buildVoice: '生成语音扩展包',
    upgradeUninstalling: '正在卸载…完成将自动重启', upgradeUninstalled: '卸载完成，正在重启桌宠…',
    upgradeNotInstalled: '未安装语音扩展包', upgradeUninstallLocked: '卸载失败：语音引擎文件被占用。请稍候片刻后重试（确保没有正在进行的语音/翻唱任务）。',
  },
  en: {
    masterTitle: 'Neco Arc Console',
    navChat: 'Chat', navSing: 'Sing', navTts: 'TTS', navAction: 'Actions', navAi: 'AI Settings',
    navChatTitle: 'AI Chat', navSingTitle: 'Sing Panel', navTtsTitle: 'Text to Speech',
    navActionTitle: 'Actions Panel', navAiTitle: 'AI Settings',
    btnMax: 'Maximize', btnRestore: 'Restore', btnQuit: 'Quit Pet',
    trayTip: 'Neco Arc Pet', trayShow: 'Show Console', trayQuit: 'Quit Pet',
    chatTitle: 'Neco Arc Chat', chatPlaceholder: 'Say something meow…', btnSend: 'Send',
    roleMe: 'You', rolePet: 'Neco Arc',
    tbMuteOn: 'Muted: arc stays silent (singing unaffected)',
    tbMuteOff: 'Mute: click to silence arc (singing unaffected)',
    searchTitleOn: 'Web search: ON (auto for latest/real-time questions)',
    searchTitleOff: 'Web search: OFF (click to enable)',
    bubbleTitle: 'Bubble display settings (size / text color)',
    bsSize: 'Bubble size',
    bsColor: 'Text color', colorPickTitle: 'Pick text color',
    cacheTitleOn: 'Cache: ON (same question returns cached answer, click to disable)',
    cacheTitleOff: 'Cache: OFF (always regenerate, click to enable)',
    cacheClearTitle: 'Clear answer cache',
    statusThinking: 'Meow… thinking',
    statusNoCache: 'Meow… regenerating (bypassed cache)',
    statusCleared: 'Answer cache cleared',
    statusClearedN: 'Answer cache cleared (${n} entries)',
    statusClearedBoth: 'Cleared ${ai} answer entries and ${wav} voice caches',
    statusGenerating: 'Generating voice…',
    statusError: 'Error: ',
    statusUnknown: 'unknown',
    statusSeparate: 'Separating vocals…', statusConvert: 'Converting to meow voice…', statusMix: 'Mixing…',
    statusSinging: 'Singing…',
    statusSingDone: 'Song done, meow!',
    msgSingDone: 'Finished singing meow!\nFull: ${full}\nVocal: ${vocal}',
    statusSingFail: 'Singing failed: ',
    msgSingFail: 'Singing failed meow: ',
    statusPlayingSing: 'Playing song…',
    statusPaused: 'Paused',
    statusEnded: 'Playback ended',
    fallbackSingName: 'song',
    actionTitle: '✦ Neco Arc Actions',
    cfgTitle: 'Action Settings', cfgRandom: 'Random Acts', cfgOn: 'On', cfgOff: 'Off',
    cfgInterval: 'Act Interval', cfgUnit: 's', cfgLie: 'Lie / Stand', cfgReset: 'Reset Actions',
    actFallback: 'action',
    lyricNoLyric: 'No lyrics',
    lyricCloseTitle: 'Close lyrics',
    lyricPrev: 'Previous', lyricNext: 'Next', lyricToggle: 'Play / Pause',
    lyricLockTitle: 'Lock lyrics: click to pass mouse through (display only); click again to unlock',
    ttsTitle: '🎙 Neco Arc Voice', secInput: 'Text to Read',
    ttsPlaceholder: 'Type text for Neco Arc to read…',
    secParam: 'Voice Parameters',
    presetV0: 'V0 Baseline', presetV1: 'V1 +1 semitone', presetV2: 'V2 +2 semitones',
    presetV3: 'V3 Model-tight', presetV4: 'V4 Combo',
    pF0: 'Pitch Shift', unitSemitone: 'st', pIdx: 'Timbre Match', pVoice: 'Voice',
    voiceDefault: 'Auto by emotion',
    grpFemale: 'Female', grpMale: 'Male',
    vCalm: 'calm', vWarm: 'warm', vGentle: 'gentle', vBright: 'bright', vDeep: 'deep', vMagnetic: 'magnetic',
    pEmotion: 'Emotion', pValence: 'Valence', pArousal: 'Arousal',
    edgeSad: 'Sad', edgeHappy: 'Happy', edgeCalm: 'Calm', edgeIntense: 'Intense',
    emoNeutral: 'Neutral', emoHappy: 'Happy', emoAngry: 'Angry', emoSad: 'Sad', emoSurprised: 'Surprised',
    intensityFmt: '(intensity ${p}%)',
    chkApplyChat: 'Apply to chat voice', chkApplySing: 'Apply to singing (pitch/timbre)', chkMeowClips: 'Use original audio for catchphrases',
    secDisplay: 'Display Settings', pBubbleSize: 'Bubble Font Size', unitPx: 'px', pBubbleColor: 'Bubble Color',
    bubbleColorHint: 'text color', bubbleColorResetTitle: 'Reset to default (#ffd166)',
    btnGen: 'Generate Voice',
    statusTtsGenerating: 'Generating voice…',
    statusTtsDone: 'Done, playing meow!',
    statusTtsFail: 'Generation failed: ',
    statusPlayFail: 'Playback failed: ',
    historyHeadTts: 'Generated', dirTitleTts: 'Open voice folder',
    emptyTts: 'No generated clips yet', playTitle: 'Play',
    noLyricToShow: 'No lyrics to show',
    singTitle: '♪ Neco Arc Sing',
    dropHint: 'Drag audio file here\nor click to pick',
    dropTitle: 'Drag audio file here, or click to pick',
    chkLrc: 'Use lyric file', chkLrcNote: '(unchecked = auto search lyrics online)',
    lrcDropHint: 'Drag lyric file (.lrc) here\nor click to pick',
    lrcDropTitle: 'Drag lyric file (.lrc/.txt) here, or click to pick',
    btnStart: 'Start Singing',
    stepSep: 'Separate Vocals', stepCvt: 'Convert to Meow', stepMix: 'Mix Done',
    pickedPrefix: 'Picked: ',
    statusSubmitted: 'Submitted, processing…',
    statusSingDonePlay: 'Done, playing meow!',
    statusPlaying: 'Playing…',
    historyHeadSing: 'Sung', dirTitleSing: 'Open singing folder',
    emptySing: 'No singing history yet',
    lrcReadFail: 'Failed to read lyric file: ',
    volTitle: 'Singing Volume', lyricColorLabel: 'Lyric Color',
    lyricColorResetTitle: 'Reset to default (#ffd04d)',
    toggleTitle: 'Play / Pause', lyricShowTitle: 'Show desktop lyrics',
    aiTitle: '⚙ AI Settings',
    lblKey: 'Text API Key', lblModel: 'Text Gen. Model', lblBase: 'Text Base URL',
    lblTemp: 'Temperature (0~2)', lblMax: 'Max Reply Length',
    lblPrompt: 'System Prompt',
    secSearch: 'Web Search', lblSearchMode: 'Trigger mode (master switch in Chat 🌐)',
    optAuto: 'Smart (built-in rules: questions + time/info words)',
    optAlways: 'Always search (every message)',
    optCustom: 'Custom keywords (trigger by words below)',
    lblSearchWords: 'Trigger keywords (comma separated; any match triggers search)',
    searchWordsPh: 'e.g. weather, latest, price, news, rate',
    secProactive: 'Proactive Chat', lblProactive: 'Pet chats you on a timer',
    lblInterval: 'Interval (minutes, 5~240)',
    lblProactivePrompt: 'Proactive prompt (fed to AI, customizable)',
    proactivePh: 'Say one line to a human: short, in Neco Arc persona, output the line only',
    secRandVoice: 'Random Voice', lblRandVoice: 'Occasionally speak with voice clips',
    lblRvMin: 'Min interval (min)', lblRvMax: 'Max interval (min)',
    secMute: 'Mute Mode', lblMute: 'Silence arc (AI voice/random voice muted; music unaffected)',
    secTts: 'Voice Model', lblTtsModel: 'Voice Model ID',
    lblTtsKey: 'Voice API Key', lblTtsBase: 'Voice Base URL',
    msgNoTtsKey: 'Please enter the voice API key', msgNoTtsBase: 'Please enter the voice base URL',
    lblKbModel: 'Embedding Model ID', lblKbKey: 'Embedding API Key', lblKbBase: 'Embedding Base URL',
    lblKbMode: 'Knowledge Base Trigger', optKbAuto: 'Smart (built-in words: identity / catchphrase / moves / relations…)',
    optKbAlways: 'Always (search KB for every message)', optKbCustom: 'Custom keywords (listed below trigger the KB)',
    lblKbWords: 'Trigger keywords (comma separated; any word present triggers KB search)',
    btnTestKb: 'Test Embedding', btnTestKbTitle: 'Generate one embedding vector with current config',
    msgNoKbConfig: 'Please fill in embedding model/key/base URL', msgKbTesting: 'Testing embedding…',
    msgKbOk: 'Embedding OK (dim {dim}, {ms} ms)', msgKbFail: 'Embedding test failed: ',
    lblEdgeFallback: 'Auto-fallback to free TTS (Edge TTS / system voice) when the model fails',
    btnTestCosy: 'Test Voice Model', btnTestEdge: 'Test Microsoft Voice', btnTestEdgeTitle: 'Test Microsoft voice fallback (Edge TTS / system voice)',
    msgTtsOk: 'Test OK ({used}), took {ms} ms meow!',
    msgTtsFail: 'Test failed: ', msgNoTtsModel: 'Please enter a voice model ID (required)',
    lblLang: 'Language',
    btnTest: 'Test Text Model', btnTesting: 'Testing…', btnDefault: 'Restore Default', btnTestTitle: 'Send a test message with current text-gen settings',
    btnProactiveNow: 'Speak Now', btnSave: 'Save',
    keyEyeTitle: 'Show / hide key',
    msgNoModel: 'Please fill in the model', msgNoBase: 'Please fill in the API URL', msgNoKey: 'Please fill in the API key',
    msgSaved: 'Saved & applied meow!',
    msgSaveFail: 'Save failed: ',
    msgConnOk: 'Connected, Neco Arc says: ',
    msgConnFail: 'Connection failed: ',
    msgProactiveDone: 'Neco Arc spoke meow (see bubble/voice)',
    msgProactiveFail: 'Trigger failed: ',
    msgDefaultRestored: 'Prompt restored to default Neco Arc persona',
    noVoiceMsg: 'Voice pack not installed: extract the voice pack to the app folder and restart',
    noVoiceTts: 'Voice pack not installed, TTS unavailable',
    noVoiceSing: 'Voice pack not installed, singing unavailable',
    bubblePlayFail: 'Playback failed meow: ',
    bubbleSingFail: 'Song playback failed meow (file undecodable)',
    bubbleSingFailMsg: 'Song playback failed meow: ',
    bubbleSingAbnormal: 'Song playback error meow: ',
    bubbleSingGenFail: 'Singing failed meow: ',
    // ── 面板通用按钮 ──
    btnMin: 'Minimize', btnClose: 'Close',
    singOpenTitle: 'Open Sing Panel',
    // ── TTS 面板（HTML/JS 键名）──
    ttsSecText: 'Text to Read', ttsTextPh: 'Type text for Neco Arc to read…',
    ttsSecVoice: 'Voice Parameters', ttsF0: 'Pitch Shift', ttsSemitone: 'st',
    ttsIdx: 'Timbre Match', ttsVoice: 'Voice', voicePickTitle: 'Select voice',
    voiceF: 'Female', voiceM: 'Male',
    vAnna: 'anna (calm)', vBella: 'bella (warm)', vClaire: 'claire (gentle)', vDiana: 'diana (bright)',
    vAlex: 'alex (calm)', vBenjamin: 'benjamin (deep)', vCharles: 'charles (magnetic)', vDavid: 'david (bright)',
    ttsEmotion: 'Emotion', ttsValence: 'Valence', ttsArousal: 'Arousal',
    emoCalm: 'Calm', emoIntense: 'Intense',
    emoIntensity: '(intensity ${p}%)',
    ttsApplyChat: 'Apply to chat voice', ttsApplySing: 'Apply to singing (pitch/timbre)', ttsMeow: 'Use original audio for catchphrases',
    ttsSecDisp: 'Display Settings', ttsBubbleSize: 'Bubble Font Size', ttsBubbleColor: 'Bubble Color',
    bubbleColorReset: 'Reset to default (#ffd166)', ttsTextMain: 'text color',
    ttsGen: 'Generate Voice', ttsToggle: 'Play / Pause', ttsLyric: 'Show desktop lyrics',
    progSeek: 'Drag to seek', ttsHistory: 'Generated', ttsDir: 'Open voice folder',
    ttsGenning: 'Generating voice…', ttsGenDone: 'Done, playing meow!', ttsGenFail: 'Generation failed: ',
    ttsEnded: 'Playback ended', ttsHistoryEmpty: 'No generated clips yet',
    ttsPlay: 'Play', ttsPlaying: 'Playing…', ttsPlayFail: 'Playback failed: ',
    // ── 翻唱面板（HTML/JS 键名）──
    singDropTitle: 'Drag audio file here, or click to pick',
    singDropHint: 'Drag audio file here\nor click to pick',
    singUseLrc: 'Use lyric file', singUseLrcNote: '(unchecked = auto search lyrics online)',
    singLrcTitle: 'Drag lyric file (.lrc/.txt) here, or click to pick',
    singLrcHint: 'Drag lyric file (.lrc) here\nor click to pick',
    singStart: 'Start Singing', singToggle: 'Play / Pause', singLyric: 'Show desktop lyrics',
    singVolume: 'Singing Volume', lyricColorPick: 'Desktop lyric text color',
    singHistory: 'Sung', singDir: 'Open singing folder',
    singPicked: 'Picked: ', singSubmitted: 'Submitted, processing…',
    singStageSep: 'Separating vocals…', singStageCvt: 'Converting to meow voice…', singStageMix: 'Mixing…',
    singStageRun: 'Singing…', singDone: 'Done, playing meow!', singFail: 'Singing failed: ',
    singEnded: 'Playback ended', singLrcFail: 'Failed to read lyric file: ',
    singPlaying: 'Playing…', singHistoryEmpty: 'No singing history yet', singPlay: 'Play',
    // ── 动作面板（HTML/JS 键名）──
    actTitle: '✦ Neco Arc Actions', actCfgTitle: 'Action Settings', actRandom: 'Random Acts',
    actInterval: 'Act Interval', actSec: 's', actLie: 'Lie / Stand', actReset: 'Reset Actions',
    // ── AI 设置补充 ──
    msgNoAll: 'Please fill in the API key, URL and model',
    // ── 语音升级（基础包）──
    btnUpgrade: 'Voice Upgrade', upgradeTitle: 'Install Voice Pack',
    upgradeDropHint: 'Drag a .zip voice pack here, or click to select a file', upgradeCancel: 'Cancel',
    upgradeStage1: 'Extracting voice scripts…', upgradeStage2: 'Scripts ready, extracting runtime…',
    upgradeStage3: 'Runtime ready, finishing…', upgradeStageDone: 'Installed! Restarting app…',
    upgradeFail: 'Install failed: ',
    upgradeInvalid: 'Please select a .zip voice pack', upgradeAlready: 'Voice pack already installed',
    upgradeTitleInstalled: 'Voice Pack Manager', upgradeInstalled: 'Voice pack installed. Chat TTS / cover singing are available.',
    upgradeUninstall: 'Uninstall Voice Pack',
    upgradeConfirmYes: 'Uninstall',
    upgradeUninstallConfirm: 'This will remove the voice engine and runtime; your generated cover / TTS files will be kept. The app will restart. Continue?',
    buildBasic: 'Build Base Pack', buildVoice: 'Build Voice Pack',
    upgradeUninstalling: 'Uninstalling… app will restart when done', upgradeUninstalled: 'Uninstalled! Restarting app…',
    upgradeNotInstalled: 'Voice pack not installed', upgradeUninstallLocked: 'Uninstall failed: voice engine files are in use. Please wait a moment and retry (make sure no voice / cover task is running).',
  },
};

function readUserConfig() {
  try {
    const p = path.join(getAssetRoot(), 'user-config.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return {};
  }
}
function getLang() {
  const c = readUserConfig();
  return c && c.lang === 'en' ? 'en' : 'zh';
}
function setLang(lang) {
  const p = path.join(getAssetRoot(), 'user-config.json');
  const c = readUserConfig();
  c.lang = lang === 'en' ? 'en' : 'zh';
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(c, null, 2), 'utf8');
  } catch (e) {
    console.error('[i18n] 语言配置写入失败:', e.message);
  }
}
function t(key, lang) {
  const l = lang || getLang();
  const v = DICT[l] && DICT[l][key];
  if (v != null) return v;
  const z = DICT.zh && DICT.zh[key];
  return z != null ? z : key;
}
// 模板插值：tFmt('key', {n: 3})
function tFmt(key, vars, lang) {
  let s = t(key, lang);
  if (vars) for (const k of Object.keys(vars)) s = s.split('${' + k + '}').join(String(vars[k]));
  return s;
}

// 广播语言变更到全部窗口（BrowserWindow + 总面板内全部 WebContentsView）
function broadcastI18nChange() {
  const lang = getLang();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents) {
      try { w.webContents.send('i18n-change', lang); } catch (e) {}
    }
  }
  try {
    const { getAllViewContents } = require('./master-panel');
    for (const wc of getAllViewContents()) {
      if (wc && !wc.isDestroyed()) {
        try { wc.send('i18n-change', lang); } catch (e) {}
      }
    }
  } catch (e) {}
}

function registerI18nIpc(onLangChange) {
  ipcMain.handle('i18n-get', () => ({ lang: getLang(), dict: DICT }));
  ipcMain.on('i18n-set-lang', (_e, lang) => {
    setLang(lang);
    broadcastI18nChange();
    if (typeof onLangChange === 'function') {
      try { onLangChange(getLang()); } catch (e) {}
    }
  });
}

module.exports = { DICT, getLang, setLang, t, tFmt, broadcastI18nChange, registerI18nIpc };
