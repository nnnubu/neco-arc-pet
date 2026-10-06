/* 渲染进程 - 调试序列模块
 * 仅在 PET_DEBUG=1 启动时运行：自动抽帧验证 待机/走路/跑步/动作/缩放
 * 产出 debug-*.png 截图，供开发期核对动画表现，正常运行不执行。
 */
window.DebugSeq = (() => {
  async function run(sprite, shared) {
    const shot = (name) => window.pet.debugShot(name);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
    await shot('walk-stop');    // 抬键回待机

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

    // 后空翻 4 轮 ≈ 3 秒
    sprite.playOneshot('backflip');
    await wait(1500);
    await shot('backflip-mid');
    await wait(2200);
    await shot('backflip-done');

    // 新表情动作验证：逐个播放并抽帧（确认 gif 帧序列可加载、播放正常）
    for (const a of ['smug', 'tongue', 'push', 'star', 'pose1', 'hide', 'pout', 'lie']) {
      sprite.playOneshot(a);
      await wait(550);
      await shot('act-' + a);
    }

    // 缩放验证：1.5 倍后抽帧确认窗口与精灵渲染正常，再恢复
    window.pet.setScale(1.5);
    await wait(800);
    window.pet.debugLog('inner after 1.5x = ' + window.innerWidth + 'x' + window.innerHeight);
    await shot('scale-15');
    window.pet.setScale(1);
    await wait(800);
    await shot('scale-10');
    console.log('[debug] sequence done');
  }
  return { run };
})();
