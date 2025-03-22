import { AIServiceFactory } from './services/ai-service';

class SelectionHandler {
  constructor() {
    this.popup = null;
    this.aiService = null;
    this.init();
  }

  async init() {
    // 初始化AI服务
    const config = await this.getConfig();
    this.aiService = AIServiceFactory.createService(config.defaultService, config);

    // 创建弹出窗口
    this.createPopup();

    // 监听选择事件
    document.addEventListener('mouseup', this.handleSelection.bind(this));

    // 添加一个日志，确认内容脚本已加载
    console.log('NAVI: 内容脚本已加载，划词功能已启用');

    // 添加一个示例划词测试
    setTimeout(() => {
      const testEvent = new MouseEvent('mouseup');
      document.dispatchEvent(testEvent);
      console.log('NAVI: 发送了测试划词事件');
    }, 1000);
  }

  async getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['config'], (result) => {
        const defaultConfig = {
          defaultService: 'openai',
          apiKeys: {},
          apiUrls: {
            openai: 'https://api.openai.com/v1'
          },
          openaiConfig: {
            model: 'gpt-4o-mini'
          },
          ollamaConfig: {
            baseUrl: 'http://localhost:11434',
            model: 'qwen2.5:7b'
          },
          translationConfig: {
            targetLanguage: 'zh'
          }
        };

        // 合并默认配置和存储的配置
        const config = result.config ? {...defaultConfig, ...result.config} : defaultConfig;

        // 确保apiKeys存在
        config.apiKeys = config.apiKeys || {};

        // 确保apiUrls存在
        config.apiUrls = config.apiUrls || defaultConfig.apiUrls;

        // 确保translationConfig存在
        config.translationConfig = config.translationConfig || defaultConfig.translationConfig;

        console.log('NAVI: 加载的配置:', config);
        resolve(config);
      });
    });
  }

  createPopup() {
    this.popup = document.createElement('div');
    this.popup.className = 'navi-popup';
    this.popup.style.display = 'none';
    document.body.appendChild(this.popup);

    // 添加拖动功能
    this.initDraggable();
  }

  // 初始化拖动功能
  initDraggable() {
    let isDragging = false;
    let offsetX, offsetY;

    // 鼠标按下事件
    this.popup.addEventListener('mousedown', (e) => {
      // 避免干扰内部元素的点击事件
      if (e.target.classList.contains('navi-popup') || e.target.closest('.navi-draggable-area')) {
        isDragging = true;
        offsetX = e.clientX - this.popup.getBoundingClientRect().left;
        offsetY = e.clientY - this.popup.getBoundingClientRect().top;
        this.popup.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    // 鼠标移动事件
    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const x = e.clientX - offsetX;
        const y = e.clientY - offsetY;
        this.popup.style.left = `${x}px`;
        this.popup.style.top = `${y}px`;
      }
    });

    // 鼠标释放事件
    document.addEventListener('mouseup', () => {
      isDragging = false;
      this.popup.style.cursor = '';
    });
  }

  async handleSelection(event) {
    console.log('NAVI: 划词事件被触发');

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    console.log('NAVI: 选中的文本:', selectedText ? selectedText : '无');

    if (!selectedText) {
      this.hidePopup();
      return;
    }

    // 获取选中文本的位置
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    console.log('NAVI: 选中文本的位置:', rect);

    // 显示加载状态
    this.showLoadingPopup(rect);

    try {
      // 检查配置
      const config = await this.getConfig();
      // 将配置保存到实例变量，以便其他方法可以访问
      this.config = config;
      console.log('NAVI: 配置加载完成', config);

      // 确保AI服务已初始化
      if (!this.aiService) {
        console.log('NAVI: 重新初始化AI服务');
        this.aiService = AIServiceFactory.createService(config.defaultService, config);
      }

      // 检查OpenAI配置
      if (config.defaultService === 'openai' && !config.apiKeys?.openai) {
        throw new Error('OpenAI API密钥未配置，请在插件设置中添加密钥');
      }

      // 检查Ollama配置
      if (config.defaultService === 'ollama' && (!config.ollamaConfig?.baseUrl || !config.ollamaConfig?.model)) {
        throw new Error('Ollama配置不完整，请在插件设置中完成配置');
      }

      // 获取目标语言
      const targetLanguage = config.translationConfig?.targetLanguage || 'zh';
      const loadingText = this.getLoadingText(targetLanguage);

      // 更新加载状态
      this.updateLoadingStatus(rect, loadingText.analyzing);

      // 单一API调用，获取翻译、解释和领域信息
      const result = await this.aiService.translate(selectedText, targetLanguage);

      // 显示结果
      this.showResultPopup(rect, result);
    } catch (error) {
      console.error('处理选中文本时出错:', error);
      this.showErrorPopup(rect, error);
    }
  }

  // 获取语言名称的辅助函数
  getLanguageName(langCode) {
    const langMap = {
      'zh': '中文',
      'en': '英文',
      'ja': '日文',
      'ko': '韩文',
      'fr': '法文',
      'de': '德文',
      'es': '西班牙文',
      'ru': '俄文',
      'it': '意大利文',
      'pt': '葡萄牙文',
      'nl': '荷兰文',
      'ar': '阿拉伯文',
      'unknown': '未知'
    };
    return langMap[langCode] || langCode;
  }

  // 获取界面文本的辅助函数
  getInterfaceText(targetLang) {
    const textMap = {
      'zh': {
        translation: '翻译',
        domain: '领域',
        explanation: '解释'
      },
      'en': {
        translation: 'Translation',
        domain: 'Domain',
        explanation: 'Explanation'
      },
      'ja': {
        translation: '翻訳',
        domain: '分野',
        explanation: '説明'
      },
      'ko': {
        translation: '번역',
        domain: '영역',
        explanation: '설명'
      },
      'fr': {
        translation: 'Traduction',
        domain: 'Domaine',
        explanation: 'Explication'
      },
      'de': {
        translation: 'Übersetzung',
        domain: 'Bereich',
        explanation: 'Erklärung'
      },
      'es': {
        translation: 'Traducción',
        domain: 'Dominio',
        explanation: 'Explicación'
      },
      'ru': {
        translation: 'Перевод',
        domain: 'Область',
        explanation: 'Объяснение'
      },
      'it': {
        translation: 'Traduzione',
        domain: 'Dominio',
        explanation: 'Spiegazione'
      },
      'pt': {
        translation: 'Tradução',
        domain: 'Domínio',
        explanation: 'Explicação'
      },
      'nl': {
        translation: 'Vertaling',
        domain: 'Domein',
        explanation: 'Uitleg'
      },
      'ar': {
        translation: 'ترجمة',
        domain: 'مجال',
        explanation: 'تفسير'
      }
    };

    // 如果没有对应语言的界面文本，默认使用英文
    return textMap[targetLang] || textMap['en'];
  }

  hidePopup() {
    this.popup.style.display = 'none';
  }

  showLoadingPopup(rect) {
    // 获取目标语言
    const config = this.config || { translationConfig: { targetLanguage: 'zh' } };
    const targetLang = config.translationConfig?.targetLanguage || 'zh';

    // 使用空内容，让::after伪元素显示加载动画
    this.showPopup(rect, '');

    // 直接添加loading类
    this.popup.classList.add('loading');
  }

  updateLoadingStatus(rect, status) {
    // 不再更新状态文字
  }

  // 获取不同语言的加载提示文本
  getLoadingText(targetLang) {
    const textMap = {
      'zh': {
        analyzing: '正在分析...',
        processing: '正在处理...',
        translating: '正在翻译...',
        explaining: '正在解释...'
      },
      'en': {
        analyzing: 'Analyzing...',
        processing: 'Processing...',
        translating: 'Translating...',
        explaining: 'Explaining...'
      },
      'ja': {
        analyzing: '分析中...',
        processing: '処理中...',
        translating: '翻訳中...',
        explaining: '説明中...'
      },
      'ko': {
        analyzing: '분석 중...',
        processing: '처리 중...',
        translating: '번역 중...',
        explaining: '설명 중...'
      },
      'fr': {
        analyzing: 'Analyse en cours...',
        processing: 'Traitement en cours...',
        translating: 'Traduction en cours...',
        explaining: 'Explication en cours...'
      },
      'de': {
        analyzing: 'Analysieren...',
        processing: 'Verarbeitung...',
        translating: 'Übersetzen...',
        explaining: 'Erklären...'
      },
      'es': {
        analyzing: 'Analizando...',
        processing: 'Procesando...',
        translating: 'Traduciendo...',
        explaining: 'Explicando...'
      },
      'ru': {
        analyzing: 'Анализ...',
        processing: 'Обработка...',
        translating: 'Перевод...',
        explaining: 'Объяснение...'
      },
      'it': {
        analyzing: 'Analisi in corso...',
        processing: 'Elaborazione in corso...',
        translating: 'Traduzione in corso...',
        explaining: 'Spiegazione in corso...'
      },
      'pt': {
        analyzing: 'Analisando...',
        processing: 'Processando...',
        translating: 'Traduzindo...',
        explaining: 'Explicando...'
      },
      'nl': {
        analyzing: 'Analyseren...',
        processing: 'Verwerken...',
        translating: 'Vertalen...',
        explaining: 'Uitleggen...'
      },
      'ar': {
        analyzing: 'جاري التحليل...',
        processing: 'جاري المعالجة...',
        translating: 'جاري الترجمة...',
        explaining: 'جاري الشرح...'
      }
    };

    // 如果没有对应语言的界面文本，默认使用英文
    return textMap[targetLang] || textMap['en'];
  }

  showResultPopup(rect, result) {
    this.showPopup(rect, this.formatResult(result));
  }

  showErrorPopup(rect, error) {
    // 获取目标语言
    const config = this.config || { translationConfig: { targetLanguage: 'zh' } };
    const targetLang = config.translationConfig?.targetLanguage || 'zh';

    // 获取错误提示文本
    const errorText = this.getErrorText(targetLang);

    // 创建错误映射表
    const errorMap = {
      'OpenAI API密钥未配置': {
        message: errorText.apiKeyMissing,
        hint: errorText.configureApiKey,
        action: errorText.openSettings,
        actionFn: () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' })
      },
      'OpenAI API密钥无效': {
        message: errorText.apiKeyInvalid,
        hint: errorText.checkApiKey,
        action: errorText.openSettings,
        actionFn: () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' })
      },
      '网络连接': {
        message: errorText.networkError,
        hint: errorText.checkNetwork,
        action: errorText.retry,
        actionFn: () => this.handleSelection(null)
      },
      '权限': {
        message: errorText.permissionError,
        hint: errorText.checkPermissions,
        action: null
      },
      'rate limit': {
        message: errorText.rateLimitExceeded,
        hint: errorText.tryLater,
        action: null
      }
    };

    // 尝试匹配错误类型
    let errorInfo = null;
    const errorMsg = error.message || error.toString();

    for (const key of Object.keys(errorMap)) {
      if (errorMsg.toLowerCase().includes(key.toLowerCase())) {
        errorInfo = errorMap[key];
        break;
      }
    }

    // 如果没有匹配到预定义错误，使用通用错误信息
    if (!errorInfo) {
      errorInfo = {
        message: errorText.processingFailed,
        hint: errorMsg,
        action: errorText.retry,
        actionFn: () => this.handleSelection(null)
      };
    }

    // 构建错误HTML
    const errorHTML = `
      <div class="navi-error">
        <div class="navi-draggable-area"></div>
        <div class="navi-error-icon">⚠️</div>
        <div class="navi-error-message">${errorInfo.message}</div>
        <div class="navi-error-hint">${errorInfo.hint}</div>
        ${errorInfo.action ? `<button class="navi-error-action">${errorInfo.action}</button>` : ''}
      </div>
    `;

    this.showPopup(rect, errorHTML);

    // 错误弹窗也使用与结果弹窗相同的内边距
    this.popup.classList.add('navi-popup-result');

    // 添加事件监听器
    if (errorInfo.action) {
      const actionButton = this.popup.querySelector('.navi-error-action');
      if (actionButton) {
        actionButton.addEventListener('click', errorInfo.actionFn);
      }
    }
  }

  showPopup(rect, content) {
    if (!this.popup) {
      console.error('NAVI: 弹出窗口未初始化');
      return;
    }

    // 清除旧内容和类名
    this.popup.innerHTML = content;

    // 设置基本类名
    this.popup.className = 'navi-popup';

    // 根据内容类型添加适当的类名
    if (content && content.includes('navi-result')) {
      this.popup.classList.add('navi-popup-result');
    }
    // loading类由showLoadingPopup方法直接添加，不在这里处理

    // 定义与浏览器边缘的最小安全距离
    const safeDistance = 20; // 与浏览器边缘保持20px的安全距离

    // 计算位置
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

    // ========= 根据优先级计算位置 =========
    // 1. 首先尝试放在右上角
    let top = rect.top + scrollTop - this.popup.offsetHeight - 10;
    let left = rect.right + scrollLeft + 10;

    // 检查右上角位置是否可行
    let positionFound = true;

    // 检查右侧空间
    if (left + this.popup.offsetWidth > windowWidth + scrollLeft - safeDistance) {
      // 右侧空间不足，先尝试调整左侧位置，但仍保持在右半侧
      const centerX = rect.left + (rect.width / 2) + scrollLeft;
      left = Math.min(windowWidth + scrollLeft - this.popup.offsetWidth - safeDistance,
                     Math.max(centerX, windowWidth / 2 + scrollLeft));

      // 如果仍然不可行（没有足够空间），标记为位置未找到
      if (left + this.popup.offsetWidth > windowWidth + scrollLeft - safeDistance) {
        positionFound = false;
      }
    }

    // 检查上方空间
    if (top < scrollTop + safeDistance) {
      // 上方空间不足，尝试放在下方但仍偏向右侧
      top = rect.bottom + scrollTop + 10;

      // 如果下方也不够，标记为位置未找到
      if (top + this.popup.offsetHeight > windowHeight + scrollTop - safeDistance) {
        positionFound = false;
      }
    }

    // 如果上述尝试均失败，最后才考虑左侧
    if (!positionFound) {
      // 尝试放在左侧
      left = rect.left + scrollLeft - this.popup.offsetWidth - 10;

      // 尝试上方
      top = rect.top + scrollTop - this.popup.offsetHeight - 10;

      // 如果上方不行，尝试下方
      if (top < scrollTop + safeDistance) {
        top = rect.bottom + scrollTop + 10;
      }

      // 如果左侧空间也不足，尽量居中显示
      if (left < scrollLeft + safeDistance) {
        left = scrollLeft + (windowWidth - this.popup.offsetWidth) / 2;
      }
    }

    // 最终确保不超出视口边界
    top = Math.max(scrollTop + safeDistance, Math.min(top, windowHeight + scrollTop - this.popup.offsetHeight - safeDistance));
    left = Math.max(scrollLeft + safeDistance, Math.min(left, windowWidth + scrollLeft - this.popup.offsetWidth - safeDistance));

    // 设置位置
    this.popup.style.top = `${top}px`;
    this.popup.style.left = `${left}px`;
    this.popup.style.display = 'block';
  }

  formatResult(result) {
    // 处理结果对象
    const content = result?.translated || result?.explanation || result?.content || result;

    // 获取解释（用户请求的是一句话通俗解释）
    let explanation = result?.explanation || content;
    // 获取翻译
    let translation = result?.translated || content;
    // 获取领域
    let domain = result?.domain || "未知";

    // 同步获取目标语言
    const config = this.config || { translationConfig: { targetLanguage: 'zh' } };
    const targetLang = config.translationConfig?.targetLanguage || 'zh';
    const uiText = this.getInterfaceText(targetLang);

    // 构建结果HTML
    let resultHTML = `
      <div class="navi-result">
        <div class="navi-draggable-area"></div>
        <div class="navi-meta">
          <div class="navi-translation"><strong>${uiText.translation}:</strong> ${translation}</div>
          <div class="navi-domain"><strong>${uiText.domain}:</strong> ${domain}</div>
          <div class="navi-explanation"><strong>${uiText.explanation}:</strong> ${explanation}</div>
        </div>
      </div>
    `;

    return resultHTML;
  }

  // 获取不同语言的错误提示文本
  getErrorText(targetLang) {
    const textMap = {
      'zh': {
        apiKeyMissing: 'API密钥未配置',
        configureApiKey: '请在扩展设置中配置OpenAI API密钥',
        apiKeyInvalid: 'API密钥无效',
        checkApiKey: '请检查您的API密钥是否正确',
        networkError: '网络连接错误',
        checkNetwork: '请检查您的网络连接是否正常',
        permissionError: '权限错误',
        checkPermissions: '请确保扩展有正确的权限',
        rateLimitExceeded: 'API调用次数超限',
        tryLater: '请稍后再试或使用其他服务',
        processingFailed: '处理失败',
        retry: '点击重试',
        openSettings: '点击此处打开设置'
      },
      'en': {
        apiKeyMissing: 'API Key Missing',
        configureApiKey: 'Please configure OpenAI API key in settings',
        apiKeyInvalid: 'API Key Invalid',
        checkApiKey: 'Please check if your API key is correct',
        networkError: 'Network Error',
        checkNetwork: 'Please check your network connection',
        permissionError: 'Permission Error',
        checkPermissions: 'Please ensure the extension has correct permissions',
        rateLimitExceeded: 'API Rate Limit Exceeded',
        tryLater: 'Please try again later or use another service',
        processingFailed: 'Processing Failed',
        retry: 'Click to retry',
        openSettings: 'Click to open settings'
      },
      'ja': {
        apiKeyMissing: 'APIキーが設定されていません',
        configureApiKey: '拡張機能の設定でOpenAI APIキーを設定してください',
        apiKeyInvalid: 'APIキーが無効です',
        checkApiKey: 'APIキーが正しいか確認してください',
        networkError: 'ネットワークエラー',
        checkNetwork: 'ネットワーク接続を確認してください',
        permissionError: '権限エラー',
        checkPermissions: '拡張機能に適切な権限があることを確認してください',
        rateLimitExceeded: 'API利用制限を超えました',
        tryLater: '後で再試行するか、別のサービスを使用してください',
        processingFailed: '処理に失敗しました',
        retry: 'クリックで再試行',
        openSettings: 'クリックして設定を開く'
      }
    };

    // 他の言語はまだ足りない場合は英語をデフォルトとして使用
    return textMap[targetLang] || textMap['en'];
  }
}

// 初始化选择处理器
new SelectionHandler();