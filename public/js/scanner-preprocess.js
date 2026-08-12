// 按 grid 把图切成 cell。grid: {rows, cols, cellSize, origin:{x,y}}。
// 颜色匹配 pipeline 需要按 grid 切出每个 cell 取 RGB。
// 返回 { cells: ImageData[][], warnings: string[] }
export function splitGrid(imageData, grid) {
    const { rows, cols, cellSize, origin } = grid;
    // origin 是 cell(0, 0) 中心 → cell(0, 0) 左上角
    const gridX0 = origin.x - cellSize / 2;
    const gridY0 = origin.y - cellSize / 2;

    const warnings = [];
    if (cellSize < 3 || cellSize > 80) {
        warnings.push(`cell_size_out_of_range cellSize=${cellSize.toFixed(1)}`);
    }

    const { width: imgW, height: imgH, data } = imageData;
    const cells = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            const x0 = Math.round(gridX0 + c * cellSize);
            const y0 = Math.round(gridY0 + r * cellSize);
            const w = Math.round(cellSize);
            const h = Math.round(cellSize);
            const cellData = new Uint8ClampedArray(w * h * 4);
            for (let yy = 0; yy < h; yy++) {
                for (let xx = 0; xx < w; xx++) {
                    const srcX = x0 + xx;
                    const srcY = y0 + yy;
                    if (srcX < 0 || srcX >= imgW || srcY < 0 || srcY >= imgH) continue;
                    const srcIdx = (srcY * imgW + srcX) * 4;
                    const dstIdx = (yy * w + xx) * 4;
                    cellData[dstIdx] = data[srcIdx];
                    cellData[dstIdx + 1] = data[srcIdx + 1];
                    cellData[dstIdx + 2] = data[srcIdx + 2];
                    cellData[dstIdx + 3] = data[srcIdx + 3];
                }
            }
            row.push({ width: w, height: h, data: cellData });
        }
        cells.push(row);
    }
    return { cells, warnings };
}