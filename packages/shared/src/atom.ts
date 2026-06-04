/**
 * SpyAtom — 跨端 JS 值的序列化表示。
 * 借鉴 CDP RemoteObject，简化为事件流场景所需的最小集合。
 * 用于 console 参数、网络 body、eval 结果等任意 JS 值的安全传输。
 */
export interface SpyAtom {
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'undefined'
    | 'bigint'
    | 'symbol'
    | 'function'
    | 'object'
    | 'array'
    | 'date'
    | 'regexp'
    | 'error'
    | 'node';
  /** 原始值（仅 primitive 类型携带） */
  value?: string | number | boolean | null;
  /** 预览字符串，所有类型都有（如 "Object { foo: 1 }"） */
  display: string;
  /** 容器类型的子项（object/array/error） */
  children?: SpyAtomEntry[];
  /** 是否为循环引用 */
  circular?: boolean;
  /** 是否因深度/大小限制被截断 */
  truncated?: boolean;
}

/** 容器子项：键 + 值 */
export interface SpyAtomEntry {
  key: string;
  value: SpyAtom;
}
