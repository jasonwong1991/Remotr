import type { StorageType } from '@remotr/shared';
import type { Transport } from '../transport.js';

/**
 * Storage 插件：采集 localStorage / sessionStorage / cookie。
 * - 连接建立时发送全量快照
 * - 劫持 setItem/removeItem/clear 上报增量
 * - 响应调试端的 storage.* 命令（读/写/删/清）
 *
 * 禁用 storage 的 iframe / 隐私模式下访问 window.localStorage 本身就会抛
 * SecurityError —— 一律经 getStore() 取，拿不到就只降级该类存储。
 */
export function installStorage(transport: Transport): () => void {
  // 连接建立后推送初始快照
  transport.onConnected(() => {
    sendSnapshot(transport, 'local');
    sendSnapshot(transport, 'session');
    sendSnapshot(transport, 'cookie');
  });

  const local = getStore('local');
  const session = getStore('session');
  const restoreLocal = local ? hookStorage(transport, 'local', local) : null;
  const restoreSession = session ? hookStorage(transport, 'session', session) : null;

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
      // 固定 path=/：否则写在当前路径下，换个路由就"消失"，也删不掉
      document.cookie = `${key}=${encodeURIComponent(value)}; path=/`;
    } else {
      getStore(storageType)?.setItem(key, value);
    }
    return { ok: true };
  });

  transport.onCommand('storage.delete', (data) => {
    const { storageType, key } = data as { storageType: StorageType; key: string };
    if (storageType === 'cookie') {
      deleteCookie(key);
    } else {
      getStore(storageType)?.removeItem(key);
    }
    return { ok: true };
  });

  transport.onCommand('storage.clear', (data) => {
    const { storageType } = data as { storageType: StorageType };
    if (storageType === 'cookie') {
      for (const [k] of readCookies()) deleteCookie(k);
    } else {
      getStore(storageType)?.clear();
    }
    return { ok: true };
  });

  return () => {
    try {
      restoreLocal?.();
    } catch {
      /* best-effort */
    }
    try {
      restoreSession?.();
    } catch {
      /* best-effort */
    }
  };
}

/**
 * 删除 cookie：同名 cookie 可能带 path=/ 也可能是默认路径（当前目录），
 * 两种都过期一遍；其他 path/domain 下的从 JS 无法删除。
 */
function deleteCookie(key: string): void {
  const expired = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
  document.cookie = `${key}=; ${expired}; path=/`;
  document.cookie = `${key}=; ${expired}`;
}

/** SDK 内部键前缀：这些写入是 SDK 自己的（如 session 心跳），不应采集成 storage.change */
function isInternalKey(key: string): boolean {
  return key.indexOf('__remotr_') === 0;
}

function getStore(type: StorageType): Storage | null {
  try {
    if (type === 'local') return window.localStorage;
    if (type === 'session') return window.sessionStorage;
  } catch {
    /* 禁用 storage 的环境读取属性即抛 SecurityError */
  }
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

/** 逐条解析 cookie；单条 URI 编码损坏（如第三方 SDK 写的 %E0%A4%A）不拖垮整份快照 */
function readCookies(): Array<[string, string]> {
  let raw = '';
  try {
    raw = document.cookie;
  } catch {
    return [];
  }
  if (!raw) return [];
  return raw.split('; ').map((pair) => {
    const idx = pair.indexOf('=');
    const k = idx >= 0 ? pair.slice(0, idx) : pair;
    const encoded = idx >= 0 ? pair.slice(idx + 1) : '';
    let v = encoded;
    try {
      v = decodeURIComponent(encoded);
    } catch {
      /* 保留原文 */
    }
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

/** 劫持 Storage 写操作上报增量变化。返回还原原始方法的函数。 */
function hookStorage(transport: Transport, type: StorageType, store: Storage): () => void {
  const origSet = store.setItem.bind(store);
  const origRemove = store.removeItem.bind(store);
  const origClear = store.clear.bind(store);

  const wrappedSet = (key: string, value: string) => {
    origSet(key, value);
    if (isInternalKey(key)) return; // 跳过 SDK 自身写入，避免自噪声
    try {
      transport.send('storage.change', { storageType: type, action: 'set', key, value });
    } catch {
      /* ignore */
    }
  };

  const wrappedRemove = (key: string) => {
    origRemove(key);
    if (isInternalKey(key)) return;
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
    return () => {
      /* nothing was hooked */
    };
  }

  return () => {
    try {
      Object.defineProperties(store, {
        setItem: { value: origSet, writable: true, configurable: true },
        removeItem: { value: origRemove, writable: true, configurable: true },
        clear: { value: origClear, writable: true, configurable: true },
      });
    } catch {
      /* best-effort restore */
    }
  };
}
