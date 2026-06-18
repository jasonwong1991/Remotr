/**
 * UA → 人类可读设备名解析。
 * 用于 Dashboard / Session / 回放列表快速定位真实设备（尤其是匿名场景）。
 */

/**
 * 解析设备型号 + 系统版本。无法识别时返回 null（调用方回退到原始 ID）。
 *
 * 示例输出：
 *  - "iPhone · iOS 17.4"（iOS UA 不含具体型号，只能给出产品线 + 版本）
 *  - "V2309A · Android 13"（安卓 UA 自带型号，vivo/xiaomi 等型号可直接定位设备）
 *  - "Mac · macOS 10.15" / "Windows 10/11" / "Linux"
 */
export function parseDevice(ua: string | undefined): string | null {
  if (!ua) return null;

  // iOS: "(iPhone; CPU iPhone OS 17_4 like Mac OS X)" / "(iPad; CPU OS 16_3 …)"
  let m = /\((iPhone|iPad|iPod)[^)]*?OS (\d+(?:_\d+)*)/.exec(ua);
  if (m) return `${m[1]} · iOS ${m[2].replace(/_/g, '.')}`;

  // 纯血鸿蒙（HarmonyOS NEXT / ArkWeb）："(Phone; OpenHarmony 5.0) … ArkWeb/…"
  // 不含 Android；设备段是通用 Phone/Tablet（隐私保护，类似 iOS 不暴露型号）。
  m = /OpenHarmony (\d+(?:\.\d+)*)/.exec(ua);
  if (m) return `HarmonyOS ${m[1]}`;

  // 兼容模式鸿蒙：华为 UA 在 Android 段后附带 "HarmonyOS X.Y" + AOSP 型号。
  // 放在 Android 分支之前，使带 HarmonyOS 标识的设备归类为鸿蒙而非 Android。
  m = /HarmonyOS ([\d.]+)/.exec(ua);
  if (m) {
    const ver = m[1];
    const mm = /Android [\d.]+;\s*([^;)]+)/.exec(ua);
    const model = mm ? mm[1].replace(/\s*Build\/.*$/, '').trim() : '';
    return model ? `${model} · HarmonyOS ${ver}` : `HarmonyOS ${ver}`;
  }

  // Android: "(Linux; Android 13; V2309A)" / "(Linux; Android 10; MI 8 Build/xxx; wv)"
  m = /Android ([\d.]+)/.exec(ua);
  if (m) {
    const ver = m[1];
    let mm = /Android [\d.]+;\s*([^;)]+)/.exec(ua);
    let model = mm ? mm[1].replace(/\s*Build\/.*$/, '').trim() : '';
    // 老式 UA 在型号前还有 locale 段（"Android 4.4; zh-cn; MI 4 Build/…"）
    if (/^[a-z]{2}(-[a-zA-Z]{2,4})?$/.test(model)) {
      mm = /Android [\d.]+;\s*[a-z]{2}(?:-[a-zA-Z]{2,4})?;\s*([^;)]+)/.exec(ua);
      model = mm ? mm[1].replace(/\s*Build\/.*$/, '').trim() : '';
    }
    return model ? `${model} · Android ${ver}` : `Android ${ver}`;
  }

  // macOS: "Macintosh; Intel Mac OS X 10_15_7"
  m = /Mac OS X (\d+(?:[_.]\d+)*)/.exec(ua);
  if (m) return `Mac · macOS ${m[1].replace(/_/g, '.')}`;

  // Windows: "Windows NT 10.0"（10.0 覆盖 Win10/11，UA 无法区分）
  m = /Windows NT (\d+\.\d+)/.exec(ua);
  if (m) return `Windows ${m[1] === '10.0' ? '10/11' : m[1]}`;

  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

/** 设备展示名：解析成功 → "型号 · 系统 (dev_xxx…)"；失败 → 原始 deviceId。 */
export function deviceDisplay(deviceId: string, ua: string | undefined): string {
  const label = parseDevice(ua);
  return label ? `${label} (${deviceId.slice(0, 10)}…)` : deviceId;
}
