import type { StorageType } from '@remotr/shared';
import type { Transport } from '../transport.js';

/**
 * Storage 插件：采集 localStorage / sessionStorage / cookie。
 * - 连接建立时发送全量快照
 * - 劫持 setItem/removeItem/clear 上报增量
 * - 响应调试端的 storage.* 命令（读/写/删/清）
 */
export function installStorage(transport: Transport): void {
  // 连接建立后推送初始快照
  transport.onConnected(() => {
    sendSnapshot(transport, 'local');
    sendSnapshot(transport, 'session');
    sendSnapshot(transport, 'cookie');
  });

  hookStorage(transport, 'local', window.localStorage);
  hookStorage(transport, 'session', window.sessionStorage);

  // 命令处理
  transport.onCommand('storage.getAll', (data) => {
    const { storageType } = data as { storageType: StorageType };
    sendSnapshot(transport, storageType);
    return { ok: true };
  });

  transport.onCommand('storage.set', (data) => {
    const { storageType, key, value } = data as {
      storageType: StorageType;
      key: string;
      value: string;
    };
    if (storageType === 'cookie') {
      document.cookie = `${key}=${encodeURIComponent(value)}`;
    } else {
      getStore(storageType)?.setItem(key, value);
    }
    return { ok: true };
  });

  transport.onCommand('storage.delete', (data) => {
    const { storageType, key } = data as { storageType: StorageType; key: string };
    if (storageType === 'cookie') {
      document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    } else {
      getStore(storageType)?.removeItem(key);
    }
    return { ok: true };
  });

  transport.onCommand('storage.clear', (data) => {
    const { storageType } = data as { storageType: StorageType };
    if (storageType === 'cookie') {
      for (const [k] of readCookies()) {
        document.cookie = `${k}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      }
    } else {
      getStore(storageType)?.clear();
    }
    return { ok: true };
  });
}

function getStore(type: StorageType): Storage | null {
  if (type === 'local') return window.localStorage;
  if (type === 'session') return window.sessionStorage;
  return null;
}

function readEntries(type: StorageType): Array<[string, string]> {
  if (type === 'cookie') return readCookies();
  const store = getStore(type);
  if (!store) return [];
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k !== null) entries.push([k, store.getItem(k) ?? '']);
  }
  return entries;
}

function readCookies(): Array<[string, string]> {
  if (!document.cookie) return [];
  return document.cookie.split('; ').map((pair) => {
    const idx = pair.indexOf('=');
    const k = idx >= 0 ? pair.slice(0, idx) : pair;
    const v = idx >= 0 ? decodeURIComponent(pair.slice(idx + 1)) : '';
    return [k, v] as [string, string];
  });
}

function sendSnapshot(transport: Transport, type: StorageType): void {
  try {
    transport.send('storage.snapshot', {
      storageType: type,
      entries: readEntries(type),
    });
  } catch {
    /* ignore */
  }
}

/** 劫持 Storage 写操作上报增量变化 */
function hookStorage(transport: Transport, type: StorageType, store: Storage): void {
  const origSet = store.setItem.bind(store);
  const origRemove = store.removeItem.bind(store);
  const origClear = store.clear.bind(store);

  const wrappedSet = (key: string, value: string) => {
    origSet(key, value);
    try {
      transport.send('storage.change', { storageType: type, action: 'set', key, value });
    } catch {
      /* ignore */
    }
  };

  const wrappedRemove = (key: string) => {
    origRemove(key);
    try {
      transport.send('storage.change', { storageType: type, action: 'remove', key });
    } catch {
      /* ignore */
    }
  };

  const wrappedClear = () => {
    origClear();
    try {
      transport.send('storage.change', { storageType: type, action: 'clear' });
    } catch {
      /* ignore */
    }
  };

  try {
    // Use defineProperty instead of direct assignment: some webview kernels
    // set writable:false on Storage methods, making = assignment throw.
    // defineProperty still works when configurable:true (common case).
    Object.defineProperties(store, {
      setItem: { value: wrappedSet, writable: true, configurable: true },
      removeItem: { value: wrappedRemove, writable: true, configurable: true },
      clear: { value: wrappedClear, writable: true, configurable: true },
    });
  } catch {
    // Storage is frozen/sealed — cannot intercept.
    // Some modified webviews protect Storage.prototype from any mutation.
    // Skip silently: storage monitoring degrades gracefully.
  }
}
