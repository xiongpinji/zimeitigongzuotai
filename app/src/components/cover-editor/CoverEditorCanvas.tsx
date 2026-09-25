import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  Canvas,
  FabricImage,
  Rect,
  Textbox,
  filters as fabricFilters,
} from 'fabric';
import styles from './CoverEditorCanvas.module.css';
import {
  createHistoryStack,
  type CoverEditorCanvasHandle,
} from '../../lib/cover-editor/fabric-bridge';
import {
  createEmptyEditState,
  normalizeEditState,
} from '../../lib/cover-editor/cover-edit-state';
import { getPresetAdjustments } from '../../lib/cover-editor/filters';
import { computeClipSize } from '../../lib/cover-editor/aspect-ratios';
import { toFileSrc } from '../../lib/utils';
import type {
  CoverEditState,
  CoverTextOverlay,
  FilterPreset,
} from '../../lib/cover-editor/contracts';

interface CoverEditorCanvasProps {
  imageUrl: string;
  initialEdits?: CoverEditState;
  initialAspectRatio: number | null;
  onChange?: (state: CoverEditState) => void;
  onTextSelectionChange?: (text: CoverTextOverlay | null) => void;
}

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;

export const CoverEditorCanvas = forwardRef<CoverEditorCanvasHandle, CoverEditorCanvasProps>(
  function CoverEditorCanvas(
    { imageUrl, initialEdits, initialAspectRatio, onChange, onTextSelectionChange },
    ref,
  ) {
    const containerRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const bgImageRef = useRef<FabricImage | null>(null);
    const history = useRef(createHistoryStack<string>(50));
    const ratioRef = useRef<number | null>(initialAspectRatio);
    const filterPresetRef = useRef<FilterPreset>(
      initialEdits?.filters?.preset ?? 'none',
    );
    const cropRectRef = useRef<Rect | null>(null);
    /** 当前被裁剪的目标图像对象（通常就是背景图） */
    const cropTargetRef = useRef<FabricImage | null>(null);
    /** 进入裁剪模式时暂存的 clipPath（比例预设），便于取消/应用后恢复 */
    const prevClipPathRef = useRef<Rect | undefined>(undefined);
    /** 裁剪模式下的锁定宽高比；null = 自由 */
    const cropAspectRef = useRef<number | null>(null);
    const onTextSelectionChangeRef = useRef(onTextSelectionChange);
    onTextSelectionChangeRef.current = onTextSelectionChange;

    useEffect(() => {
      if (!containerRef.current) return;
      const canvas = new Canvas(containerRef.current, {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        backgroundColor: '#111',
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      const cleanPath = imageUrl.split('?')[0];
      FabricImage.fromURL(toFileSrc(cleanPath), { crossOrigin: 'anonymous' }).then((img) => {
        if (!fabricRef.current) return;
        bgImageRef.current = img;
        const scale = Math.min(
          CANVAS_WIDTH / (img.width ?? CANVAS_WIDTH),
          CANVAS_HEIGHT / (img.height ?? CANVAS_HEIGHT),
        );
        img.scale(scale);
        img.set({
          left: (CANVAS_WIDTH - (img.width ?? 0) * scale) / 2,
          top: (CANVAS_HEIGHT - (img.height ?? 0) * scale) / 2,
          // 允许用户点击图片选中、移动、缩放（类 Photoshop 图层操作）
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          borderColor: 'rgba(10, 132, 255, 0.9)',
          cornerColor: '#0A84FF',
          cornerStyle: 'circle',
          cornerSize: 10,
          transparentCorners: false,
        });
        canvas.add(img);
        canvas.sendObjectToBack(img);
        applyClipPath(ratioRef.current);
        pushSnapshot();
        if (initialEdits) applyEditState(normalizeEditState(initialEdits));
        emitChange();
      });

      canvas.on('object:modified', () => {
        pushSnapshot();
        emitChange();
      });

      function reportSelection() {
        const active = canvas.getActiveObject();
        if (active && active.type === 'textbox') {
          onTextSelectionChangeRef.current?.(textboxToOverlay(active as Textbox));
        } else {
          onTextSelectionChangeRef.current?.(null);
        }
      }

      canvas.on('selection:created', reportSelection);
      canvas.on('selection:updated', reportSelection);
      canvas.on('selection:cleared', () => onTextSelectionChangeRef.current?.(null));

      return () => {
        canvas.dispose();
        fabricRef.current = null;
      };
    }, [imageUrl]);

    function textboxToOverlay(t: Textbox): CoverTextOverlay {
      return {
        id:
          (t as unknown as { id?: string }).id ??
          String(t.left ?? 0) + String(t.top ?? 0),
        text: t.text ?? '',
        x: t.left ?? 0,
        y: t.top ?? 0,
        fontSize: t.fontSize ?? 48,
        fontFamily: t.fontFamily ?? 'Arial',
        color: (t.fill as string) ?? '#ffffff',
        strokeColor: (t.stroke as string) ?? undefined,
        strokeWidth: t.strokeWidth,
        align: (t.textAlign as 'left' | 'center' | 'right') ?? 'left',
        rotation: t.angle ?? 0,
      };
    }

    function pushSnapshot() {
      if (!fabricRef.current) return;
      history.current.push(JSON.stringify(fabricRef.current.toJSON()));
    }

    function emitChange() {
      onChange?.(buildEditState());
    }

    function buildEditState(): CoverEditState {
      const canvas = fabricRef.current;
      if (!canvas) return createEmptyEditState();
      const textOverlays = canvas
        .getObjects()
        .filter((o): o is Textbox => o.type === 'textbox')
        .map((t) => textboxToOverlay(t));
      return {
        version: 1,
        aspectRatio: undefined,
        textOverlays,
        filters: { preset: filterPresetRef.current },
        transform: {},
      };
    }

    function applyClipPath(ratio: number | null) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      if (!ratio) {
        canvas.clipPath = undefined;
        canvas.requestRenderAll();
        return;
      }
      const size = computeClipSize(ratio, CANVAS_WIDTH, CANVAS_HEIGHT);
      const clip = new Rect({
        left: (CANVAS_WIDTH - size.width) / 2,
        top: (CANVAS_HEIGHT - size.height) / 2,
        width: size.width,
        height: size.height,
        absolutePositioned: true,
      });
      canvas.clipPath = clip;
      canvas.requestRenderAll();
    }

    function applyEditState(state: CoverEditState) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      for (const t of state.textOverlays ?? []) {
        const tb = new Textbox(t.text, {
          left: t.x,
          top: t.y,
          fontSize: t.fontSize,
          fontFamily: t.fontFamily,
          fill: t.color,
          stroke: t.strokeColor,
          strokeWidth: t.strokeWidth ?? 0,
          textAlign: t.align ?? 'left',
          angle: t.rotation ?? 0,
        });
        canvas.add(tb);
      }
      canvas.requestRenderAll();
    }

    function applyFilters() {
      const img = bgImageRef.current;
      if (!img) return;
      const adj = getPresetAdjustments(filterPresetRef.current);
      img.filters = [
        new fabricFilters.Brightness({ brightness: adj.brightness / 100 }),
        new fabricFilters.Contrast({ contrast: adj.contrast / 100 }),
        new fabricFilters.Saturation({ saturation: adj.saturation / 100 }),
      ];
      img.applyFilters();
      fabricRef.current?.requestRenderAll();
    }

    function clearCropRect() {
      const canvas = fabricRef.current;
      if (!canvas || !cropRectRef.current) return;
      canvas.remove(cropRectRef.current);
      cropRectRef.current = null;
      canvas.requestRenderAll();
    }

    useImperativeHandle(ref, (): CoverEditorCanvasHandle => ({
      setAspectRatio(ratio) {
        ratioRef.current = ratio;
        // 若当前处于裁剪模式：不立即改动画布 clipPath（以免破坏裁剪 UI），
        // 仅更新 prevClipPathRef，让退出/应用裁剪时落地为新比例。
        if (cropRectRef.current) {
          const canvas = fabricRef.current;
          if (!canvas) return;
          if (!ratio) {
            prevClipPathRef.current = undefined;
            return;
          }
          const size = computeClipSize(ratio, CANVAS_WIDTH, CANVAS_HEIGHT);
          prevClipPathRef.current = new Rect({
            left: (CANVAS_WIDTH - size.width) / 2,
            top: (CANVAS_HEIGHT - size.height) / 2,
            width: size.width,
            height: size.height,
            absolutePositioned: true,
          });
          return;
        }
        applyClipPath(ratio);
        pushSnapshot();
        emitChange();
      },
      addText({ text, fontFamily, color }) {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const tb = new Textbox(text, {
          left: CANVAS_WIDTH / 2 - 120,
          top: CANVAS_HEIGHT / 2 - 24,
          width: 240,
          fontSize: 48,
          fontFamily,
          fill: color,
          textAlign: 'center',
        });
        canvas.add(tb);
        canvas.setActiveObject(tb);
        // 立即进入编辑模式并全选占位文案，便于直接覆盖输入
        try {
          tb.enterEditing();
          tb.selectAll();
        } catch {
          // 某些极端情况下 enterEditing 可能因焦点切换失败，忽略
        }
        canvas.requestRenderAll();
        onTextSelectionChangeRef.current?.(textboxToOverlay(tb));
        pushSnapshot();
        emitChange();
      },
      updateSelectedText(patch) {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (!active || active.type !== 'textbox') return;
        const t = active as Textbox;
        if (patch.text !== undefined) t.set('text', patch.text);
        if (patch.fontSize !== undefined) t.set('fontSize', patch.fontSize);
        if (patch.fontFamily !== undefined) t.set('fontFamily', patch.fontFamily);
        if (patch.color !== undefined) t.set('fill', patch.color);
        if (patch.strokeColor !== undefined) t.set('stroke', patch.strokeColor);
        if (patch.strokeWidth !== undefined) t.set('strokeWidth', patch.strokeWidth);
        if (patch.align !== undefined) t.set('textAlign', patch.align);
        canvas.requestRenderAll();
        onTextSelectionChangeRef.current?.(textboxToOverlay(t));
        pushSnapshot();
        emitChange();
      },
      removeSelected() {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        active.forEach((obj) => {
          if (obj !== bgImageRef.current && obj !== cropRectRef.current)
            canvas.remove(obj);
        });
        canvas.discardActiveObject();
        onTextSelectionChangeRef.current?.(null);
        pushSnapshot();
        emitChange();
      },
      flipHorizontal() {
        const img = bgImageRef.current;
        if (!img) return;
        img.set('flipX', !img.flipX);
        fabricRef.current?.requestRenderAll();
        pushSnapshot();
        emitChange();
      },
      flipVertical() {
        const img = bgImageRef.current;
        if (!img) return;
        img.set('flipY', !img.flipY);
        fabricRef.current?.requestRenderAll();
        pushSnapshot();
        emitChange();
      },
      rotate(deg) {
        const img = bgImageRef.current;
        if (!img) return;
        img.rotate((img.angle ?? 0) + deg);
        fabricRef.current?.requestRenderAll();
        pushSnapshot();
        emitChange();
      },
      setFilterPreset(preset) {
        filterPresetRef.current = preset;
        applyFilters();
        pushSnapshot();
        emitChange();
      },
      setFilterAdjustment() {
        applyFilters();
        pushSnapshot();
        emitChange();
      },
      enterCropMode() {
        const canvas = fabricRef.current;
        if (!canvas) return;

        // 决定裁剪目标：当前选中的图片（若是 image 类型），否则回落到背景图
        const active = canvas.getActiveObject();
        const target: FabricImage | null =
          active && active.type === 'image'
            ? (active as FabricImage)
            : bgImageRef.current;
        if (!target) return;
        cropTargetRef.current = target;

        // 暂存当前 canvas.clipPath（比例预设遮罩），裁剪期间隐藏以便看全图
        prevClipPathRef.current = canvas.clipPath as Rect | undefined;
        canvas.clipPath = undefined;

        // 锁定目标图层交互，避免用户误拖图片
        target.set({ selectable: false, evented: false });
        canvas.discardActiveObject();

        // 计算目标图像在画布上的可视边界
        const imgL = target.left ?? 0;
        const imgT = target.top ?? 0;
        const displayW = (target.width ?? 0) * (target.scaleX ?? 1);
        const displayH = (target.height ?? 0) * (target.scaleY ?? 1);

        // 默认裁剪框：图像 80% 区域，居中
        const defaultW = displayW * 0.8;
        const defaultH = displayH * 0.8;
        const defaultL = imgL + (displayW - defaultW) / 2;
        const defaultT = imgT + (displayH - defaultH) / 2;

        clearCropRect();
        cropAspectRef.current = null;
        const rect = new Rect({
          left: defaultL,
          top: defaultT,
          width: defaultW,
          height: defaultH,
          fill: 'rgba(0, 122, 255, 0.12)',
          stroke: '#0A84FF',
          strokeWidth: 2,
          strokeDashArray: [6, 4],
          cornerColor: '#0A84FF',
          cornerStyle: 'circle',
          transparentCorners: false,
          hasRotatingPoint: false,
          lockRotation: true,
        });

        // 比例锁：用户缩放时按比例约束 scaleY
        rect.on('scaling', () => {
          const ratio = cropAspectRef.current;
          if (!ratio) return;
          const sx = rect.scaleX ?? 1;
          const baseW = rect.width ?? 0;
          const baseH = rect.height ?? 0;
          const currentW = baseW * sx;
          const targetH = currentW / ratio;
          const targetSy = baseH > 0 ? targetH / baseH : rect.scaleY ?? 1;
          rect.set({ scaleY: targetSy });
        });

        cropRectRef.current = rect;
        canvas.add(rect);
        canvas.setActiveObject(rect);
        canvas.requestRenderAll();
      },
      exitCropMode() {
        const canvas = fabricRef.current;
        const target = cropTargetRef.current;
        clearCropRect();
        cropAspectRef.current = null;
        if (target) {
          // 恢复目标图像可交互
          target.set({ selectable: true, evented: true });
        }
        if (canvas) {
          // 恢复进入裁剪前的 clipPath（比例预设遮罩）
          canvas.clipPath = prevClipPathRef.current;
          canvas.requestRenderAll();
        }
        cropTargetRef.current = null;
        prevClipPathRef.current = undefined;
      },
      commitCrop() {
        const canvas = fabricRef.current;
        const rect = cropRectRef.current;
        const img = cropTargetRef.current;
        if (!canvas || !rect || !img) return;

        const rectL = rect.left ?? 0;
        const rectT = rect.top ?? 0;
        const rectW = (rect.width ?? 0) * (rect.scaleX ?? 1);
        const rectH = (rect.height ?? 0) * (rect.scaleY ?? 1);

        // 将画布坐标系的裁剪矩形转换到图像"未缩放前"的局部坐标
        const imgL = img.left ?? 0;
        const imgT = img.top ?? 0;
        const imgSx = img.scaleX ?? 1;
        const imgSy = img.scaleY ?? 1;

        const localX = (rectL - imgL) / imgSx;
        const localY = (rectT - imgT) / imgSy;
        const localW = rectW / imgSx;
        const localH = rectH / imgSy;

        // 夹到图像当前 width/height 范围内，防止越界
        const curW = img.width ?? 0;
        const curH = img.height ?? 0;
        const clampedX = Math.max(0, Math.min(localX, curW));
        const clampedY = Math.max(0, Math.min(localY, curH));
        const clampedW = Math.max(1, Math.min(localW, curW - clampedX));
        const clampedH = Math.max(1, Math.min(localH, curH - clampedY));

        // Fabric Image 的裁剪语义：cropX/cropY 是源图像偏移；多次裁剪要累加
        const prevCropX = img.cropX ?? 0;
        const prevCropY = img.cropY ?? 0;

        img.set({
          cropX: prevCropX + clampedX,
          cropY: prevCropY + clampedY,
          width: clampedW,
          height: clampedH,
          // 图像落位到裁剪框位置，视觉上"原地"被裁剪
          left: rectL,
          top: rectT,
          selectable: true,
          evented: true,
        });
        img.setCoords();

        clearCropRect();
        // 恢复比例预设遮罩
        if (prevClipPathRef.current) canvas.clipPath = prevClipPathRef.current;
        cropAspectRef.current = null;
        cropTargetRef.current = null;
        prevClipPathRef.current = undefined;

        canvas.requestRenderAll();
        pushSnapshot();
        emitChange();
      },
      setCropAspectRatio(ratio) {
        cropAspectRef.current = ratio;
        const canvas = fabricRef.current;
        const rect = cropRectRef.current;
        const img = cropTargetRef.current;
        if (!canvas || !rect || !img) return;
        if (ratio) {
          // 按比例调整矩形：约束在目标图像可视边界内
          const imgL = img.left ?? 0;
          const imgT = img.top ?? 0;
          const imgW = (img.width ?? 0) * (img.scaleX ?? 1);
          const imgH = (img.height ?? 0) * (img.scaleY ?? 1);

          const curL = rect.left ?? 0;
          const curT = rect.top ?? 0;
          const curW = (rect.width ?? 0) * (rect.scaleX ?? 1);

          let nextW = curW;
          let nextH = nextW / ratio;
          // 超出图像底部：按剩余高度反推宽度
          if (curT + nextH > imgT + imgH) {
            nextH = Math.max(40, imgT + imgH - curT);
            nextW = nextH * ratio;
          }
          // 超出图像右边界：按剩余宽度重算高度
          if (curL + nextW > imgL + imgW) {
            nextW = Math.max(40, imgL + imgW - curL);
            nextH = nextW / ratio;
          }
          rect.set({ width: nextW, height: nextH, scaleX: 1, scaleY: 1 });
          rect.setCoords();
        }
        canvas.requestRenderAll();
      },
      undo() {
        const snap = history.current.undo();
        const canvas = fabricRef.current;
        if (snap && canvas) canvas.loadFromJSON(snap, () => canvas.requestRenderAll());
        emitChange();
      },
      redo() {
        const snap = history.current.redo();
        const canvas = fabricRef.current;
        if (snap && canvas) canvas.loadFromJSON(snap, () => canvas.requestRenderAll());
        emitChange();
      },
      exportDataUrl() {
        const canvas = fabricRef.current;
        if (!canvas) return '';
        // 优先使用画布的 clipPath（比例预设遮罩）作为导出边界
        const clip = canvas.clipPath as Rect | undefined;
        if (clip && typeof clip.left === 'number' && typeof clip.top === 'number') {
          return canvas.toDataURL({
            format: 'png',
            multiplier: 2,
            left: clip.left,
            top: clip.top,
            width: (clip.width ?? 0) * (clip.scaleX ?? 1),
            height: (clip.height ?? 0) * (clip.scaleY ?? 1),
          });
        }
        // 无比例预设时：按背景图的可视边界导出（反映 Photoshop 式裁剪后的真实画面）
        const img = bgImageRef.current;
        if (img && typeof img.left === 'number' && typeof img.top === 'number') {
          return canvas.toDataURL({
            format: 'png',
            multiplier: 2,
            left: img.left,
            top: img.top,
            width: (img.width ?? 0) * (img.scaleX ?? 1),
            height: (img.height ?? 0) * (img.scaleY ?? 1),
          });
        }
        return canvas.toDataURL({ format: 'png', multiplier: 2 });
      },
      getEditState() {
        return buildEditState();
      },
      loadEditState(state) {
        applyEditState(state);
      },
    }));

    return (
      <div className={styles.canvasWrap}>
        <canvas ref={containerRef} />
      </div>
    );
  },
);
