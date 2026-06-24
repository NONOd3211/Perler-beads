// js/main.js — 浏览器入口串联
// 显式 import fuse-effects 触发注册(mutate BeadFuseEffects 单例)
import './fuse-effects/plain.js';
import './fuse-effects/towel.js';

import { attachCore } from './ui-core.js';
import { attachModeListeners } from './ui-mode.js';
import { attachFuseListeners } from './ui-fuse.js';
import { attachModalsListeners } from './ui-modals.js';
import { attachEventsListeners } from './ui-events.js';
import { setRepaintCurrentMode, setRecomputePreservingRefine } from './state.js';

// 浏览器环境守卫 — vitest jsdom 未加载 index.html,document.getElementById('fileInput') 为 null → 跳过
if (typeof document !== 'undefined' && document.getElementById('fileInput')) {
    attachCore(window);

    // 绑定 repaintCurrentMode 真实实现(避免 state.js 循环依赖)
    Promise.all([import('./generate.js'), import('./fused-preview.js')]).then(([gen, fused]) => {
        setRepaintCurrentMode(() => {
            // 通过 lazy getter 拿到 dom refs(避免 attach 时序问题)
            import('./state.js').then(
                ({
                    dom: stateDom,
                    lastMergedGrid,
                    lastGridCols,
                    lastGridRows,
                    lastCellSize,
                    currentBrand,
                    currentMode: cm,
                }) => {
                    if (cm === 'fused') {
                        fused.repaintFused();
                    } else if (lastMergedGrid) {
                        const ctx = stateDom.perlerCanvas.getContext('2d');
                        ctx.clearRect(
                            0,
                            0,
                            stateDom.perlerCanvas.width,
                            stateDom.perlerCanvas.height
                        );
                        gen.drawGrid(
                            ctx,
                            lastMergedGrid,
                            lastGridCols,
                            lastGridRows,
                            lastCellSize,
                            currentBrand
                        );
                    }
                }
            );
        });

        // 绑定 BeadRefine.recomputePreservingRefine 真实实现
        setRecomputePreservingRefine((kind) => {
            import('./state.js').then(
                ({
                    BeadRefine: _ignored,
                    lastMergedGrid: lmg,
                    lastPreMergeGrid: lpmg,
                    lastGridCols: cols,
                    lastGridRows: rows,
                    lastCellSize: cs,
                    mergeThreshold: mt,
                    currentBrand: cb,
                    dom: sd,
                }) => {
                    // 调用 color.js 函数
                    Promise.all([import('./color.js')]).then(([col]) => {
                        if (!lmg) {
                            gen.generatePerlerGrid();
                            return;
                        }
                        const ctx = sd.perlerCanvas.getContext('2d');
                        if (kind === 'brand') {
                            // 只切品牌,grid 数据不变,重画
                            ctx.clearRect(0, 0, sd.perlerCanvas.width, sd.perlerCanvas.height);
                            gen.drawGrid(ctx, lmg, cols, rows, cs, cb);
                            return;
                        }
                        if (kind === 'palette') {
                            // 每个 cell 重新映射到新 palette 的最近色
                            for (let r = 0; r < rows; r++) {
                                for (let c = 0; c < cols; c++) {
                                    const cell = lmg[r][c];
                                    if (cell.transparent) continue;
                                    lmg[r][c] = col.getClosestBeadColor(cell.r, cell.g, cell.b);
                                }
                            }
                            ctx.clearRect(0, 0, sd.perlerCanvas.width, sd.perlerCanvas.height);
                            gen.drawGrid(ctx, lmg, cols, rows, cs, cb);
                            return;
                        }
                        if (kind === 'threshold') {
                            if (!lpmg) {
                                gen.generatePerlerGrid();
                                return;
                            }
                            const remerged = col.mergeSimilarColors(lpmg, cols, rows, mt);
                            import('./state.js').then(({ setLastMergedGrid }) => {
                                setLastMergedGrid(remerged);
                                ctx.clearRect(0, 0, sd.perlerCanvas.width, sd.perlerCanvas.height);
                                gen.drawGrid(ctx, remerged, cols, rows, cs, cb);
                            });
                            return;
                        }
                        gen.generatePerlerGrid();
                    });
                }
            );
        });
    });

    attachModeListeners();
    attachFuseListeners();
    attachModalsListeners();
    attachEventsListeners();
}
