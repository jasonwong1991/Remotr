import React, { useEffect } from 'react';
import { useRoute, readProject, navigateToDashboard } from './router';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import SessionView from './pages/SessionView';
import ReplayView from './pages/ReplayView';
import { switchTargetSession } from './ws';

export default function App(): React.ReactElement {
  const route = useRoute();
  // URL 里叫 project，往下传给各页面仍用服务端的叫法 room（同一概念）
  const project = readProject(route.params);

  useEffect(() => {
    const deviceId = route.params.get('deviceId');
    const pageId = route.params.get('pageId');

    if (route.name === 'session' && deviceId && pageId) {
      switchTargetSession({ deviceId, pageId });
    } else {
      switchTargetSession(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name, route.params.get('deviceId'), route.params.get('pageId')]);

  // 没有项目名就没有可连的房间：一律回首页选项目
  if (route.name === 'home' || !project) {
    return <Home />;
  }

  if (route.name === 'session') {
    const deviceId = route.params.get('deviceId') || '';
    const pageId = route.params.get('pageId') || '';
    return <SessionView room={project} deviceId={deviceId} pageId={pageId} onBack={() => navigateToDashboard(project)} />;
  }

  if (route.name === 'replay') {
    return (
      <ReplayView
        room={project}
        initialDeviceId={route.params.get('deviceId') ?? undefined}
        initialPageId={route.params.get('pageId') ?? undefined}
        onBack={() => navigateToDashboard(project)}
      />
    );
  }

  return <Dashboard room={project} />;
}
