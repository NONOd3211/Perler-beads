// js/ui-fuse.js — fuseEffect 状态机(plain / towel)事件 attach
import {
    dom as stateDom,
    fuseEffect,
    setFuseEffect,
    currentMode,
    lastMergedGrid,
    repaintCurrentMode,
} from './state.js';

export function syncFuseEffectButtons() {
    const buttons = stateDom && stateDom.fuseEffectOptionButtons; // 已在 attachCore 时 querySelectorAll
    if (!buttons) return;
    buttons.forEach(function (b) {
        if (b.getAttribute('data-effect') === fuseEffect) {
            b.classList.add('active-effect');
        } else {
            b.classList.remove('active-effect');
        }
    });
}

export function syncFuseEffectDisabledState() {
    const buttons = stateDom && stateDom.fuseEffectOptionButtons;
    if (!buttons) return;
    const enabled = currentMode === 'fused';
    buttons.forEach(function (b) {
        b.disabled = !enabled;
        b.style.opacity = enabled ? '' : '0.4';
        b.style.cursor = enabled ? 'pointer' : 'not-allowed';
    });
}

export function attachFuseListeners() {
    const buttons = stateDom && stateDom.fuseEffectOptionButtons;
    if (!buttons) return;
    buttons.forEach(function (btn) {
        btn.addEventListener('click', async function () {
            if (!lastMergedGrid) return;
            if (currentMode !== 'fused') return;
            const effect = btn.getAttribute('data-effect');
            if (effect === fuseEffect) return;
            setFuseEffect(effect);
            buttons.forEach(function (b) {
                if (b.getAttribute('data-effect') === effect) {
                    b.classList.add('active-effect');
                } else {
                    b.classList.remove('active-effect');
                }
            });
            if (currentMode === 'fused') {
                repaintCurrentMode();
            }
            if (stateDom.zoomModal && stateDom.zoomModal.style.display === 'flex') {
                const { syncZoomCanvas } = await import('./ui-modals.js');
                syncZoomCanvas();
            }
        });
    });
}
