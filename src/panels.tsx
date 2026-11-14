import * as React from 'react';
import {
  APPEARANCE_PRESETS,
  RESOLUTIONS,
  type AppearanceSettings,
  type BackgroundMode,
  type LayoutSettings,
  type LoadedScore,
  type ProjectSettings,
  type VideoSettings,
} from '../core/types';
import {
  ColorField,
  Field,
  Icons,
  NumberInput,
  Segmented,
  Select,
  Slider,
  TextInput,
  Toggle,
} from './ui/controls';
import { estimateExportBytes, formatBytes, formatClock, formatResolution, resolutionId } from './storage';

interface CommonProps {
  settings: ProjectSettings;
  loaded: LoadedScore | null;
  trackIndex: number;
  durationMs: number;
}

interface LayoutPanelProps extends CommonProps {
  onLayout: (patch: Partial<LayoutSettings>) => void;
  onReset: () => void;
}

export const LayoutPanel = React.memo(function LayoutPanel(props: LayoutPanelProps): React.ReactElement {
  const { layout } = props.settings;
  return (
    <div className="tf-panel">
      <section className="tf-group">
        <div className="tf-group-head">
          <h3>下落与滚动</h3>
          <button type="button" className="tf-text-btn" onClick={props.onReset}>{Icons.reset} 恢复默认</button>
        </div>
        <Segmented
          label="间距基准"
          value={layout.spacing}
          options={[
            { value: 'beat', label: '按拍子', title: '每拍固定长度，4 分音符 = 4 个 16 分音符' },
            { value: 'time', label: '按时间', title: '每秒钟固定长度，速度随曲速变化' },
          ]}
          onChange={(value) => props.onLayout({ spacing: value })}
          hint={layout.spacing === 'beat'
            ? '拍子基准：音符间距严格等于书写时值，曲速变化时滚动速度随之变化。'
            : '时间基准：每秒移动距离相同，慢速段落会显得更疏。'}
        />
        {layout.spacing === 'beat' ? (
          <Slider
            label="每拍长度"
            value={layout.pxPerBeat}
            min={50}
            max={360}
            step={5}
            unit="px"
            display={(value) => `${value} px/拍`}
            onChange={(value) => props.onLayout({ pxPerBeat: value })}
            hint="1080p 画布上的距离；16 分音符是它的 1/4。"
          />
        ) : (
          <Slider
            label="下落速度"
            value={layout.pxPerSecond}
            min={80}
            max={900}
            step={10}
            unit="px/s"
            display={(value) => `${value} px/秒`}
            onChange={(value) => props.onLayout({ pxPerSecond: value })}
          />
        )}
        <Slider
          label="平滑强度"
          value={layout.smoothing}
          min={0}
          max={1}
          step={0.05}
          display={(value) => `${Math.round(value * 100)}%`}
          onChange={(value) => props.onLayout({ smoothing: value })}
          hint="只平滑画面中的滚动位置，不影响音频、判定和击中时刻。"
        />
        <Select
          label="预读补偿"
          value={layout.lookahead}
          options={[
            { value: 'off', label: '关闭' },
            { value: 'conservative', label: '保守' },
            { value: 'normal', label: '标准' },
            { value: 'aggressive', label: '激进' },
          ]}
          onChange={(value) => props.onLayout({ lookahead: value as LayoutSettings['lookahead'] })}
          hint="提前读取谱面来抵消平滑带来的延迟；越强越跟手。"
        />
      </section>

      <section className="tf-group">
        <h3>取景</h3>
        <Slider
          label="判定线高度"
          value={layout.hitLineRatio}
          min={0.55}
          max={0.94}
          step={0.01}
          display={(value) => `${Math.round(value * 100)}%`}
          onChange={(value) => props.onLayout({ hitLineRatio: value })}
          hint="屏幕高度的百分比；越高，上方可见的提前量越大。"
        />
        <Slider
          label="轨道宽度"
          value={layout.laneWidth}
          min={0.55}
          max={1.6}
          step={0.05}
          display={(value) => `${Math.round(value * 100)}%`}
          onChange={(value) => props.onLayout({ laneWidth: value })}
        />
        <Slider
          label="水平位置"
          value={layout.laneOffset}
          min={-0.25}
          max={0.25}
          step={0.01}
          display={(value) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`}
          onChange={(value) => props.onLayout({ laneOffset: value })}
        />
        <Slider
          label="音符大小"
          value={layout.noteScale}
          min={0.65}
          max={1.45}
          step={0.05}
          display={(value) => `${Math.round(value * 100)}%`}
          onChange={(value) => props.onLayout({ noteScale: value })}
        />
        <Segmented
          label="透视视角"
          value={layout.perspectiveAxis}
          options={[
            { value: 'off', label: '关闭' },
            { value: 'vertical', label: '纵向' },
            { value: 'horizontal', label: '横向' },
          ]}
          onChange={(value) => props.onLayout({ perspectiveAxis: value as LayoutSettings['perspectiveAxis'] })}
          hint={layout.perspectiveAxis === 'off'
            ? '纵向让轨道上下产生纵深，横向让左右产生纵深；标题和进度条保持平面。'
            : '轨道平面绕轴旋转，靠近观者的一端变大、远端收窄；负角度会把近端翻到另一边。'}
        />
        {layout.perspectiveAxis !== 'off' && (
          <Slider
            label="透视角度"
            value={layout.perspectiveAngle}
            min={-60}
            max={60}
            step={1}
            unit="°"
            display={(value) => `${value > 0 ? '+' : ''}${value}°`}
            onChange={(value) => props.onLayout({ perspectiveAngle: value })}
          />
        )}
      </section>

      <section className="tf-group">
        <h3>视频时间轴</h3>
        <Slider
          label="预备时间"
          value={layout.leadInSec}
          min={0}
          max={6}
          step={0.5}
          unit="s"
          display={(value) => `${value.toFixed(1)} s`}
          onChange={(value) => props.onLayout({ leadInSec: value })}
          hint="音频开始前的倒计时；音符会从上方落下来。"
        />
        <Slider
          label="尾奏留白"
          value={layout.outroSec}
          min={0}
          max={6}
          step={0.5}
          unit="s"
          display={(value) => `${value.toFixed(1)} s`}
          onChange={(value) => props.onLayout({ outroSec: value })}
          hint="最后一个音符之后继续录制的时长。"
        />
        <div className="tf-info-line">
          <span>成片时长</span>
          <strong>{formatClock(props.durationMs + layout.leadInSec * 1000 + layout.outroSec * 1000)}</strong>
        </div>
      </section>
    </div>
  );
});

interface LookPanelProps extends CommonProps {
  onAppearance: (patch: Partial<AppearanceSettings>) => void;
  onPreset: (id: string) => void;
  onReset: () => void;
  onBackgroundFile: (file: File) => void;
  onClearBackground: () => void;
}

export const LookPanel = React.memo(function LookPanel(props: LookPanelProps): React.ReactElement {
  const { appearance } = props.settings;
  const imageInput = React.useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<AppearanceSettings>) => props.onAppearance(patch);
  return (
    <div className="tf-panel">
      <section className="tf-group">
        <div className="tf-group-head">
          <h3>视觉预设</h3>
          <button type="button" className="tf-text-btn" onClick={props.onReset}>{Icons.reset} 重置外观</button>
        </div>
        <div className="tf-presets">
          {APPEARANCE_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={`tf-preset ${appearance.preset === preset.id ? 'is-active' : ''}`}
              onClick={() => props.onPreset(preset.id)}
            >
              <span className="tf-preset-dots" aria-hidden="true">
                <i style={{ background: preset.patch.accent ?? appearance.accent }} />
                <i style={{ background: preset.patch.accent2 ?? appearance.accent2 }} />
                <i style={{ background: preset.patch.backgroundBottom ?? appearance.backgroundBottom }} />
              </span>
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="tf-group">
        <h3>画布</h3>
        <Segmented
          label="背景模式"
          value={appearance.backgroundMode}
          options={[
            { value: 'gradient', label: '渐变' },
            { value: 'black', label: '纯黑 · 叠加用' },
          ]}
          onChange={(value) => set({ backgroundMode: value as BackgroundMode })}
        />
        {appearance.backgroundMode === 'black' ? (
          <p className="tf-hint">纯黑底：不画渐变、底板与暗角，辉光在画面边缘前淡到 0，可直接用“加亮/滤色”叠到别的视频上。</p>
        ) : null}
        <div className="tf-grid-2">
          {appearance.backgroundMode !== 'black' && (
            <>
              <ColorField label="背景上" value={appearance.backgroundTop} onChange={(value) => set({ backgroundTop: value })} />
              <ColorField label="背景下" value={appearance.backgroundBottom} onChange={(value) => set({ backgroundBottom: value })} />
            </>
          )}
          <ColorField label="主强调色" value={appearance.accent} onChange={(value) => set({ accent: value })} />
          <ColorField label="副强调色" value={appearance.accent2} onChange={(value) => set({ accent2: value })} />
        </div>
        <div className="tf-inline-actions">
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) props.onBackgroundFile(file);
              event.target.value = '';
            }}
          />
          <button type="button" className="tf-btn is-ghost is-small" onClick={() => imageInput.current?.click()}>
            {Icons.upload} 背景图
          </button>
          {appearance.backgroundImage && (
            <button type="button" className="tf-btn is-ghost is-small" onClick={props.onClearBackground}>移除背景图</button>
          )}
        </div>
        {appearance.backgroundImage && (
          <div className="tf-grid-2">
            <Slider label="背景压暗" value={appearance.backgroundImageDim} min={0} max={0.95} step={0.05} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ backgroundImageDim: value })} />
            <Slider label="背景模糊" value={appearance.backgroundImageBlur} min={0} max={30} step={1} unit="px" onChange={(value) => set({ backgroundImageBlur: value })} />
          </div>
        )}
        {appearance.backgroundMode !== 'black' && (
          <Slider label="轨道底板" value={appearance.lanePanel} min={0} max={1} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ lanePanel: value })} />
        )}
        <Slider label="轨道辉光" value={appearance.laneGlow} min={0} max={1} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ laneGlow: value })} />
      </section>

      <section className="tf-group">
        <h3>谱线与弦位</h3>
        <div className="tf-grid-2">
          <ColorField label="谱线颜色" value={appearance.stringColor} onChange={(value) => set({ stringColor: value })} />
          <Slider label="谱线粗细" value={appearance.stringWidth} min={0.5} max={4} step={0.1} unit="px" onChange={(value) => set({ stringWidth: value })} />
        </div>
        <Slider label="谱线透明度" value={appearance.stringOpacity} min={0} max={1} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ stringOpacity: value })} />
        <Segmented
          label="弦序方向"
          value={appearance.stringOrder}
          options={[
            { value: 'high-right', label: '高音弦在右', title: '顺时针旋转横向六线谱的效果' },
            { value: 'high-left', label: '高音弦在左' },
          ]}
          onChange={(value) => set({ stringOrder: value })}
        />
        <div className="tf-toggle-grid">
          <Toggle label="弦名" checked={appearance.showStringLabels} onChange={(value) => set({ showStringLabels: value })} />
          <Toggle label="弦号" checked={appearance.showStringNumbers} onChange={(value) => set({ showStringNumbers: value })} />
        </div>
      </section>

      <section className="tf-group">
        <h3>音符</h3>
        <Segmented
          label="外形"
          value={appearance.noteShape}
          options={[
            { value: 'capsule', label: '胶囊' },
            { value: 'circle', label: '圆形' },
            { value: 'square', label: '方形' },
            { value: 'diamond', label: '菱形' },
            { value: 'text', label: '纯数字' },
          ]}
          onChange={(value) => set({ noteShape: value })}
        />
        <Select
          label="配色方式"
          value={appearance.noteColorMode}
          options={[
            { value: 'string', label: '按弦分配' },
            { value: 'accent', label: '统一强调色' },
            { value: 'technique', label: '按演奏技巧' },
          ]}
          onChange={(value) => set({ noteColorMode: value as AppearanceSettings['noteColorMode'] })}
        />
        {appearance.noteColorMode === 'string' && (
          <Field label="六弦调色盘（1 弦 → 6 弦）" hint="超出 6 弦的乐器会循环使用这些颜色。">
            <div className="tf-palette">
              {appearance.stringColors.slice(0, 8).map((color, index) => (
                <label key={index} className="tf-swatch" title={`弦 ${index + 1}`}>
                  <span style={{ background: color }} />
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => {
                      const next = [...appearance.stringColors];
                      next[index] = event.target.value;
                      set({ stringColors: next });
                    }}
                  />
                </label>
              ))}
            </div>
          </Field>
        )}
        <div className="tf-grid-2">
          <Slider label="音符宽度" value={appearance.noteWidth} min={0.7} max={1.4} step={0.05} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ noteWidth: value })} />
          <Slider label="音符高度" value={appearance.noteHeight} min={0.7} max={1.4} step={0.05} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ noteHeight: value })} />
          <Slider label="圆角" value={appearance.noteRadius} min={0} max={0.5} step={0.01} display={(v) => `${Math.round(v * 200)}%`} onChange={(value) => set({ noteRadius: value })} />
          <Slider label="音符辉光" value={appearance.noteGlow} min={0} max={1} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ noteGlow: value })} />
          <Slider label="描边" value={appearance.noteBorder} min={0} max={1} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ noteBorder: value })} />
        </div>
        <Toggle label="数字颜色自动对比" checked={appearance.noteAutoText} onChange={(value) => set({ noteAutoText: value })} />
        {!appearance.noteAutoText && (
          <ColorField label="数字颜色" value={appearance.noteTextColor} onChange={(value) => set({ noteTextColor: value })} />
        )}
        <TextInput
          label="数字字体"
          value={appearance.noteFont}
          onChange={(value) => set({ noteFont: value })}
          hint="填写 CSS font-family；建议粗体无衬线字体。"
        />
        <Toggle label="技巧角标" checked={appearance.showTechniqueTags} onChange={(value) => set({ showTechniqueTags: value })} hint="推弦、泛音、闷音等小标记" />
        <Toggle label="泛音显示为菱形" checked={appearance.harmonicDiamond} onChange={(value) => set({ harmonicDiamond: value })} hint="无论全局音符形状如何，泛音都使用菱形" />
      </section>

      <section className="tf-group">
        <h3>技巧连接</h3>
        <div className="tf-toggle-grid">
          <Toggle label="连接击勾弦 / 连音" checked={appearance.connectLegato} onChange={(value) => set({ connectLegato: value })} />
          <Toggle label="连接滑音" checked={appearance.connectSlide} onChange={(value) => set({ connectSlide: value })} />
        </div>
        <Toggle
          label="近距离合并形状"
          checked={appearance.mergeNearShapes}
          onChange={(value) => set({ mergeNearShapes: value })}
          hint="很近的连接音会合成一条竖向胶囊/连续形体；离得远的仍用连线"
        />
        {appearance.mergeNearShapes && (
          <Slider
            label="合并距离"
            value={appearance.mergeDistance}
            min={0.8}
            max={3}
            step={0.1}
            display={(value) => `${value.toFixed(1)}× 音符高`}
            onChange={(value) => set({ mergeDistance: value })}
            hint="两音符中心距小于该值时才合并形状。"
          />
        )}
        <Segmented
          label="远距离连接样式"
          value={appearance.connectionStyle}
          options={[
            { value: 'ribbon', label: '缎带' },
            { value: 'line', label: '细线' },
            { value: 'dashed', label: '虚线' },
          ]}
          onChange={(value) => set({ connectionStyle: value })}
          hint="超出合并距离，或不同弦/泛音/纯数字时使用此连线。击中起点后连线会从判定线继续延伸到目标。"
        />
      </section>

      <section className="tf-group">
        <h3>时值尾迹</h3>
        <Segmented
          label="显示"
          value={appearance.tailMode}
          options={[
            { value: 'off', label: '关闭' },
            { value: 'long', label: '长音与连音' },
            { value: 'all', label: '全部音符' },
          ]}
          onChange={(value) => set({ tailMode: value })}
          hint="尾迹长度等于音符书写时值，让 4 分音符真正占 4 个 16 分音符的长度。"
        />
        <div className="tf-grid-2">
          <Slider label="尾迹宽度" value={appearance.tailWidth} min={0.15} max={1} step={0.05} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ tailWidth: value })} />
          <Slider label="尾迹透明度" value={appearance.tailOpacity} min={0.05} max={1} step={0.05} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ tailOpacity: value })} />
        </div>
      </section>

      <section className="tf-group">
        <h3>判定线</h3>
        <Toggle label="显示判定线" checked={appearance.showHitLine} onChange={(value) => set({ showHitLine: value })} />
        <div className="tf-grid-2">
          <ColorField label="颜色" value={appearance.hitLineColor} onChange={(value) => set({ hitLineColor: value })} />
          <Slider label="粗细" value={appearance.hitLineWidth} min={1} max={10} step={0.5} unit="px" onChange={(value) => set({ hitLineWidth: value })} />
          <Slider label="光晕" value={appearance.hitLineGlow} min={0} max={1} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ hitLineGlow: value })} />
          <Slider label="长度" value={appearance.hitLineExtension} min={0} max={1} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ hitLineExtension: value })} />
        </div>
        <Toggle label="拍点参考线" checked={appearance.showBeatGuides} onChange={(value) => set({ showBeatGuides: value })} hint="可选；默认不画小节线" />
        {appearance.showBeatGuides && (
          <Slider label="参考线透明度" value={appearance.beatGuideOpacity} min={0.02} max={0.6} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ beatGuideOpacity: value })} />
        )}
      </section>

      <section className="tf-group">
        <h3>画面信息</h3>
        <div className="tf-toggle-grid">
          <Toggle label="标题" checked={appearance.showTitle} onChange={(value) => set({ showTitle: value })} />
          <Toggle label="艺术家" checked={appearance.showArtist} onChange={(value) => set({ showArtist: value })} />
          <Toggle label="曲谱信息" checked={appearance.showMeta} onChange={(value) => set({ showMeta: value })} />
          <Toggle label="进度条" checked={appearance.showProgress} onChange={(value) => set({ showProgress: value })} />
          <Toggle label="水印" checked={appearance.showWatermark} onChange={(value) => set({ showWatermark: value })} />
          <Toggle label="连击数" checked={appearance.combo} onChange={(value) => set({ combo: value })} />
        </div>
        {appearance.showWatermark && (
          <TextInput label="水印文字" value={appearance.watermark} onChange={(value) => set({ watermark: value })} placeholder="TABFALL" />
        )}
        <div className="tf-grid-2">
          <TextInput label="标题字体" value={appearance.titleFont} onChange={(value) => set({ titleFont: value })} />
          <Slider label="标题大小" value={appearance.titleSize} min={0.6} max={1.8} step={0.05} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ titleSize: value })} />
        </div>
        <div className="tf-grid-2">
          <Slider
            label="READY 大小"
            value={appearance.readyScale}
            min={0.5}
            max={3}
            step={0.05}
            display={(v) => `${Math.round(v * 100)}%`}
            onChange={(value) => set({ readyScale: value })}
            hint="预备倒计时（READY + 数字）的尺寸。"
          />
          <Slider
            label="连击大小"
            value={appearance.comboScale}
            min={0.5}
            max={3}
            step={0.05}
            display={(v) => `${Math.round(v * 100)}%`}
            onChange={(value) => set({ comboScale: value })}
            hint="右上角连击数字与 COMBO 标签的尺寸。"
          />
        </div>
      </section>
    </div>
  );
});

interface EffectsPanelProps {
  settings: ProjectSettings;
  onAppearance: (patch: Partial<AppearanceSettings>) => void;
}

const EFFECT_CARDS: Array<{ id: AppearanceSettings['hitEffect']; label: string; text: string }> = [
  { id: 'phigros', label: 'Phigros', text: '菱形星芒 + 双环冲击波' },
  { id: 'smoke', label: '烟雾', text: '粒子向上飘散，数字化为青烟' },
  { id: 'spark', label: '火花', text: '短促的放射火花与光点' },
  { id: 'none', label: '无', text: '数字直接消失' },
];

export const EffectsPanel = React.memo(function EffectsPanel(props: EffectsPanelProps): React.ReactElement {
  const { appearance } = props.settings;
  const set = (patch: Partial<AppearanceSettings>) => props.onAppearance(patch);
  return (
    <div className="tf-panel">
      <section className="tf-group">
        <h3>击中特效</h3>
        <div className="tf-effect-grid">
          {EFFECT_CARDS.map((card) => (
            <button
              type="button"
              key={card.id}
              className={`tf-effect-card ${appearance.hitEffect === card.id ? 'is-active' : ''}`}
              onClick={() => set({ hitEffect: card.id })}
            >
              <span className={`tf-effect-icon is-${card.id}`} aria-hidden="true">
                <i /><i /><i />
              </span>
              <strong>{card.label}</strong>
              <small>{card.text}</small>
            </button>
          ))}
        </div>
        <Slider label="特效强度" value={appearance.effectIntensity} min={0} max={1} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ effectIntensity: value })} />
        <Slider label="特效时长" value={appearance.effectDuration} min={0.25} max={1.4} step={0.05} unit="s" display={(v) => `${v.toFixed(2)} s`} onChange={(value) => set({ effectDuration: value })} />
        <Slider label="判定线闪光" value={appearance.hitFlash} min={0} max={1} step={0.02} display={(v) => `${Math.round(v * 100)}%`} onChange={(value) => set({ hitFlash: value })} />
      </section>

      <section className="tf-group">
        <h3>玩法反馈</h3>
        <Toggle label="连击计数" checked={appearance.combo} onChange={(value) => set({ combo: value })} hint="每个音符 +1，在右上角显示" />
        <p className="tf-note">
          击中判定使用 alphaTab 的音频时钟，画面平滑只影响绘制位置。越靠近判定线，音符外圈会越亮。
        </p>
      </section>

      <section className="tf-group">
        <h3>技巧配色</h3>
        <div className="tf-tech-list">
          <span><i style={{ background: '#ffb454' }} />推弦 / 滑弦</span>
          <span><i style={{ background: '#ff6ad5' }} />泛音</span>
          <span><i style={{ background: '#8fa3b8' }} />闷音</span>
          <span><i style={{ background: '#7cf7b0' }} />延音</span>
          <span><i style={{ background: '#ffd166' }} />连奏</span>
        </div>
        <p className="tf-note">将音符配色切换为「按演奏技巧」即可启用这套颜色。</p>
      </section>
    </div>
  );
});

interface VideoPanelProps extends CommonProps {
  onVideo: (patch: Partial<VideoSettings>) => void;
  onExport: () => void;
  exporting: boolean;
}

export const VideoPanel = React.memo(function VideoPanel(props: VideoPanelProps): React.ReactElement {
  const { video, layout } = props.settings;
  const currentResolution = resolutionId(video.width, video.height);
  const [customSize, setCustomSize] = React.useState(currentResolution === 'custom');
  React.useEffect(() => {
    if (resolutionId(video.width, video.height) === 'custom') setCustomSize(true);
  }, [video.width, video.height]);
  const totalMs = props.durationMs + layout.leadInSec * 1000 + layout.outroSec * 1000;
  const frames = Math.ceil(totalMs / 1000 * video.fps);
  const estimate = estimateExportBytes(props.settings, props.durationMs);
  return (
    <div className="tf-panel">
      <section className="tf-group">
        <h3>画幅</h3>
        <Select
          label="分辨率"
          value={customSize ? 'custom' : currentResolution}
          options={[
            ...RESOLUTIONS.map((entry) => ({
              value: entry.id,
              label: `${entry.label}`,
            })),
            { value: 'custom', label: '自定义尺寸' },
          ]}
          onChange={(value) => {
            if (value === 'custom') {
              setCustomSize(true);
              return;
            }
            setCustomSize(false);
            const entry = RESOLUTIONS.find((resolution) => resolution.id === value);
            if (entry) props.onVideo({ width: entry.width, height: entry.height });
          }}
        />
        {customSize && (
          <div className="tf-grid-2">
            <NumberInput label="宽" value={video.width} min={320} max={4096} step={2} suffix="px" onChange={(value) => props.onVideo({ width: Math.round(value) || 1920 })} />
            <NumberInput label="高" value={video.height} min={320} max={4096} step={2} suffix="px" onChange={(value) => props.onVideo({ height: Math.round(value) || 1080 })} />
          </div>
        )}
        <div className="tf-info-line">
          <span>预览画幅</span>
          <strong>{formatResolution(video.width, video.height)} · {video.fps} fps</strong>
        </div>
      </section>

      <section className="tf-group">
        <h3>编码</h3>
        <Segmented
          label="帧率"
          value={String(video.fps)}
          options={[
            { value: '30', label: '30 fps' },
            { value: '60', label: '60 fps' },
          ]}
          onChange={(value) => props.onVideo({ fps: Number(value) })}
        />
        <Segmented
          label="容器"
          value={video.container}
          options={[
            { value: 'mp4', label: 'MP4' },
            { value: 'webm', label: 'WebM' },
          ]}
          onChange={(value) => props.onVideo({ container: value })}
          hint="MP4 用 H.264 + AAC，兼容性最好；WebM 用 VP9 + Opus。若一种编码不可用请切换。"
        />
        <Select
          label="质量"
          value={video.quality}
          options={[
            { value: 'low', label: '流畅 · 文件更小' },
            { value: 'normal', label: '标准' },
            { value: 'high', label: '高码率' },
          ]}
          onChange={(value) => props.onVideo({ quality: value })}
        />
        <Toggle label="包含音轨" checked={video.includeAudio} onChange={(value) => props.onVideo({ includeAudio: value })} hint="无内置伴奏时用 alphaTab 合成器离线渲染" />
        <TextInput
          label="文件名"
          value={video.filename}
          onChange={(value) => props.onVideo({ filename: value })}
          placeholder={props.loaded ? `${props.loaded.meta.title || 'tabfall'} · tabfall` : 'tabfall'}
        />
      </section>

      <section className="tf-group">
        <h3>导出摘要</h3>
        <div className="tf-summary">
          <div><span>成片时长</span><strong>{formatClock(totalMs)}</strong></div>
          <div><span>总帧数</span><strong>{frames.toLocaleString()}</strong></div>
          <div><span>预计大小</span><strong>≈ {formatBytes(estimate)}</strong></div>
          <div><span>音轨</span><strong>{video.includeAudio ? '包含' : '静音'}</strong></div>
        </div>
        <button type="button" className="tf-btn is-primary is-block" onClick={props.onExport} disabled={!props.loaded || props.exporting}>
          {Icons.download} {props.exporting ? '正在导出…' : '导出视频'}
        </button>
        <p className="tf-hint">离线渲染不会录屏，导出期间可以继续使用浏览器，但请保持此标签页打开。</p>
      </section>
    </div>
  );
});
