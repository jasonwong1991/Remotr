/**
 * Home 页面
 * 列出服务端当前所有活跃项目（服务端叫 room），点击进入对应 Dashboard；
 * 也可按名字直接打开一个尚未有连接的项目（拿注入代码）。
 */

import React, { useEffect, useState } from 'react';
import { navigateToDashboard } from '../router';
import ThemeToggle from '../components/ThemeToggle';
import LanguageToggle from '../components/LanguageToggle';
import { useT } from '../i18n';

/** GET /api/rooms 的一项 */
interface ProjectSummary {
  id: string;
  hasSdk: boolean;
  online: number;
  debuggers: number;
  sessions: number;
}

/** 房间只在有成员时存在于内存，轮询即可反映上下线；不必再开一条 WS */
const POLL_MS = 3000;

export default function Home(): React.ReactElement {
  const t = useT();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [input, setInput] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/rooms');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = (await res.json()) as ProjectSummary[];
        if (!alive) return;
        // 有在线设备的排前面，其余按名字
        list.sort((a, b) => Number(b.hasSdk) - Number(a.hasSdk) || a.id.localeCompare(b.id));
        setProjects(list);
        setLoadError(false);
      } catch {
        if (alive) setLoadError(true);
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const openByName = () => {
    const name = input.trim();
    if (name) navigateToDashboard(name);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* 顶部栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: 16, margin: 0, color: 'var(--text-primary)' }}>{t('home.title')}</h1>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>·</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('home.projects')}
          {projects && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              {t('home.active', { count: projects.length })}
            </span>
          )}
        </span>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
        <LanguageToggle />
      </div>

      {/* 按名字打开 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 20px',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && openByName()}
          placeholder={t('home.openPlaceholder')}
          style={{
            width: 260,
            height: 28,
            fontSize: 11,
            padding: '0 8px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            color: 'var(--text-primary)',
          }}
        />
        <button
          onClick={openByName}
          disabled={!input.trim()}
          style={{
            background: 'var(--accent-blue)',
            color: '#fff',
            border: 'none',
            padding: '5px 12px',
            borderRadius: 3,
            cursor: input.trim() ? 'pointer' : 'not-allowed',
            opacity: input.trim() ? 1 : 0.5,
            fontSize: 11,
          }}
        >
          {t('home.open')}
        </button>
        {loadError && <span style={{ fontSize: 11, color: 'var(--accent-red)' }}>⚠ {t('home.loadError')}</span>}
      </div>

      {/* 项目卡片 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {projects && projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', maxWidth: 560, margin: '0 auto', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📡</div>
            <h2 style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 12 }}>{t('home.noProjects')}</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('home.noProjectsHint')}</p>
          </div>
        ) : (
          <div
            style={{
              maxWidth: 1200,
              margin: '0 auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            }}
          >
            {projects?.map((p) => <ProjectCard key={p.id} project={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }): React.ReactElement {
  const t = useT();
  return (
    <div
      onClick={() => navigateToDashboard(project.id)}
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent-blue)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: project.hasSdk ? '#4caf50' : '#858585',
            flexShrink: 0,
          }}
        />
        <strong
          title={project.id}
          style={{
            fontSize: 14,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {project.id}
        </strong>
      </div>
      <div style={{ fontSize: 12 }}>
        <span style={{ color: project.online > 0 ? 'var(--accent-green)' : 'var(--text-muted)' }}>
          {t('dashboard.online', { count: project.online })}
        </span>
        <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{t('dashboard.total', { count: project.sessions })}</span>
        <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>· {t('home.debuggers', { count: project.debuggers })}</span>
      </div>
    </div>
  );
}
