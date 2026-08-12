import { describe, it, expect, vi } from 'vitest';
import { importDiagramFromImage, applyScanResultToEditor } from '../public/js/scanner.js';
import { drawScannerErrors } from '../public/js/ui-scanner.js';
import { setScannerErrors } from '../public/js/state.js';

vi.mock('../public/js/render-bus.js', () => ({
    repaintCurrentMode: vi.fn(),
    recomputePreservingRefine: vi.fn(),
}));
vi.mock('../public/js/ui-modals.js', () => ({
    openZoomModal: vi.fn(),
    syncZoomCanvas: vi.fn(),
}));

describe('importDiagramFromImage (颜色匹配)', () => {
    it('空 grid 返回 fatal', async () => {
        const img = { width: 100, height: 60, data: new Uint8ClampedArray(100 * 60 * 4).fill(255) };
        const r = await importDiagramFromImage(img, null);
        expect(r.ok).toBe(false);
        expect(r.fatal).toBeDefined();
    });

    it('正常输入返回 ok=true 与 cells/errors/warnings', async () => {
        const img = { width: 100, height: 60, data: new Uint8ClampedArray(100 * 60 * 4).fill(255) };
        const grid = { rows: 3, cols: 5, cellSize: 20, origin: { x: 10, y: 10 }, confidence: 0.9 };
        const r = await importDiagramFromImage(img, grid);
        expect(r.ok).toBe(true);
        expect(r.cells.length).toBe(3);
        expect(r.cells[0].length).toBe(5);
        expect(Array.isArray(r.errors)).toBe(true);
        expect(Array.isArray(r.warnings)).toBe(true);
    });

    it('全白图 → 所有 cell 识别成 T01 (MARD 白色)', async () => {
        const img = { width: 100, height: 60, data: new Uint8ClampedArray(100 * 60 * 4).fill(255) };
        const grid = { rows: 3, cols: 5, cellSize: 20, origin: { x: 10, y: 10 }, confidence: 0.9 };
        const r = await importDiagramFromImage(img, grid);
        expect(r.ok).toBe(true);
        const allT01 = r.cells.flat().every((c) => c.code === 'T01' && !c.transparent);
        expect(allT01).toBe(true);
    });
});

describe('applyScanResultToEditor', () => {
    it('把 code 反查 palette 写入 lastMergedGrid', () => {
        const result = {
            ok: true,
            cells: [[{ code: 'A01', transparent: false, confidence: 1 }]],
            errors: [],
            warnings: [],
        };
        expect(() => applyScanResultToEditor(result)).not.toThrow();
    });

    it('transparent cell 不抛', () => {
        const result = {
            ok: true,
            cells: [[{ code: null, transparent: true, confidence: 0 }]],
            errors: [],
            warnings: [],
        };
        expect(() => applyScanResultToEditor(result)).not.toThrow();
    });

    it('errors 写入 scannerErrors', () => {
        const result = {
            ok: true,
            cells: [[{ code: null, transparent: true, confidence: 0 }]],
            errors: [{ row: 0, col: 0, reason: 'color_mismatch' }],
            warnings: [],
        };
        expect(() => applyScanResultToEditor(result)).not.toThrow();
    });

    it('非 ok 结果不抛也不写状态', () => {
        expect(() => applyScanResultToEditor({ ok: false, fatal: 'test' })).not.toThrow();
        expect(() => applyScanResultToEditor(null)).not.toThrow();
    });
});

function makeSpyCtx() {
    const calls = [];
    return {
        calls,
        strokeStyle: '',
        lineWidth: 0,
        strokeRect: (x, y, w, h) => calls.push({ type: 'strokeRect', x, y, w, h }),
    };
}

describe('drawScannerErrors', () => {
    it('对每个 error 画一个 strokeRect', () => {
        setScannerErrors([
            { row: 0, col: 1, reason: 'color_mismatch' },
            { row: 2, col: 3, reason: 'color_mismatch' },
        ]);
        const ctx = makeSpyCtx();
        drawScannerErrors(ctx, 20);
        expect(ctx.calls.length).toBe(2);
        expect(ctx.calls[0]).toMatchObject({ x: 20, y: 0, w: 20, h: 20 });
        expect(ctx.calls[1]).toMatchObject({ x: 60, y: 40, w: 20, h: 20 });
    });

    it('空 errors 不画', () => {
        setScannerErrors([]);
        const ctx = makeSpyCtx();
        drawScannerErrors(ctx, 20);
        expect(ctx.calls.length).toBe(0);
    });

    it('使用红色 stroke 与 2px lineWidth', () => {
        setScannerErrors([{ row: 0, col: 0, reason: 'x' }]);
        const ctx = makeSpyCtx();
        drawScannerErrors(ctx, 20);
        expect(['#FF0000', 'red', '#f00']).toContain(ctx.strokeStyle);
        expect(ctx.lineWidth).toBe(2);
    });
});