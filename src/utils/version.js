// 从manifest.json读取版本号
export function getVersion() {
  return chrome.runtime.getManifest().version;
}