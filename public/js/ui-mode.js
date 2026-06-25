// js/ui-mode.js — currentMode 状态机(grid ⇄ fused 切换)事件 attach
import {
    dom as stateDom,
    currentMode,
    lastMergedGrid,
    setMode,
} from './state.js';
import { repaintCurrentMode } from './render-bus.js';
import { syncFuseEffectDisabledState } from './ui-fuse.js';
import { syncZoomCanvas } from './ui-modals.js';

export function syncModeToggleButton() {
    const btn = stateDom.zoomModeToggleButton;
    if (!btn) return;
    if (currentMode === 'fused') {
        btn.classList.add('active-mode-fused');
    } else {
        btn.classList.remove('active-mode-fused');
    }
}

export function attachModeListeners() {
    const btn = stateDom.zoomModeToggleButton;
    if (!btn) return;

    btn.addEventListener('click', function () {
        if (!lastMergedGrid) return;
        setMode(currentMode === 'grid' ? 'fused' : 'grid');
        syncModeToggleButton();
        if (typeof syncFuseEffectDisabledState === 'function') syncFuseEffectDisabledState();
        repaintCurrentMode();
        if (typeof syncZoomCanvas === 'function' && stateDom.zoomModal.style.display === 'flex') {
            syncZoomCanvas();
        }
    });
}
