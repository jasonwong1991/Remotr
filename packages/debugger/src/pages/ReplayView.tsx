import React, { useCallback, useEffect, useState } from 'react';
import { decodeFrame } from '@remotr/shared';
import type {
  MethodData,
  RecordingListResponse,
  RecordingSessionInfo,
  RecordingSegmentInfo,
} from '@remotr/shared';
import type { ConsoleRecord, NetworkRecord, RrwebEventRaw } from '../store';
import ThemeToggle from '../components/ThemeToggle';
import LanguageToggle from '../components/LanguageToggle';
import ReplayPlayer from '../panels/ReplayPlayer';
import { ConsoleRow } from '../panels/ConsolePanel';
import { DetailPanel, statusColor, urlName, formatMs } from '../panels/NetworkPanel';
import { useT, type MessageKey } from '../i18n';

interface ReplayViewProps {
  room: string;
  onBack: () => void;
}

/** 解析后的单段数据 */
interface ParsedSegment {
  events: RrwebEventRaw[];
  console: ConsoleRecord[];
  network: NetworkRecord[];
  viewport?: { width: number; height: number };
  url?: string;
}

/** 把一段 JSONL 文本解析为回放所需的事件与记录。 */
function parseSegment(text: string): ParsedSegment {
  const events: RrwebEventRaw[] = [];
  const consoleRecords: ConsoleRecord[] = [];
  const networkMap = new Map<string, NetworkRecord>();
  let viewport: { width: number; height: number } | undefined;
  let url: string | undefined;
  let cid = 0;

  const ensure = (reqId: string): NetworkRecord => {
    let r = networkMap.get(reqId);
    if (!r) {
      r = { reqId };
      networkMap.set(reqId, r);
    }
    return r;
  };

  for (const line of text.split('\n')) {
    if (!line) continue;
    const frame = decodeFrame(line);
    if (!frame || frame.kind !== 'msg') continue;
    const { method, data, timestamp } = frame.envelope;
    switch (method) {
      case 'system.info': {
        const d = data as MethodData['system.info'];
        viewport = d.viewport;
        url = d.url;
        break;
      }
      case 'dom.rrweb': {
        const d = data as MethodData['dom.rrweb'];
        events.push(d.event as RrwebEventRaw);
        break;
      }
      case 'console.entry': {
        const d = data as MethodData['console.entry'];
        consoleRecords.push({ id: `r${cid++}`, type: 'console', level: d.level, entry: d, timestamp });
        break;
      }
      case 'page.error': {
        const d = data as MethodData['page.error'];
        consoleRecords.push({ id: `r${cid++}`, type: 'page-error', level: 'error', pageError: d, timestamp });
        break;
      }
      case 'network.request':
        ensure((data as MethodData['network.request']).reqId).request = data as MethodData['network.request'];
        break;
      case 'network.response':
        ensure((data as MethodData['network.response']).reqId).response = data as MethodData['network.response'];
        break;
      case 'network.error':
        ensure((data as MethodData['network.error']).reqId).error = data as MethodData['network.error'];
        break;
      default:
        break;
    }
  }

  return { events, console: consoleRecords, network: [...networkMap.values()], viewport, url };
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function ReplayView({ room, onBack }: ReplayViewProps): React.ReactElement {
  const t = useT();
  const [list, setList] = useState<RecordingListResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [segment, setSegment] = useState<ParsedSegment | null>(null);
  const [loadingSeg, setLoadingSeg] = useState(false);
  const [dataTab, setDataTab] = useState<'console' | 'network'>('console');

  // 拉取当天录制列表
  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    fetch(`/api/rooms/${encodeURIComponent(room)}/recordings`)
      .then((r) => r.json())
      .then((data: RecordingListResponse) => {
        if (!cancelled) setList(data);
      })
      .catch(() => {
        if (!cancelled) setList(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [room]);

  // 拉取并解析选中的段
  useEffect(() => {
    if (!selectedDir || !selectedFile) {
      setSegment(null);
      return;
    }
    let cancelled = false;
    setLoadingSeg(true);
    setSegment(null);
    fetch(`/api/rooms/${encodeURIComponent(room)}/recordings/${selectedDir}/${selectedFile}`)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setSegment(parseSegment(text));
      })
      .catch(() => {
        if (!cancelled) setSegment(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSeg(false);
      });
    return () => {
      cancelled = true;
    };
  }, [room, selectedDir, selectedFile]);

  const selectSegment = useCallback((dir: string, file: string) => {
    setSelectedDir(dir);
    setSelectedFile(file);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* 顶部栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '4px 12px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        <button onClick={onBack} title={t('replay.backTitle')}>
          {t('replay.back')}
        </button>
        <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>{t('replay.title')}</strong>
        {list && <span style={{ color: 'var(--text-muted)' }}>{list.date}</span>}
        <span title={room} style={{ color: 'var(--text-muted)' }}>· {room}</span>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
        <LanguageToggle />
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧：会话 + 段列表 */}
        <div
          style={{
            width: 256,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-tertiary)',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              fontSize: 11,
              color: 'var(--text-secondary)',
              borderBottom: '1px solid var(--border)',
              position: 'sticky',
              top: 0,
              background: 'var(--bg-secondary)',
            }}
          >
            {t('replay.sessions')}
          </div>

          {loadingList && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>{t('replay.loading')}</div>}

          {!loadingList && list && !list.enabled && (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>{t('replay.disabled')}</div>
          )}

          {!loadingList && list?.enabled && list.sessions.length === 0 && (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>{t('replay.noRecordings')}</div>
          )}

          {list?.sessions.map((s) => (
            <SessionItem
              key={s.dir}
              session={s}
              selectedFile={selectedDir === s.dir ? selectedFile : null}
              onSelectSegment={(file) => selectSegment(s.dir, file)}
              t={t}
            />
          ))}
        </div>

        {/* 主区：回放 + 数据标签 */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {!selectedFile ? (
            <Centered>{loadingList ? t('replay.loading') : t('replay.selectSegment')}</Centered>
          ) : loadingSeg ? (
            <Centered>{t('replay.loading')}</Centered>
          ) : !segment ? (
            <Centered>{t('replay.notPlayable')}</Centered>
          ) : (
            <>
              <div style={{ width: '58%', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
                <ReplayPlayer
                  key={`${selectedDir}/${selectedFile}`}
                  events={segment.events}
                  vpWidth={segment.viewport?.width}
                  vpHeight={segment.viewport?.height}
                />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  {(['console', 'network'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setDataTab(tab)}
                      style={{
                        border: 'none',
                        borderBottom: dataTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent',
                        borderRadius: 0,
                        background: dataTab === tab ? 'var(--bg-primary)' : 'transparent',
                        color: dataTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
                        padding: '6px 14px',
                        cursor: 'pointer',
                        fontSize: 12,
                        textTransform: 'capitalize',
                      }}
                    >
                      {t(`tab.${tab}` as MessageKey)}
                    </button>
                  ))}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {dataTab === 'console' ? (
                    <ConsoleList records={segment.console} />
                  ) : (
                    <NetworkList records={segment.network} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 13,
        padding: 24,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}

function SessionItem({
  session,
  selectedFile,
  onSelectSegment,
  t,
}: {
  session: RecordingSessionInfo;
  selectedFile: string | null;
  onSelectSegment: (file: string) => void;
  t: ReturnType<typeof useT>;
}): React.ReactElement {
  const [open, setOpen] = useState(true);
  const label = session.title || session.url || `${session.session.deviceId.slice(0, 8)}…`;

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-primary)',
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: 12,
        }}
        title={session.url}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 18 }}>
          {session.identity || t('replay.anonymous')} · {t('replay.segmentCount', { count: session.segments.length })}
        </div>
      </button>

      {open &&
        session.segments.map((seg: RecordingSegmentInfo) => {
          const active = selectedFile === seg.file;
          return (
            <button
              key={seg.file}
              onClick={() => onSelectSegment(seg.file)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderRadius: 0,
                background: active ? 'var(--bg-selected)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                padding: '4px 10px 4px 26px',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span>{fmtClock(seg.startTs)}</span>
              <span style={{ color: 'var(--text-muted)' }}>{fmtBytes(seg.bytes)}</span>
            </button>
          );
        })}
    </div>
  );
}

/** 段内 console 列表（带级别 + 文本过滤），复用实时面板的 ConsoleRow。 */
function ConsoleList({ records }: { records: ConsoleRecord[] }): React.ReactElement {
  const t = useT();
  const [level, setLevel] = useState<string>('all');
  const [text, setText] = useState('');
  const levels = ['all', 'error', 'warn', 'info', 'log', 'debug'];

  const filtered = records.filter((r) => {
    if (level !== 'all' && r.level !== level) return false;
    if (text) {
      const hay = r.entry ? r.entry.args.map((a) => a.display).join(' ') : r.pageError?.message ?? '';
      if (!hay.toLowerCase().includes(text.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {levels.map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              style={{
                background: level === l ? 'var(--bg-selected)' : 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                padding: '1px 6px',
                fontSize: 11,
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder={t('console.filter')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, maxWidth: 200 }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>{t('network.noData')}</div>
        ) : (
          filtered.map((r) => <ConsoleRow key={r.id} record={r} />)
        )}
      </div>
    </div>
  );
}

/** 段内 network 列表，复用实时面板的 DetailPanel 展示请求/响应/正文。 */
function NetworkList({ records }: { records: NetworkRecord[] }): React.ReactElement {
  const t = useT();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = records.filter((r) => !filter || (r.request?.url ?? '').toLowerCase().includes(filter.toLowerCase()));
  const selectedRecord = selected ? records.find((r) => r.reqId === selected) ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <input
          type="text"
          placeholder={t('network.filterUrl')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 300 }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{t('network.requests', { count: filtered.length })}</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '34%' }}>{t('network.name')}</th>
              <th style={{ width: '8%' }}>{t('network.method')}</th>
              <th style={{ width: '10%' }}>{t('network.status')}</th>
              <th style={{ width: '12%' }}>{t('network.duration')}</th>
              <th>{t('network.url')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const isSel = selected === r.reqId;
              const status = r.response?.status;
              const hasError = !!r.error;
              return (
                <tr
                  key={r.reqId}
                  onClick={() => setSelected(isSel ? null : r.reqId)}
                  style={{ cursor: 'pointer', background: isSel ? 'var(--bg-selected)' : undefined }}
                >
                  <td style={{ color: hasError ? 'var(--accent-red)' : 'var(--text-primary)', maxWidth: 200 }}>{urlName(r.request?.url)}</td>
                  <td style={{ color: 'var(--accent-purple)' }}>{r.request?.method ?? '—'}</td>
                  <td style={{ color: statusColor(status) }}>{status ?? (hasError ? 'err' : '…')}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.response ? formatMs(r.response.duration) : r.error ? formatMs(r.error.duration) : '—'}</td>
                  <td style={{ color: 'var(--text-muted)', maxWidth: 300 }}>{r.request?.url ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedRecord && <DetailPanel record={selectedRecord} />}
    </div>
  );
}
