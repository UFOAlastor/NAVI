// 界面语言文本配置
const translations = {
  'zh': {
    // 页面标题
    'title': 'NAVI - 智能划词助手',
    // 设置页面
    'settings': 'NAVI 设置',
    'generalSettings': '通用设置',
    'enableTriggerButton': '触发按钮',
    'triggerButtonDescription': '启用后，划词不会立即触发解释，而是显示触发按钮',
    'selectionDelay': '划词延时',
    'msUnit': '毫秒',
    'selectionDelayDescription': '划词后等待延时才触发处理',
    'defaultAiService': '默认AI服务',
    'selectDefaultAiService': '选择默认AI服务：',
    'translationSettings': '翻译设置',
    'selectTargetLanguage': '选择目标语言：',
    'selectPrimaryTargetLanguage': '选择主选目标语言：',
    'selectSecondaryTargetLanguage': '选择次选目标语言：',
    'apiKey': 'API密钥',
    'openaiApiKey': 'OpenAI API密钥',
    'openaiApiUrl': 'OpenAI API地址（默认: api.openai.com）',
    'selectOpenaiModel': '选择OpenAI模型：',
    'ollamaSettings': 'Ollama设置',
    'ollamaServerAddress': 'Ollama服务器地址',
    'selectModel': '选择模型...',
    'saveSettings': '保存设置',
    'settingsSaved': '设置已保存，即将刷新当前页面...',
    'saveFailed': '保存失败: ',
    'pleaseConfigApiKey': '请配置API密钥以开始使用',
    'interfaceLanguage': '界面语言：',
    'checkingOllamaConnection': '正在检查Ollama服务连接...',
    'ollamaConnectionFailed': 'Ollama服务连接检查失败: ',
    'interfaceLoadError': '界面加载错误，请刷新重试',
    'inputOpenaiKey': '请输入OpenAI API密钥',
    'inputOllamaAddress': '请输入Ollama服务器地址',
    // 语言名称
    'zh_lang': '中文 (简体)',
    'en_lang': '英文',
    'ja_lang': '日文',
    'ko_lang': '韩文',
    'fr_lang': '法文',
    'de_lang': '德文',
    'es_lang': '西班牙文',
    'ru_lang': '俄文',
    'it_lang': '意大利文',
    'pt_lang': '葡萄牙文',
    'nl_lang': '荷兰文',
    'ar_lang': '阿拉伯文',
    // 故障排除页面
    'troubleshooting_title': 'NAVI - Ollama 连接故障排除',
    'troubleshooting_heading': 'NAVI - Ollama 连接故障排除指南',
    'troubleshooting_note': '此页面提供了连接本地 Ollama 服务的常见问题解决方案。'
  },
  'en': {
    // 页面标题
    'title': 'NAVI - Smart Text Selection Assistant',
    // 设置页面
    'settings': 'NAVI Settings',
    'generalSettings': 'General Settings',
    'enableTriggerButton': 'Trigger Button',
    'triggerButtonDescription': 'When enabled, the text selection will not immediately trigger an explanation, but instead display a trigger button',
    'selectionDelay': 'Selection Delay',
    'msUnit': 'ms',
    'selectionDelayDescription': 'How long to wait after selection before processing',
    'defaultAiService': 'Default AI Service',
    'selectDefaultAiService': 'Select Default AI Service:',
    'translationSettings': 'Translation Settings',
    'selectTargetLanguage': 'Select Target Language:',
    'selectPrimaryTargetLanguage': 'Select Primary Target Language:',
    'selectSecondaryTargetLanguage': 'Select Secondary Target Language:',
    'apiKey': 'API Key',
    'openaiApiKey': 'OpenAI API Key',
    'openaiApiUrl': 'OpenAI API URL (Default: api.openai.com)',
    'selectOpenaiModel': 'Select OpenAI Model:',
    'ollamaSettings': 'Ollama Settings',
    'ollamaServerAddress': 'Ollama Server Address',
    'selectModel': 'Select Model...',
    'saveSettings': 'Save Settings',
    'settingsSaved': 'Settings saved, current page will refresh shortly...',
    'saveFailed': 'Save failed: ',
    'pleaseConfigApiKey': 'Please configure API key to start using',
    'interfaceLanguage': 'Interface Language:',
    'checkingOllamaConnection': 'Checking Ollama service connection...',
    'ollamaConnectionFailed': 'Ollama service connection check failed: ',
    'interfaceLoadError': 'Interface loading error, please refresh and try again',
    'inputOpenaiKey': 'Please enter OpenAI API Key',
    'inputOllamaAddress': 'Please enter Ollama server address',
    // 语言名称
    'zh_lang': 'Chinese (Simplified)',
    'en_lang': 'English',
    'ja_lang': 'Japanese',
    'ko_lang': 'Korean',
    'fr_lang': 'French',
    'de_lang': 'German',
    'es_lang': 'Spanish',
    'ru_lang': 'Russian',
    'it_lang': 'Italian',
    'pt_lang': 'Portuguese',
    'nl_lang': 'Dutch',
    'ar_lang': 'Arabic',
    // 故障排除页面
    'troubleshooting_title': 'NAVI - Ollama Connection Troubleshooting',
    'troubleshooting_heading': 'NAVI - Ollama Connection Troubleshooting Guide',
    'troubleshooting_note': 'This page provides solutions for common issues when connecting to a local Ollama service.'
  }
};

// 默认语言
let currentLanguage = 'zh';

// 初始化函数，尝试从存储中加载当前语言设置
async function init() {
  try {
    // 从chrome存储中获取界面语言设置
    const config = await new Promise((resolve) => {
      chrome.storage.sync.get(['config'], (result) => {
        resolve(result.config || {});
      });
    });

    // 如果存在界面语言设置则使用，否则默认为中文
    currentLanguage = config.uiLanguage || 'zh';
  } catch (error) {
    console.error('初始化i18n模块失败:', error);
  }
}

// 获取翻译文本
function t(key) {
  const langData = translations[currentLanguage] || translations['zh'];
  return langData[key] || key;
}

// 切换语言
function setLanguage(lang) {
  if (translations[lang]) {
    currentLanguage = lang;
  }
}

// 获取当前语言
function getCurrentLanguage() {
  return currentLanguage;
}

// 获取所有支持的语言
function getSupportedLanguages() {
  return Object.keys(translations);
}

export default {
  init,
  t,
  setLanguage,
  getCurrentLanguage,
  getSupportedLanguages
};