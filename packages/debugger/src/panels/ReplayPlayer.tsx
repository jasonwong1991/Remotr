import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Replayer } from 'rrweb';
import 'rrweb/dist/style.css';
import { ScaleContainer } from './PageMirror';
import { useT } from '../i18n';
import type { RrwebEventRaw } from '../store';

// rrweb event type 2 = FullSnapshot, 4 = Meta（标志快照段起点）
const FULL_SNAPSHOT_TYPE = 2;
const META_TYPE = 4;

const SPEEDS = [1, 2, 4, 8] as const;

/** 把 ms 偏移格式化为 m:ss */
function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 从录制事件中截取一段以全量快照开头的可回放序列。
 * rrweb Replayer 要求事件序列从 FullSnapshot（最好前置 Meta）开始，否则无法重建。
 * 段头基线保证了这一点，但极端情况下基线可能因 backlog 上限丢失快照——此时返回空。
 */
function toPlayable(events: RrwebEventRaw[]): RrwebEventRaw[] {
  const firstFull = events.findIndex((e) => (e as { type?: number }).type === FULL_SNAPSHOT_TYPE);
  if (firstFull < 0) return [];
  const start =
    firstFull > 0 && (events[firstFull - 1] as { type?: number }).type === META_TYPE
      ? firstFull - 1
      : firstFull;
  return events.slice(start);
}

/**
 * ReplayPlayer — rrweb 非实时回放器 + 播放控制条。
 *
 * 单一职责：在给定事件序列上提供 播放/暂停/重播/拖动进度/倍速。父组件通过
 * 更换 key 在切换录制段时整体重挂载，省去手动销毁旧 Replayer 的复杂度。
 */
export default function ReplayPlayer({
  events,
  vpWidth,
  vpHeight,
}: {
  events: RrwebEventRaw[];
  vpWidth?: number;
  vpHeight?: number;
}): React.ReactElement {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<InstanceType<typeof Replayer> | null>(null);
  const rafRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);

  const playable = useMemo(() => toPlayable(events), [events]);

  // 构建 Replayer（事件序列变化时；通常由父级 key 触发整组件重挂载）
  useEffect(() => {
    if (!containerRef.current || playable.length < 2) return;

    let replayer: InstanceType<typeof Replayer> | null = null;
    try {
      replayer = new Replayer(playable, {
        root: containerRef.current,
        speed,
        // 自动快进无交互区间（空闲页面的段里常见），避免观看空白
        skipInactive: true,
        showWarning: false,
        showDebug: false,
        mouseTail: false,
        useVirtualDom: true,
      });
    } catch (e) {
      console.warn('[ReplayPlayer] Replayer init error:', e);
      return;
    }
    replayerRef.current = replayer;

    try {
      const meta = replayer.getMetaData();
      setDuration(meta.totalTime);
    } catch {
      /* ignore */
    }
    setCurrentTime(0);
    setPlaying(false);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      try {
        replayer?.pause();
        replayer?.destroy?.();
      } catch {
        /* ignore */
      }
      replayerRef.current = null;
    };
    // speed 故意不入依赖：倍速变化通过 setConfig 应用，不重建 Replayer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playable]);

  // 倍速变化即时应用
  useEffect(() => {
    try {
      replayerRef.current?.setConfig?.({ speed });
    } catch {
      /* ignore */
    }
  }, [speed]);

  // 播放期间用 rAF 轮询当前时间，驱动进度条
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const r = replayerRef.current;
      if (r) {
        let tCur = 0;
        try {
          tCur = typeof r.getCurrentTime === 'function' ? r.getCurrentTime() : 0;
        } catch {
          /* ignore */
        }
        if (duration > 0 && tCur >= duration) {
          setCurrentTime(duration);
          setPlaying(false);
          return;
        }
        setCurrentTime(tCur);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, duration]);

  const togglePlay = () => {
    const r = replayerRef.current;
    if (!r) return;
    if (playing) {
      try {
        r.pause();
      } catch {
        /* ignore */
      }
      setPlaying(false);
    } else {
      const from = duration > 0 && currentTime >= duration ? 0 : currentTime;
      try {
        r.play(from);
      } catch {
        /* ignore */
      }
      setPlaying(true);
    }
  };

  const seek = (ms: number) => {
    const r = replayerRef.current;
    if (!r) return;
    setCurrentTime(ms);
    try {
      r.play(ms);
    } catch {
      /* ignore */
    }
    setPlaying(true);
  };

  if (playable.length < 2) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          fontSize: 13,
          padding: 24,
          textAlign: 'center',
        }}
      >
        {t('replay.notPlayable')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', position: 'relative', background: 'var(--mirror-bg)' }}>
        <ScaleContainer vpWidth={vpWidth} vpHeight={vpHeight} scale={1} onScale={() => {}}>
          <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />
        </ScaleContainer>
      </div>

      {/* 控制条 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 10px',
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button onClick={togglePlay} style={{ minWidth: 76 }}>
          {playing ? t('replay.pause') : t('replay.play')}
        </button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', minWidth: 84, textAlign: 'center' }}>
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          value={Math.min(currentTime, duration)}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t('replay.speed')}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => setSpeed(sp)}
              style={{
                background: speed === sp ? 'var(--bg-selected)' : 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                padding: '1px 6px',
                fontSize: 11,
              }}
            >
              {sp}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
