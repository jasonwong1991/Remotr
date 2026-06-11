import React, { useEffect } from 'react';
import { useRoute, navigateToDashboard } from './router';
import Dashboard from './pages/Dashboard';
import SessionView from './pages/SessionView';
import ReplayView from './pages/ReplayView';
import { switchTargetSession } from './ws';

export default function App(): React.ReactElement {
  const route = useRoute();
  const room = route.params.get('room') || 'default';

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

  if (route.name === 'session') {
    const deviceId = route.params.get('deviceId') || '';
    const pageId = route.params.get('pageId') || '';
    return <SessionView room={room} deviceId={deviceId} pageId={pageId} onBack={() => navigateToDashboard(room)} />;
  }

  if (route.name === 'replay') {
    return <ReplayView room={room} onBack={() => navigateToDashboard(room)} />;
  }

  return <Dashboard room={room} />;
}
