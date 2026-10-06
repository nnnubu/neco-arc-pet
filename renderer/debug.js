/* 渲染进程 - 调试序列模块
 * 仅在 PET_DEBUG=1 启动时运行：自动抽帧验证 待机/走路/跑步/动作/缩放
 * 产出 debug-*.png 截图，供开发期核对动画表现，正常运行不执行。
 */
window.DebugSeq = (() => {
  async function run(sprite, shared) {
    const shot = (name) => window.pet.debugShot(name);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    sprite.setNoRandom(true); // 禁用随机乱跑/动作，保证序列确定性
    await wait(2500);
    await shot('idle');

    // 走路循环衔接验证：按住右键 2 秒抽 3 帧，步态应连续变化（无跳回首帧突兀）
    window.pet.moveBy(-700, 0);
    await wait(300);
    shared.keys.right = true;
    await wait(700);
    await shot('walk-a');
    await wait(600);
    await shot('walk-b');
    await wait(700);
    await shot('walk-c');
    shared.keys.right = false;
    await wait(400);
    await shot('walk-stop');    // 抬键回待机（朝右站立）

    // 向左走停：站立应朝左（验证移动后朝向跟随）
    shared.keys.left = true;
    await wait(800);
    shared.keys.left = false;
    await wait(400);
    await shot('walk-stop-left');

    // Shift 跑步循环验证：按住 3.5 秒抽 8 帧，循环内应只有跑姿帧（无起跑/收尾/站立帧）
    shared.keys.right = true;
    shared.keys.shift = true;
    await wait(500);
    await shot('run-1');
    await wait(400);
    await shot('run-2');
    await wait(400);
    await shot('run-3');
    await wait(400);
    await shot('run-4');
    await wait(400);
    await shot('run-5');
    await wait(400);
    await shot('run-6');
    await wait(400);
    await shot('run-7');
    await wait(500);
    await shot('run-8');
    shared.keys.shift = false;
    shared.keys.right = false;
    await wait(400);

    // 时长验证：思考基准 9 轮 ≈ 3 秒（1.5s 时仍在播，3.7s 时应回待机）
    sprite.playOneshot('thinking');
    await wait(1500);
    await shot('think-mid');
    await wait(2200);
    await shot('think-done');

    // 后空翻 4 轮 ≈ 3 秒（暂跳过：backflip 播放会让调试序列中断，待单独排查）
    // sprite.playOneshot('backflip');
    // await wait(1500);
    // await shot('backflip-mid');
    // await wait(2200);
    // await shot('backflip-done');

    // 新表情动作验证：逐个播放并抽帧（确认 gif 帧序列可加载、播放正常）
    for (const a of ['smug', 'tongue', 'push', 'star', 'pose1', 'hide', 'pout', 'lie']) {
      sprite.playOneshot(a);
      await wait(550);
      await shot('act-' + a);
    }

    // 转身验证：朝右 → 转身朝左（抽转身过渡帧 + 完成后朝左站立）→ 转身回朝右
    // 注意：lie 是重复 3 遍的动作（约 2 秒），需等它完全播完回到待机再测转身
    await wait(2200);
    sprite.turnTo(-1);
    await wait(300);
    await shot('turn-mid');
    await wait(1000);
    window.pet.debugLog('facing after turn_left = ' + sprite.facing + ' state=' + sprite.state + ' name=' + (sprite.currentName || '?'));
    await shot('turn-left-done');
    // 朝左站立时的一次性动作应翻转朝向
    sprite.playOneshot('smug');
    await wait(550);
    await shot('act-left-smug');
    await wait(2800); // smug 播完 + 2s 尾帧保持，回到待机
    sprite.turnTo(1);
    await wait(1200);
    window.pet.debugLog('facing after turn_right = ' + sprite.facing);
    await shot('turn-right-done');
    // 朝右站立时的一次性动作保持正常朝向
    sprite.playOneshot('smug');
    await wait(550);
    await shot('act-right-smug');
    await wait(2800);
    await wait(300);

    // 缩放验证：1.5 倍后抽帧确认窗口与精灵渲染正常，再恢复
    window.pet.setScale(1.5);
    await wait(800);
    window.pet.debugLog('inner after 1.5x = ' + window.innerWidth + 'x' + window.innerHeight);
    await shot('scale-15');
    window.pet.setScale(1);
    await wait(800);
    await shot('scale-10');

    // 输入框验证：打开语音条抽帧（小窗口不溢出、样式正常）
    window.VoiceUI.open();
    await wait(300);
    await shot('speakbar');
    window.VoiceUI.hide();
    console.log('[debug] sequence done');
  }
  return { run };
})();
