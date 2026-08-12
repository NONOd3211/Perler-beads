import { describe, it, expect } from 'vitest';
import { detectGrid } from '../public/js/scanner-grid-detect.js';

// 构造模拟真实拼豆图纸:带 #888 灰线网格 + 每格中心放暗色文字块
function makeDiagramImage({ cols, rows, cellSize, blockSize = 6 }) {
    const width = cols * cellSize;
    const height = rows * cellSize;
    // 白底
    const data = new Uint8ClampedArray(width * height * 4).fill(255);

    // 画 #888 灰线网格线(模拟 generate.js 的 drawGrid)
    const GRAY = 136; // #888 = rgb(136,136,136)
    // 竖线
    for (let c = 0; c <= cols; c++) {
        const x = c * cellSize;
        for (let y = 0; y < height; y++) {
            if (x < width) {
                const idx = (y * width + x) * 4;
                data[idx] = GRAY; data[idx + 1] = GRAY; data[idx + 2] = GRAY;
            }
        }
    }
    // 横线
    for (let r = 0; r <= rows; r++) {
        const y = r * cellSize;
        for (let x = 0; x < width; x++) {
            if (y < height) {
                const idx = (y * width + x) * 4;
                data[idx] = GRAY; data[idx + 1] = GRAY; data[idx + 2] = GRAY;
            }
        }
    }

    // 每格中心画暗色块(模拟色号文字)
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cx = c * cellSize + Math.floor(cellSize / 2) - Math.floor(blockSize / 2);
            const cy = r * cellSize + Math.floor(cellSize / 2) - Math.floor(blockSize / 2);
            for (let dy = 0; dy < blockSize; dy++) {
                for (let dx = 0; dx < blockSize; dx++) {
                    const x = cx + dx, y = cy + dy;
                    if (x < 0 || x >= width || y < 0 || y >= height) continue;
                    const idx = (y * width + x) * 4;
                    data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0;
                }
            }
        }
    }

    return { width, height, data };
}

// 仅暗色块、无灰线(触发回退算法)
function makePatternImage({ width, height, cellSize, blockSize = 6 }) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let r = 0; r * cellSize + blockSize < height; r++) {
        for (let c = 0; c * cellSize + blockSize < width; c++) {
            const cx = c * cellSize + Math.floor(cellSize / 2) - Math.floor(blockSize / 2);
            const cy = r * cellSize + Math.floor(cellSize / 2) - Math.floor(blockSize / 2);
            for (let dy = 0; dy < blockSize; dy++) {
                for (let dx = 0; dx < blockSize; dx++) {
                    const x = cx + dx, y = cy + dy;
                    if (x < 0 || x >= width || y < 0 || y >= height) continue;
                    const idx = (y * width + x) * 4;
                    data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0;
                }
            }
        }
    }
    return { width, height, data };
}

describe('detectGrid — 灰线网格图(主算法)', () => {
    it('29×29 格 cellSize=20 → 精确检测出 cellSize=20', () => {
        const img = makeDiagramImage({ cols: 29, rows: 29, cellSize: 20 });
        const g = detectGrid(img);
        expect(g.confidence).toBeGreaterThan(0.4);
        expect(g.cellSize).toBe(20);
        expect(g.cols).toBe(29);
        expect(g.rows).toBe(29);
    });

    it('15×20 格 cellSize=20 → 正确处理非正方形网格', () => {
        const img = makeDiagramImage({ cols: 15, rows: 20, cellSize: 20 });
        const g = detectGrid(img);
        expect(g.confidence).toBeGreaterThan(0.4);
        expect(g.cellSize).toBe(20);
        expect(g.cols).toBe(15);
        expect(g.rows).toBe(20);
    });

    it('50×50 格 cellSize=10 → 小 cellSize 也能检测', () => {
        const img = makeDiagramImage({ cols: 50, rows: 50, cellSize: 10, blockSize: 4 });
        const g = detectGrid(img);
        expect(g.confidence).toBeGreaterThan(0.4);
        expect(g.cellSize).toBe(10);
        expect(g.cols).toBe(50);
        expect(g.rows).toBe(50);
    });

    it('10×10 格 cellSize=30 → 大 cellSize 也能检测', () => {
        const img = makeDiagramImage({ cols: 10, rows: 10, cellSize: 30, blockSize: 8 });
        const g = detectGrid(img);
        expect(g.confidence).toBeGreaterThan(0.4);
        expect(g.cellSize).toBe(30);
        expect(g.cols).toBe(10);
        expect(g.rows).toBe(10);
    });

    it('origin 正确指向第一个 cell 的中心', () => {
        // 网格线从 x=0 画,第一条竖线在 x=0
        // cell(0,0) 中心 = cellSize/2 = 10
        const img = makeDiagramImage({ cols: 29, rows: 29, cellSize: 20 });
        const g = detectGrid(img);
        // firstLine=0, origin = firstLine + cellSize/2 = 0 + 10 = 10
        expect(g.origin.x).toBe(10);
        expect(g.origin.y).toBe(10);
    });
});

