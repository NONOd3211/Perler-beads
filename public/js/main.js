// js/main.js — 浏览器入口串联
// 显式 import fuse-effects 触发注册(mutate BeadFuseEffects 单例)
import './fuse-effects/plain.js';
import './fuse-effects/towel.js';

import { attachCore } from './ui-core.js';
import { attachModeListeners } from './ui-mode.js';
import { attachFuseListeners } from './ui-fuse.js';
import { attachModalsListeners } from './ui-modals.js';
import { attachEventsListeners } from './ui-events.js';

// 浏览器环境守卫 — vitest jsdom 未加载 index.html,document.getElementById('fileInput') 为 null → 跳过
// 渲染调度(repaintCurrentMode / recomputePreservingRefine)现由 render-bus.js 静态提供,
// 不再需要 attach 时回填 setter。
if (typeof document !== 'undefined' && document.getElementById('fileInput')) {
    attachCore(window);
    attachModeListeners();
    attachFuseListeners();
    attachModalsListeners();
    attachEventsListeners();
}
