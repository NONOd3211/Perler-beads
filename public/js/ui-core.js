// js/ui-core.js — DOM 元素引用收集 + attachCore 入口
// 职责:把 document.getElementById/querySelectorAll 的引用收集到 dom refs,
//       初始化 palette / tempCanvas / tempCtx 默认值
// 不注册任何事件 — 各 ui-* 模块在 attachCore 后自行 register

import { BeadPalettes } from './palettes.js';
import { attachDomRefs, setPalette, setTempCtx } from './state.js';

export function attachCore(win = window) {
    const domRefs = {
        fileInput: win.document.getElementById('fileInput'),
        originalImage: win.document.getElementById('originalImage'),
        perlerCanvas: win.document.getElementById('perlerCanvas'),
        exportCanvas: win.document.getElementById('exportCanvas'),
        downloadButton: win.document.getElementById('downloadButton'),
        resetButton: win.document.getElementById('resetButton'),
        fileInfo: win.document.getElementById('fileInfo'),
        originalInfo: win.document.getElementById('originalInfo'),
        perlerInfo: win.document.getElementById('perlerInfo'),
        densityOptions: win.document.querySelectorAll('input[name="density"]'),
        paletteOptions: win.document.querySelectorAll('input[name="palette"]'),
        colorListButton: win.document.getElementById('colorListButton'),
        colorListModal: win.document.getElementById('colorListModal'),
        colorListContent: win.document.getElementById('colorListContent'),
        loadingOverlay: win.document.getElementById('loadingOverlay'),
        loadingProgress: win.document.getElementById('loadingProgress'),
        fusedPreviewZoomButton: win.document.getElementById('fusedPreviewZoomButton'),
        zoomModal: win.document.getElementById('zoomModal'),
        zoomCanvas: win.document.getElementById('zoomCanvas'),
        zoomModeLabel: win.document.getElementById('zoomModeLabel'),
        zoomModeToggleButton: win.document.getElementById('zoomModeToggleButton'),
        closeZoom: win.document.getElementById('closeZoom'),
        canvasFrame: win.document.querySelector('.canvas-frame'),
        editorModal: win.document.getElementById('editorModal'),
        editorCurrentCode: win.document.getElementById('editorCurrentCode'),
        editorCurrentSwatch: win.document.getElementById('editorCurrentSwatch'),
        editorSimilarGrid: win.document.getElementById('editorSimilarGrid'),
        editorRecentGrid: win.document.getElementById('editorRecentGrid'),
        editorCodeInput: win.document.getElementById('editorCodeInput'),
        editorCodeError: win.document.getElementById('editorCodeError'),
        editorCodeSubmit: win.document.getElementById('editorCodeSubmit'),
        editorCancel: win.document.getElementById('editorCancel'),
        pixelationModeSelect: win.document.getElementById('pixelationModeSelect'),
        mergeSlider: win.document.getElementById('mergeSlider'),
        mergeValue: win.document.getElementById('mergeValue'),
        closeColorList: win.document.getElementById('closeColorList'),
        fuseEffectOptionButtons: win.document.querySelectorAll('.fuse-effect-option'),
    };
    attachDomRefs(domRefs);

    // 初始化 palette 默认值(MARD 单品牌)
    setPalette(BeadPalettes.p221, 221);

    // 初始化 tempCanvas / tempCtx(隐藏 canvas,只在内存中)
    const tempCanvasEl = win.document.createElement('canvas');
    const tempCtxInstance = tempCanvasEl.getContext('2d');
    setTempCtx(tempCanvasEl, tempCtxInstance);
}