describe('detectGrid — 无灰线图(回退算法)', () => {
    it('纯暗色块图 580×580 cellSize=20 → 回退算法也能检测', () => {
        const img = makePatternImage({ width: 580, height: 580, cellSize: 20 });
        const g = detectGrid(img);
        expect(g.confidence).toBeGreaterThan(0.1);
        // 回退算法容差较大,cellSize 在 14-25 范围内可接受
        expect(g.cellSize).toBeGreaterThanOrEqual(14);
        expect(g.cellSize).toBeLessThanOrEqual(25);
    });

    it('小 cell 440×440 cellSize=4 → 回退算法检测', () => {
        const img = makePatternImage({ width: 440, height: 440, cellSize: 4, blockSize: 2 });
        const g = detectGrid(img);
        expect(g.confidence).toBeGreaterThan(0.1);
        expect(g.cellSize).toBeGreaterThanOrEqual(2);
        expect(g.cellSize).toBeLessThanOrEqual(8);
    });
});

describe('detectGrid — 边界情况', () => {
    it('全白图 → confidence < 0.3', () => {
        const img = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).fill(255) };
        const g = detectGrid(img);
        expect(g.confidence).toBeLessThan(0.3);
    });

    it('纯黑图 → confidence < 0.3', () => {
        const img = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).fill(0) };
        const g = detectGrid(img);
        expect(g.confidence).toBeLessThan(0.3);
    });

    it('太小的图(< 20px) → 返回零值', () => {
        const img = { width: 10, height: 10, data: new Uint8ClampedArray(10 * 10 * 4).fill(255) };
        const g = detectGrid(img);
        expect(g.rows).toBe(0);
        expect(g.cols).toBe(0);
        expect(g.cellSize).toBe(0);
    });

    it('仅有灰线无文字 → 仍能检测出 cellSize', () => {
        // 只有网格线,没有文字块
        const cols = 10, rows = 10, cellSize = 20;
        const width = cols * cellSize;
        const height = rows * cellSize;
        const data = new Uint8ClampedArray(width * height * 4).fill(255);
        const GRAY = 136;
        for (let c = 0; c <= cols; c++) {
            const x = c * cellSize;
            for (let y = 0; y < height; y++) {
                if (x < width) {
                    const idx = (y * width + x) * 4;
                    data[idx] = GRAY; data[idx + 1] = GRAY; data[idx + 2] = GRAY;
                }
            }
        }
        for (let r = 0; r <= rows; r++) {
            const y = r * cellSize;
            for (let x = 0; x < width; x++) {
                if (y < height) {
                    const idx = (y * width + x) * 4;
                    data[idx] = GRAY; data[idx + 1] = GRAY; data[idx + 2] = GRAY;
                }
            }
        }
        const g = detectGrid({ width, height, data });
        expect(g.cellSize).toBe(20);
        expect(g.cols).toBe(10);
        expect(g.rows).toBe(10);
    });
});
