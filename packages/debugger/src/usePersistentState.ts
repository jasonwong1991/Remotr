/**
 * usePersistentState
 * 与 useState 接口兼容、但把值同步到 localStorage 的持久化状态 Hook。
 *
 * 设计目标:让 Dashboard 的筛选/搜索/分组等交互状态在页面刷新、
 * 或从 Session 返回后自动恢复,避免用户重复操作。
 *
 * - 存储键统一加 `remotr.` 前缀,与 theme/locale 的约定保持一致。
 * - 支持自定义序列化(Set 等非 JSON 原生类型),默认走 JSON。
 * - key 变化(如切换 room)时自动加载新 key 对应的存储值。
 * - localStorage 不可用(隐私模式/超配额)时静默降级为纯内存状态。
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

const PREFIX = 'remotr.';

export interface Serde<T> {
  serialize: (value: T) => string;
  deserialize: (raw: string) => T;
}

const jsonSerde: Serde<unknown> = {
  serialize: (v) => JSON.stringify(v),
  deserialize: (raw) => JSON.parse(raw) as unknown,
};

/** Set<string> 的序列化器:数组 <-> Set,供过滤器的多选状态使用。 */
export const stringSetSerde: Serde<Set<string>> = {
  serialize: (s) => JSON.stringify([...s]),
  deserialize: (raw) => new Set<string>(JSON.parse(raw) as string[]),
};

function read<T>(key: string, initial: T, serde: Serde<T>): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw == null) return initial;
    return serde.deserialize(raw);
  } catch {
    // 读取或反序列化失败:回退到初始值,避免坏数据阻塞渲染
    return initial;
  }
}

export function usePersistentState<T>(
  key: string,
  initial: T,
  serde: Serde<T> = jsonSerde as Serde<T>,
): [T, Dispatch<SetStateAction<T>>] {
  // serde 以 ref 保存,既保证 effect 读到最新实现,又不必纳入依赖数组
  const serdeRef = useRef(serde);
  serdeRef.current = serde;

  const [value, setValue] = useState<T>(() => read(key, initial, serde));

  // key 变化(典型场景:切换 room)时,同步切到新 key 的持久化值。
  // 采用 React 官方“渲染期间根据 props 调整 state”模式,以守卫避免死循环。
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setValue(read(key, initial, serdeRef.current));
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFIX + key, serdeRef.current.serialize(value));
    } catch {
      // localStorage 不可用:降级为纯内存状态,不影响功能
    }
  }, [key, value]);

  return [value, setValue];
}
