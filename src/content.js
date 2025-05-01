import { AIServiceFactory } from './services/ai-service';

class SelectionHandler {
  constructor() {
    this.popup = null;
    this.triggerButton = null;
    this.aiService = null;
    this.debounceTimer = null;
    this.isProcessing = false;
    this.lastSelectedText = '';
    this.config = null;
    this.isDragging = false;
    this.wasDragging = false;
    this.dragStartPos = { x: 0, y: 0 };
    this.dragStartScrollPos = { x: 0, y: 0 };
    this.popupPos = { x: 0, y: 0 };
    this.init();
  }

  async init() {
    console.log('NAVI: 初始化划词工具...');

    // 初始化弹出窗口
    this.popup = document.createElement('div');
    this.popup.className = 'navi-popup';
    this.popup.style.display = 'none';
    document.body.appendChild(this.popup);

    // 初始化触发按钮
    this.triggerButton = document.createElement('div');
    this.triggerButton.className = 'navi-trigger-button';
    this.triggerButton.style.display = 'none';

    // 添加图标图片元素
    const iconImg = document.createElement('img');
    iconImg.src = chrome.runtime.getURL('icons/icon128.png');
    iconImg.style.width = '100%';
    iconImg.style.height = '100%';
    iconImg.style.margin = '0';
    iconImg.style.padding = '0';
    iconImg.style.display = 'block';
    iconImg.style.objectFit = 'contain';
    this.triggerButton.appendChild(iconImg);

    document.body.appendChild(this.triggerButton);

    // 初始化AI服务
    const config = await this.getConfig();
    this.aiService = AIServiceFactory.createService(config.defaultService, config);

    // 初始化拖动功能
    this.initDraggable();

    // 监听选择事件
    document.addEventListener('mouseup', this.handleSelection.bind(this));
    document.addEventListener('touchend', this.handleSelection.bind(this));

    // 监听点击事件，处理文档中的点击
    document.addEventListener('click', (event) => {
      // 检查点击是否在弹出窗口或其子元素上
      if (!this.popup.contains(event.target) && !this.triggerButton.contains(event.target)) {
        this.hidePopup();
      }
    });

    // 监听按下Escape键关闭弹窗
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.hidePopup();
      }
    });

    // 监听配置变更事件
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'CONFIG_UPDATED') {
        console.log('NAVI: 接收到配置更新消息');
        // 重新加载配置并更新AI服务
        this.getConfig().then(config => {
          this.config = config;
          this.aiService = AIServiceFactory.createService(config.defaultService, config);
          console.log('NAVI: 已重新初始化AI服务:', config.defaultService);
        });
      }
    });

    // 添加一个日志，确认内容脚本已加载
    console.log('NAVI: 内容脚本已加载，划词功能已启用');

    // 添加一个示例划词测试
    setTimeout(() => {
      const testEvent = new MouseEvent('mouseup');
      document.dispatchEvent(testEvent);
      console.log('NAVI: 发送了测试划词事件');
    }, 1000);

    console.log('NAVI: 选择处理器初始化完成');
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
            targetLanguage: 'zh',
            secondaryTargetLanguage: 'en',
            primaryLangBehavior: 'auto'
          },
          generalConfig: {
            enableTriggerButton: false,
            selectionDelay: 500, // 默认延时500ms
            ignoreLinks: true
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

        // 确保secondaryTargetLanguage存在
        if (!config.translationConfig.secondaryTargetLanguage) {
          config.translationConfig.secondaryTargetLanguage = defaultConfig.translationConfig.secondaryTargetLanguage;
        }

        // 确保generalConfig存在
        config.generalConfig = config.generalConfig || defaultConfig.generalConfig;

        // 确保selectionDelay存在且为数字
        if (typeof config.generalConfig.selectionDelay !== 'number') {
          config.generalConfig.selectionDelay = defaultConfig.generalConfig.selectionDelay;
        }

        console.log('NAVI: 加载的配置:', config);
        resolve(config);
      });
    });
  }

  // 显示触发按钮
  showTriggerButton(rect, selectedText) {
    if (!this.triggerButton) {
      console.error('NAVI: 触发按钮未初始化');
      return;
    }

    // 如果正在拖动或处理中，不显示按钮
    if (this.isDragging || this.isProcessing) {
      return;
    }

    // 保存当前选中的文本，用于点击时触发处理
    this.lastSelectedText = selectedText;

    // 添加点击事件，当点击按钮时触发翻译
    this.triggerButton.onclick = (e) => {
      console.log('NAVI: 触发按钮被点击');
      // 阻止事件冒泡
      e.stopPropagation();

      // 立即隐藏触发按钮
      this.hideTriggerButton();

      // 设置处理状态，防止在处理过程中再次显示触发按钮
      this.isProcessing = true;

      // 处理选中文本
      this.processSelectedText(selectedText, rect)
        .finally(() => {
          // 处理完成后重置状态
          this.isProcessing = false;
        });
    };

    // 定义与浏览器边缘的最小安全距离
    const safeDistance = 20; // 与浏览器边缘保持20px的安全距离

    // 计算位置
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

    // 触发按钮尺寸
    const buttonSize = 24; // 按钮大小

    // ========= 使用与popupShowup相同的位置计算逻辑 =========
    // 1. 首先尝试放在右上角
    let top = rect.top + scrollTop - buttonSize - 10;
    let left = rect.right + scrollLeft + 10;

    // 检查右上角位置是否可行
    let positionFound = true;

    // 检查右侧空间
    if (left + buttonSize > windowWidth + scrollLeft - safeDistance) {
      // 右侧空间不足，先尝试调整左侧位置，但仍保持在右半侧
      const centerX = rect.left + (rect.width / 2) + scrollLeft;
      left = Math.min(windowWidth + scrollLeft - buttonSize - safeDistance,
                     Math.max(centerX, windowWidth / 2 + scrollLeft));

      // 如果仍然不可行（没有足够空间），标记为位置未找到
      if (left + buttonSize > windowWidth + scrollLeft - safeDistance) {
        positionFound = false;
      }
    }

    // 检查上方空间
    if (top < scrollTop + safeDistance) {
      // 上方空间不足，尝试放在下方但仍偏向右侧
      top = rect.bottom + scrollTop + 10;

      // 如果下方也不够，标记为位置未找到
      if (top + buttonSize > windowHeight + scrollTop - safeDistance) {
        positionFound = false;
      }
    }

    // 如果上述尝试均失败，最后才考虑左侧
    if (!positionFound) {
      // 尝试放在左侧
      left = rect.left + scrollLeft - buttonSize - 10;

      // 尝试上方
      top = rect.top + scrollTop - buttonSize - 10;

      // 如果上方不行，尝试下方
      if (top < scrollTop + safeDistance) {
        top = rect.bottom + scrollTop + 10;
      }

      // 如果左侧空间也不足，尽量居中显示
      if (left < scrollLeft + safeDistance) {
        left = scrollLeft + (windowWidth - buttonSize) / 2;
      }
    }

    // 最终确保不超出视口边界
    top = Math.max(scrollTop + safeDistance, Math.min(top, windowHeight + scrollTop - buttonSize - safeDistance));
    left = Math.max(scrollLeft + safeDistance, Math.min(left, windowWidth + scrollLeft - buttonSize - safeDistance));

    // 设置按钮位置
    this.triggerButton.style.top = `${top}px`;
    this.triggerButton.style.left = `${left}px`;
    this.triggerButton.style.display = 'flex';
  }

  // 隐藏触发按钮
  hideTriggerButton() {
    if (this.triggerButton) {
      console.log('NAVI: 隐藏触发按钮');
      this.triggerButton.style.display = 'none';

      // 清除任何可能的点击事件，防止多次绑定
      this.triggerButton.onclick = null;
    }
  }

  // 处理选中的文本
  async processSelectedText(selectedText, rect) {
    if (!selectedText) {
      this.isProcessing = false;
      return;
    }

    // 检查选中文本是否为链接格式
    if (this.isLinkFormat(selectedText)) {
      console.log('NAVI: 选中文本是链接格式，不处理');
      return;
    }

    try {
      // 确保触发按钮已隐藏
      this.hideTriggerButton();

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

      // 获取目标语言配置
      const targetLanguage = config.translationConfig?.targetLanguage || 'zh';
      const secondaryTargetLanguage = config.translationConfig?.secondaryTargetLanguage || 'en';

      // 检查缓存中是否已存在当前文本的处理结果
      const cacheKey = this.aiService.generateCacheKey('translate', selectedText, { targetLang: targetLanguage, secondaryTargetLang: secondaryTargetLanguage });
      const cachedResult = this.aiService.cache.get(cacheKey);

      if (cachedResult) {
        console.log('NAVI: 从缓存中获取结果:', cachedResult);
        this.showResultPopup(rect, cachedResult);
        return;
      }

      // 显示加载状态
      this.showLoadingPopup(rect);

      console.log('NAVI: 发送AI请求', selectedText);

      // 预备一个初始结果对象，用于提供默认值并初始化结果框
      const initialResult = {
        translated: "...",
        explanation: "...",
        domain: "...",
        sourceLang: 'auto',
        targetLang: targetLanguage,
        timestamp: Date.now()
      };

      // 设置一个标志，避免重复创建结果框
      let resultFrameShown = false;

      // 使用流式API，显示实时结果
      try {
        await this.aiService.translateStream(
          selectedText,
          targetLanguage,
          (partialResult) => {
            try {
              // 检查是否有实际内容
              const hasContent = partialResult.translated || partialResult.explanation || partialResult.domain;

              // 只在有内容时才显示结果框，避免空框闪烁
              if (hasContent && !resultFrameShown) {
                // 如果正在显示加载动画，先去掉loading类
                this.popup.classList.remove('loading');

                // 显示结果框，现在里面有内容了
                this.showResultPopup(rect, partialResult);
                resultFrameShown = true;
              } else if (resultFrameShown) {
                // 持续更新内容
                this.showResultPopup(rect, partialResult);
              }
            } catch (callbackError) {
              console.error('处理部分结果回调时出错:', callbackError);
            }
          },
          (finalResult) => {
            try {
              // 确保结果框已显示
              if (!resultFrameShown) {
                this.popup.classList.remove('loading');
                this.showResultPopup(rect, finalResult || initialResult);
              } else {
                this.showResultPopup(rect, finalResult || initialResult);
              }

              // 所有内容生成完毕，添加闪烁效果
              this.addCompletionEffect();
            } catch (completeError) {
              console.error('处理最终结果回调时出错:', completeError);
            }
          },
          secondaryTargetLanguage // 传递次选目标语言
        );
      } catch (streamError) {
        console.error('流式翻译请求失败:', streamError);

        // 显示错误信息
        this.showErrorPopup(rect, streamError);

        // 为确保用户体验，也可以显示一个基本结果
        if (!resultFrameShown) {
          initialResult.translated = selectedText;
          initialResult.explanation = "翻译服务暂时不可用";
          initialResult.domain = "错误";
          this.showResultPopup(rect, initialResult);
        }
      }
    } catch (error) {
      console.error('NAVI: 处理文本时出错', error);
      // 确保在出错时也会显示错误弹窗
      this.showErrorPopup(rect, error);
    } finally {
      // 确保处理状态被重置
      this.isProcessing = false;
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
    // 如果正在拖动，不隐藏弹窗
    if (this.isDragging) {
      return;
    }

    if (this.popup) {
      this.popup.style.display = 'none';
    }

    // 同时隐藏触发按钮
    this.hideTriggerButton();

    console.log('NAVI: 弹窗和触发按钮已隐藏');
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
    // 如果正在拖动，不应该改变弹窗位置和显示状态
    if (this.isDragging) {
      return;
    }
    this.showPopup(rect, this.formatResult(result));
  }

  showErrorPopup(rect, error) {
    // 如果正在拖动，不应该改变弹窗位置和显示状态
    if (this.isDragging) {
      return;
    }

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
      <div class="navi-draggable-area"></div>
      <div class="navi-error">
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

    // 如果正在拖动，只更新内容，不改变位置
    if (this.isDragging) {
      if (content) {
        this.popup.innerHTML = content;
      }
      return;
    }

    // 保存弹窗当前状态
    const isCurrentlyVisible = this.popup.style.display === 'block';
    const currentLeft = isCurrentlyVisible ? this.popup.style.left : null;
    const currentTop = isCurrentlyVisible ? this.popup.style.top : null;

    // 如果弹窗位置已经设置过且我们要显示相同类型的内容，就保持位置不变
    const isSameContentType = isCurrentlyVisible &&
                             ((content.includes('navi-result') && this.popup.classList.contains('navi-popup-result')) ||
                              (content.includes('navi-error') && this.popup.querySelector('.navi-error')));

    // 记录当前是否有拖动区域，以便重建时能保留
    const hasDraggableArea = this.popup.querySelector('.navi-draggable-area') !== null;

    // 清除旧内容和类名
    this.popup.innerHTML = content;

    // 设置基本类名
    this.popup.className = 'navi-popup';

    // 根据内容类型添加适当的类名
    if (content && content.includes('navi-result')) {
      this.popup.classList.add('navi-popup-result');
    }
    // loading类由showLoadingPopup方法直接添加，不在这里处理

    // 检查是否应该保持当前位置
    if (isSameContentType && currentLeft && currentTop) {
      this.popup.style.left = currentLeft;
      this.popup.style.top = currentTop;
      this.popup.style.display = 'block';
      return;
    }

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
      <div class="navi-draggable-area"></div>
      <div class="navi-result">
        <div class="navi-meta">
          <div class="navi-translation"><strong>${uiText.translation}:</strong> ${translation}</div>`;

    // 只有当showDomain未明确设置为false时才显示领域信息
    if (config.generalConfig?.showDomain !== false) {
      resultHTML += `
          <div class="navi-domain"><strong>${uiText.domain}:</strong> ${domain}</div>`;
    }

    resultHTML += `
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

  // 判断文本是否包含指定语言的字符
  containsLanguage(text, lang) {
    if (!text) return false;

    // 定义不同语言的Unicode范围
    const langRanges = {
      'zh': [
        [0x4E00, 0x9FFF],   // CJK统一汉字
        [0x3400, 0x4DBF],   // CJK扩展A
        [0x20000, 0x2A6DF], // CJK扩展B
        [0x2A700, 0x2B73F], // CJK扩展C
        [0x2B740, 0x2B81F], // CJK扩展D
        [0x2B820, 0x2CEAF], // CJK扩展E
        [0x2CEB0, 0x2EBEF], // CJK扩展F
        [0xF900, 0xFAFF]    // CJK兼容汉字
      ],
      'ja': [
        [0x3040, 0x309F],   // 平假名
        [0x30A0, 0x30FF],   // 片假名
        [0x4E00, 0x9FFF],   // 汉字(与中文共享)
        [0xFF66, 0xFF9F]    // 半角片假名
      ],
      'ko': [
        [0xAC00, 0xD7AF],   // 韩文音节
        [0x1100, 0x11FF],   // 韩文字母
        [0x3130, 0x318F]    // 韩文兼容字母
      ],
      'ru': [
        [0x0400, 0x04FF],   // 西里尔字母
        [0x0500, 0x052F]    // 西里尔字母扩展
      ],
      'ar': [
        [0x0600, 0x06FF],   // 阿拉伯字母
        [0x0750, 0x077F],   // 阿拉伯字母扩展
        [0x08A0, 0x08FF],   // 阿拉伯字母扩展-A
        [0xFB50, 0xFDFF],   // 阿拉伯表现形式A
        [0xFE70, 0xFEFF]    // 阿拉伯表现形式B
      ]
    };

    // 对于未特别定义范围的西方语言，我们不做特殊检测
    // 因为大部分西方语言使用相似的拉丁字母，很难区分
    if (!langRanges[lang]) {
      console.log(`NAVI: 未定义 ${lang} 语言的Unicode范围, 默认返回false`);
      return false;
    }

    // 检查文本中是否包含指定语言的字符
    const ranges = langRanges[lang];
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);

      for (const [start, end] of ranges) {
        if (charCode >= start && charCode <= end) {
          console.log(`NAVI: 检测到 ${lang} 语言字符: ${text[i]} (${charCode})`);
          return true;
        }
      }
    }

    return false;
  }

  // 检查输入元素，避免在输入框中触发划词
  isInputElement(el) {
    if (!el || !el.tagName) return false;

    // 获取元素的标签名并转为小写进行比较
    const tagName = el.tagName.toLowerCase();

    // 检查常见的输入元素标签
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      console.log('NAVI: 检测到输入元素:', tagName);
      return true;
    }

    // 获取元素的类名和ID，确保类名是字符串类型
    const classNames = (typeof el.className === 'string' ? el.className :
                      el.className && el.className.baseVal ? el.className.baseVal : '').toLowerCase();
    const idName = el.id ? el.id.toLowerCase() : '';

    // 显式排除标题和弹出框元素
    const excludedElements = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', // 标题元素
      'title', 'header', 'popup', 'modal', 'dialog', 'tooltip' // 常见弹出框类名
    ];

    if (excludedElements.includes(tagName) ||
        excludedElements.some(name => classNames.includes(name))) {
      console.log('NAVI: 检测到标题或弹出框元素，不作为输入元素处理');
      return false;
    }

    // 检查contentEditable属性
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      console.log('NAVI: 检测到可编辑元素');
      return true;
    }

    // 检查role属性
    const inputRoles = ['textbox', 'searchbox', 'combobox', 'input'];
    if (inputRoles.includes(el.getAttribute('role'))) {
      console.log('NAVI: 检测到输入角色元素');
      return true;
    }

    // 更严格的输入元素检查
    const isInputLike = (
      classNames.includes('search') ||
      classNames.includes('input') ||
      classNames.includes('editor') ||
      classNames.includes('field') ||
      classNames.includes('form-control') ||
      idName.includes('search') ||
      idName.includes('input') ||
      idName.includes('editor') ||
      idName.includes('field') ||
      el.getAttribute('aria-autocomplete') === 'list' ||
      el.getAttribute('aria-autocomplete') === 'both' ||
      el.getAttribute('aria-autocomplete') === 'inline' ||
      el.getAttribute('data-search-input') !== null ||
      el.getAttribute('data-input') !== null ||
      el.getAttribute('autocomplete') === 'on' ||
      el.getAttribute('type') === 'search' ||
      el.getAttribute('type') === 'text'
    );

    if (isInputLike) {
      // 额外检查元素是否实际可交互
      const isInteractive = (
        !el.disabled &&
        el.tabIndex >= 0 &&
        window.getComputedStyle(el).pointerEvents !== 'none'
      );

      if (isInteractive) {
        console.log('NAVI: 检测到可交互的搜索框/输入框元素');
        return true;
      }
    }

    // 检查特殊情况：Google搜索框
    if (window.location.hostname.includes('google') && (
      classNames.includes('gsfi') ||
      classNames.includes('gLFyf') ||
      el.getAttribute('aria-label') === 'Search' ||
      el.getAttribute('title') === 'Search'
    )) {
      console.log('NAVI: 检测到Google搜索框');
      return true;
    }

    // 检查父元素是否为表单元素
    const parentForm = el.closest('form');
    if (parentForm &&
        (parentForm.getAttribute('role') === 'search' ||
         parentForm.className.toLowerCase().includes('search') ||
         parentForm.id.toLowerCase().includes('search'))) {
      console.log('NAVI: 检测到搜索表单内元素');
      return true;
    }

    return false;
  }

  // 添加完成效果方法
  addCompletionEffect() {
    if (!this.popup) return;

    // 添加完成动画类
    this.popup.classList.add('navi-completion-effect');

    // 动画结束后移除类
    setTimeout(() => {
      this.popup.classList.remove('navi-completion-effect');
    }, 1500); // 动画持续1.5秒
  }

  // 检查文本是否为链接格式
  isLinkFormat(text) {
    // 首先检查是否启用忽略链接功能
    if (!this.config || !this.config.generalConfig || this.config.generalConfig.ignoreLinks === false) {
      return false;
    }

    if (!text) return false;

    // 检查是否是URL (HTTP/HTTPS/FTP等)
    const urlRegex = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
    if (urlRegex.test(text)) {
      console.log('NAVI: 检测到URL链接格式:', text);
      return true;
    }

    // 检查是否是email地址
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
    if (emailRegex.test(text)) {
      console.log('NAVI: 检测到电子邮件地址格式:', text);
      return true;
    }

    // 检查是否是Windows文件路径
    const windowsPathRegex = /^[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*$/;
    if (windowsPathRegex.test(text)) {
      console.log('NAVI: 检测到Windows文件路径格式:', text);
      return true;
    }

    // 检查是否是Unix文件路径
    const unixPathRegex = /^(\/[^\/\0]+)+\/?$/;
    if (unixPathRegex.test(text)) {
      console.log('NAVI: 检测到Unix文件路径格式:', text);
      return true;
    }

    // 检查是否是IP地址
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
    if (ipRegex.test(text)) {
      console.log('NAVI: 检测到IP地址格式:', text);
      return true;
    }

    return false;
  }

  async handleSelection(event) {
    // 添加拖动状态检查，如果正在拖动则不处理选择事件
    if (this.isDragging) {
      return;
    }

    // 如果刚刚完成拖动，不触发选择
    if (this.wasDragging) {
      this.wasDragging = false;
      return;
    }

    console.log('NAVI: 划词事件被触发');

    // 获取划词起点元素
    if (event && event.clientX && event.clientY) {
      const startElement = document.elementFromPoint(event.clientX, event.clientY);
      if (startElement && this.isInputElement(startElement)) {
        console.log('NAVI: 划词起点在输入框内，不处理');
        return;
      }
    }

    // 添加对window.getSelection的空值检查
    const selection = window && window.getSelection ? window.getSelection() : null;
    if (!selection) {
      console.log('NAVI: 无法获取选择内容，window.getSelection返回null');
      return;
    }

    const selectedText = selection.toString().trim();

    console.log('NAVI: 选中的文本:', selectedText ? selectedText : '无');

    if (!selectedText) {
      this.hidePopup();
      this.hideTriggerButton();
      // 如果存在延时计时器，清除它
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      return;
    }

    // 检查选中文本是否为链接格式
    if (this.isLinkFormat(selectedText)) {
      console.log('NAVI: 选中文本是链接格式，不触发划词');
      return;
    }

    // 获取源事件目标元素
    const targetElement = event ? event.target : null;
    console.log('NAVI: 事件目标元素:', targetElement);

    // 检查selection是否有范围
    if (!selection.rangeCount) {
      console.log('NAVI: 选区不包含任何范围');
      return;
    }

    // 检查选区是否包含输入框元素
    const range = selection.getRangeAt(0);
    if (!range) {
      console.log('NAVI: 无法获取选区范围');
      return;
    }

    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          return this.isInputElement(node) ?
            NodeFilter.FILTER_ACCEPT :
            NodeFilter.FILTER_SKIP;
        }
      }
    );

    // 如果找到任何输入元素，则不处理
    if (walker.nextNode()) {
      console.log('NAVI: 选区包含输入框元素，不触发划词');
      return;
    }

    // 检查选中文本是否在插件结果框中
    if (targetElement && (targetElement.closest('.navi-popup') || targetElement.closest('.navi-result') || targetElement.closest('.navi-trigger-button'))) {
      console.log('NAVI: 选中文本在插件结果框中，不触发划词');
      return;
    }

    // 获取选中文本的位置
    const rect = range.getBoundingClientRect();

    // 检查是否在插件结果框中
    const element = range.commonAncestorContainer;
    if (!element) {
      console.log('NAVI: 无法获取选区的公共祖先容器');
      return;
    }

    const parentElement = element.nodeType === Node.TEXT_NODE
      ? element.parentElement
      : element;

    if (parentElement && (parentElement.closest('.navi-popup') || parentElement.closest('.navi-result') || parentElement.closest('.navi-trigger-button'))) {
      console.log('NAVI: 选中文本在插件结果框中，不触发划词');
      return;
    }

    // 检查选区是否包含输入框元素
    const rangeContents = range.cloneContents();
    if (rangeContents) {
      const rangeNodes = rangeContents.querySelectorAll('*');
      for (const node of rangeNodes) {
        if (this.isInputElement(node)) {
          console.log('NAVI: 选区包含输入框元素，不触发划词');
          return;
        }
      }
    }

    console.log('NAVI: 选中文本的位置:', rect);

    // 检查配置
    const config = await this.getConfig();
    // 将配置保存到实例变量，以便其他方法可以访问
    this.config = config;
    console.log('NAVI: 配置加载完成', config);

    // 获取主选语言和主选语言行为设置
    const primaryLang = config.translationConfig?.targetLanguage || 'zh';
    const primaryLangBehavior = config.translationConfig?.primaryLangBehavior || 'auto';

    // 检测文本是否包含主选语言
    const containsPrimaryLang = this.containsLanguage(selectedText, primaryLang);
    console.log(`NAVI: 文本是否包含主选语言(${primaryLang}): ${containsPrimaryLang}`);

    if (containsPrimaryLang) {
      // 根据主选语言行为设置处理
      console.log(`NAVI: 文本包含主选语言，应用行为设置: ${primaryLangBehavior}`);

      switch (primaryLangBehavior) {
        case 'disable':
          // 不做任何处理
          console.log('NAVI: 主选语言行为设置为关闭，不处理该文本');
          return;

        case 'button':
          // 显示触发按钮
          console.log('NAVI: 主选语言行为设置为显示触发按钮');
          this.showTriggerButton(rect, selectedText);
          return;

        case 'auto':
        default:
          // 自动处理，继续执行后续代码
          console.log('NAVI: 主选语言行为设置为自动处理');
          break;
      }
    } else {
      // 文本不包含主选语言，使用全局触发按钮设置
      console.log('NAVI: 文本不包含主选语言，使用全局触发按钮设置');

      // 检查是否启用了触发按钮
      if (config.generalConfig?.enableTriggerButton) {
        console.log('NAVI: 使用触发按钮模式');
        // 显示触发按钮
        this.showTriggerButton(rect, selectedText);
        return;
      }
    }

    // 如果未启用触发按钮，使用延时触发
    // 首先清除之前可能存在的计时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // 获取延时设置
    const delay = config.generalConfig?.selectionDelay || 500;
    console.log(`NAVI: 使用延时触发模式，延时 ${delay}ms`);

    // 保存当前选中的文本和位置，用于延时处理
    const currentText = selectedText;
    const currentRect = rect;

    // 设置延时
    this.debounceTimer = setTimeout(() => {
      // 延时结束后处理文本
      this.processSelectedText(currentText, currentRect);
      this.debounceTimer = null;
    }, delay);
  }

  // 初始化拖动功能
  initDraggable() {
    // 使用实例变量而不是局部变量
    let startX, startY; // 开始拖动时的鼠标位置
    let startLeft, startTop; // 开始拖动时的弹窗位置
    let dragStarted = false; // 标记是否已初始化拖动数据

    // 鼠标按下事件
    this.popup.addEventListener('mousedown', (e) => {
      // 只允许拖动区域触发拖动
      if (e.target.classList.contains('navi-draggable-area')) {
        e.preventDefault();
        e.stopPropagation();

        // 获取当前弹窗的位置（从style中获取）
        startLeft = parseInt(this.popup.style.left) || 0;
        startTop = parseInt(this.popup.style.top) || 0;
        startX = e.clientX;
        startY = e.clientY;
        dragStarted = true;

        // 设置拖动状态
        this.isDragging = true;
        this.wasDragging = false;
        e.target.style.cursor = 'grabbing';

        // 添加调试日志
        console.log('拖动初始化 - 初始位置:', { startLeft, startTop, startX, startY });
      }
    });

    // 鼠标移动事件
    document.addEventListener('mousemove', (e) => {
      if (this.isDragging && dragStarted) {
        e.preventDefault();
        e.stopPropagation();

        // 计算鼠标移动的距离
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        // 添加调试日志 - 每10px记录一次
        if (Math.abs(deltaX) % 10 < 1 && Math.abs(deltaY) % 10 < 1) {
          console.log('拖动中 - 位移:', { deltaX, deltaY });
        }

        // 根据鼠标移动距离计算新位置
        const left = Math.round(startLeft + deltaX);
        const top = Math.round(startTop + deltaY);

        // 获取视口和文档信息
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
        const safeDistance = 20; // 安全边距

        // 获取弹窗尺寸
        const popupWidth = this.popup.offsetWidth;
        const popupHeight = this.popup.offsetHeight;

        // 确保弹窗不超出视口边界
        const safeLeft = Math.max(scrollLeft + safeDistance,
                       Math.min(left, windowWidth + scrollLeft - popupWidth - safeDistance));
        const safeTop = Math.max(scrollTop + safeDistance,
                      Math.min(top, windowHeight + scrollTop - popupHeight - safeDistance));

        // 设置弹窗新位置
        this.popup.style.left = `${safeLeft}px`;
        this.popup.style.top = `${safeTop}px`;

        // 标记为已经移动
        this.wasDragging = true;
      }
    });

    // 鼠标释放事件
    document.addEventListener('mouseup', (e) => {
      if (this.isDragging) {
        e.preventDefault();
        e.stopPropagation();

        // 恢复拖动区域的样式
        const dragArea = this.popup.querySelector('.navi-draggable-area');
        if (dragArea) {
          dragArea.style.cursor = 'grab';
        }

        // 如果已经移动过，记录日志
        if (dragStarted) {
          console.log('拖动结束 - 最终位置:', {
            left: this.popup.style.left,
            top: this.popup.style.top
          });
        }

        // 如果已经移动，设置一个短暂的定时器，阻止mouseup事件触发选择行为
        if (this.wasDragging) {
          // 设置一个短暂的定时器，在鼠标释放后一段时间内忽略选择事件
          setTimeout(() => {
            this.wasDragging = false;
          }, 300);
        } else {
          // 如果没有实际拖动，立即重置状态
          this.wasDragging = false;
        }

        // 重置拖动状态
        this.isDragging = false;
        dragStarted = false;
      }
    });
  }
}

// 初始化选择处理器
new SelectionHandler();
