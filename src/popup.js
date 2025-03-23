// 导入i18n模块
import i18n from './utils/i18n.js';

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM加载完成，开始初始化...');

  // 初始化国际化模块
  await i18n.init();

  // 应用当前语言
  applyLanguage(i18n.getCurrentLanguage());

  // 清除可能存在的旧状态消息
  const statusElement = document.getElementById('status');
  if (statusElement) {
    statusElement.textContent = '';
    statusElement.className = 'status';
    statusElement.style.display = 'none';
  }

  // 获取DOM元素
  const defaultService = document.getElementById('defaultService');
  const openaiKey = document.getElementById('openaiKey');
  const openaiBaseUrl = document.getElementById('openaiBaseUrl');
  const openaiModel = document.getElementById('openaiModel');
  const ollamaUrl = document.getElementById('ollamaUrl');
  const ollamaModel = document.getElementById('ollamaModel');
  const saveButton = document.getElementById('saveButton');
  const status = document.getElementById('status');
  const targetLanguage = document.getElementById('targetLanguage');
  const secondaryTargetLanguage = document.getElementById('secondaryTargetLanguage');
  const uiLanguage = document.getElementById('uiLanguage');

  // 检查是否所有必需元素都存在
  if (!defaultService || !openaiKey || !openaiModel || !ollamaUrl || !ollamaModel || !saveButton || !status || !targetLanguage || !secondaryTargetLanguage || !uiLanguage) {
    console.error('某些DOM元素未找到:', {
      defaultService, openaiKey, openaiModel, ollamaUrl, ollamaModel, saveButton, status, targetLanguage, secondaryTargetLanguage, uiLanguage
    });
    showStatus(i18n.t('interfaceLoadError'), 'error');
    return;
  }

  // 设置界面语言的选择
  uiLanguage.value = i18n.getCurrentLanguage();

  // 监听界面语言变更
  uiLanguage.addEventListener('change', async (event) => {
    const lang = event.target.value;
    i18n.setLanguage(lang);
    applyLanguage(lang);

    // 更新配置中的界面语言设置
    const config = await loadConfig();
    config.uiLanguage = lang;
    await saveConfig(config);
  });

  // 加载配置
  const config = await loadConfig();
  console.log('加载现有配置:', config);

  // 打印关键元素信息
  const ollamaSection = document.getElementById('ollamaSection');
  const openaiSection = document.getElementById('openaiSection');
  console.log('关键UI元素:', { ollamaSection, openaiSection });

  // 填充表单
  defaultService.value = config.defaultService || 'openai';
  openaiKey.value = config.apiKeys?.openai || '';
  if (openaiBaseUrl) openaiBaseUrl.value = config.apiUrls?.openai || '';
  openaiModel.value = config.openaiConfig?.model || 'gpt-4o-mini';
  ollamaUrl.value = config.ollamaConfig?.baseUrl || 'http://localhost:11434';
  ollamaModel.value = config.ollamaConfig?.model || 'qwen2.5:7b';
  targetLanguage.value = config.translationConfig?.targetLanguage || 'zh';
  secondaryTargetLanguage.value = config.translationConfig?.secondaryTargetLanguage || 'en';

  console.log('表单填充完成');

  // 检查是否是首次使用
  if (!config.apiKeys?.openai && defaultService.value === 'openai') {
    showStatus(i18n.t('pleaseConfigApiKey'), 'error');
    openaiKey.focus();
    openaiKey.style.borderColor = '#c5221f';
    openaiKey.style.animation = 'pulse 1.5s infinite';

    // 添加脉冲动画样式
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.4); }
        70% { box-shadow: 0 0 0 6px rgba(220, 53, 69, 0); }
        100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
      }
    `;
    document.head.appendChild(style);

    // 取消焦点时恢复正常样式
    openaiKey.addEventListener('blur', function() {
      if (this.value) {
        this.style.borderColor = '';
        this.style.animation = '';
      }
    });
  }

  // 检查Ollama权限
  if (defaultService.value === 'ollama') {
    await checkOllamaPermission();
  }

  // 监听服务类型变化
  defaultService.addEventListener('change', async (event) => {
    // 更新界面显示
    updateServiceSettings(event.target.value);

    if (event.target.value === 'ollama') {
      await checkOllamaPermission();
    }
  });

  // 检查配置的有效性
  function validateConfig() {
    let isValid = true;
    let errorMessage = '';

    // 添加二次验证：主选和次选语言不应相同
    if (targetLanguage.value === secondaryTargetLanguage.value) {
      isValid = false;
      errorMessage = '主选和次选语言不能相同';
    }

    // 根据默认服务的不同，验证不同的API参数
    if (defaultService.value === 'openai') {
      // 验证OpenAI API Key是否存在
      if (!openaiKey.value.trim()) {
        isValid = false;
        errorMessage = i18n.t('inputOpenaiKey');
      }
    } else if (defaultService.value === 'ollama') {
      // 验证Ollama服务地址是否存在
      if (!ollamaUrl.value.trim()) {
        isValid = false;
        errorMessage = i18n.t('inputOllamaAddress');
      }
    }

    return { isValid, errorMessage };
  }

  // 保存设置按钮的点击事件
  saveButton.addEventListener('click', async () => {
    // 验证配置
    const { isValid, errorMessage } = validateConfig();
    if (!isValid) {
      showStatus(errorMessage, 'error');
      return;
    }

    // 禁用保存按钮防止重复点击
    saveButton.disabled = true;

    // 显示保存中状态
    showStatus('正在保存...', 'info');

    try {
      // 获取当前配置
      const config = await loadConfig();

      // 更新配置
      config.defaultService = defaultService.value;

      // 确保API Keys对象存在
      config.apiKeys = config.apiKeys || {};
      config.apiKeys.openai = openaiKey.value;

      // 确保API URLs对象存在
      config.apiUrls = config.apiUrls || {};
      if (openaiBaseUrl) {
        config.apiUrls.openai = openaiBaseUrl.value || 'https://api.openai.com/v1';
      }

      // 确保OpenAI配置对象存在
      config.openaiConfig = config.openaiConfig || {};
      config.openaiConfig.model = openaiModel.value;

      // 确保Ollama配置对象存在
      config.ollamaConfig = config.ollamaConfig || {};
      config.ollamaConfig.baseUrl = ollamaUrl.value;
      config.ollamaConfig.model = ollamaModel.value;

      // 确保翻译配置对象存在
      config.translationConfig = config.translationConfig || {};
      config.translationConfig.targetLanguage = targetLanguage.value;
      config.translationConfig.secondaryTargetLanguage = secondaryTargetLanguage.value;

      // 保存配置
      await saveConfig(config);

      // 显示成功状态
      showStatus(i18n.t('settingsSaved'), 'success');

      // 安全地向内容脚本发送配置更新通知
      try {
        // 只向当前活动标签页发送消息
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs && tabs[0] && tabs[0].id) {
            try {
              chrome.tabs.sendMessage(tabs[0].id, { type: 'CONFIG_UPDATED' }, function(response) {
                // 检查是否有错误发生（消息通道错误）
                if (chrome.runtime.lastError) {
                  console.log('无法发送消息到当前标签页:', chrome.runtime.lastError);
                  // 继续刷新标签页，即使消息发送失败
                }
              });
            } catch (e) {
              console.log('发送消息时出错:', e);
            }

            // 延时后刷新当前活动标签页
            setTimeout(() => {
              chrome.tabs.reload(tabs[0].id);
              window.close(); // 关闭弹窗
            }, 1000);
          }
        });
      } catch (error) {
        console.error('通知标签页或刷新页面时出错:', error);
        // 即使出错也尝试关闭弹窗
        setTimeout(() => window.close(), 1500);
      }
    } catch (error) {
      // 显示错误状态
      showStatus(i18n.t('saveFailed') + error.message, 'error');
      // 重新启用保存按钮
      saveButton.disabled = false;
    }
  });

  // 更新服务设置界面
  updateServiceSettings(config.defaultService || 'openai');

  // 始终尝试获取Ollama模型列表，不管当前选择的服务类型
  fetchOllamaModels();
});

// 应用语言到界面
function applyLanguage(lang) {
  // 设置文档标题
  document.title = i18n.t('title');

  // 更新所有带data-i18n属性的元素
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    element.textContent = i18n.t(key);
  });

  // 更新所有带data-i18n-placeholder属性的元素的placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    element.placeholder = i18n.t(key);
  });
}

async function loadConfig() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(['config'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('加载配置时出错:', chrome.runtime.lastError);
        }

        console.log('从storage加载配置:', result);

        // 默认配置
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
          }
        };

        // 合并默认配置和存储的配置
        const config = result.config || {};

        // 确保关键的默认值存在
        config.defaultService = config.defaultService || defaultConfig.defaultService;
        config.apiKeys = config.apiKeys || {};
        config.apiUrls = config.apiUrls || defaultConfig.apiUrls;
        config.openaiConfig = config.openaiConfig || defaultConfig.openaiConfig;
        config.ollamaConfig = config.ollamaConfig || defaultConfig.ollamaConfig;

        // 确保不为null的值
        config.apiUrls.openai = config.apiUrls.openai || defaultConfig.apiUrls.openai;
        config.openaiConfig.model = config.openaiConfig.model || defaultConfig.openaiConfig.model;
        config.ollamaConfig.baseUrl = config.ollamaConfig.baseUrl || defaultConfig.ollamaConfig.baseUrl;
        config.ollamaConfig.model = config.ollamaConfig.model || defaultConfig.ollamaConfig.model;

        resolve(config);
      });
    } catch (error) {
      console.error('获取配置时发生异常:', error);
      // 返回默认配置，避免UI崩溃
      resolve({
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
        }
      });
    }
  });
}

async function saveConfig(config) {
  return new Promise((resolve, reject) => {
    console.log('开始保存配置到storage');

    // 验证配置数据
    if (!config) {
      console.error('配置数据为空');
      reject(new Error('配置数据无效'));
      return;
    }

    // 确保必要字段存在
    if (!config.defaultService) {
      config.defaultService = 'openai';
    }

    if (!config.apiKeys) {
      config.apiKeys = {};
    }

    if (!config.ollamaConfig) {
      config.ollamaConfig = {
        baseUrl: 'http://localhost:11434',
        model: 'qwen2.5:7b'
      };
    }

    // 检查数据大小
    const configString = JSON.stringify({ config });
    console.log('配置数据大小(字节):', configString.length);

    // Chrome存储限制提示
    if (configString.length > 8000) {
      console.error('配置数据过大，接近Chrome存储限制(8192字节)');
      reject(new Error('配置数据过大，请减少API密钥长度'));
      return;
    }

    try {
      chrome.storage.sync.set({ config }, () => {
        if (chrome.runtime.lastError) {
          console.error('保存配置失败:', chrome.runtime.lastError);
          reject(new Error(`保存失败: ${chrome.runtime.lastError.message}`));
          return;
        }

        console.log('配置保存成功');

        // 验证保存是否成功
        setTimeout(() => {
          try {
            chrome.storage.sync.get(['config'], (result) => {
              if (chrome.runtime.lastError) {
                console.error('读取保存后的配置失败:', chrome.runtime.lastError);
                reject(new Error(`验证失败: ${chrome.runtime.lastError.message}`));
                return;
              }

              if (result.config) {
                console.log('验证配置已保存:', result.config);
                resolve();
              } else {
                console.error('保存后验证失败，无法读取配置');
                reject(new Error('保存后验证失败，请重试'));
              }
            });
          } catch (verifyErr) {
            console.error('验证保存时出错:', verifyErr);
            reject(new Error(`验证错误: ${verifyErr.message}`));
          }
        }, 100); // 短暂延迟确保存储操作完成
      });
    } catch (err) {
      console.error('调用chrome.storage.sync.set时出错:', err);
      reject(new Error(`存储错误: ${err.message}`));
    }
  });
}

async function checkOllamaPermission() {
  try {
    // 获取当前配置的Ollama URL
    const config = await loadConfig();
    const ollamaUrl = config.ollamaConfig?.baseUrl || 'http://localhost:11434';

    showStatus(i18n.t('checkingOllamaConnection'), 'info');

    // 通过background.js检查Ollama连接
    chrome.runtime.sendMessage({
      type: "GET_CONFIG",
      action: "checkOllamaConnection",
      baseUrl: ollamaUrl
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('Ollama连接检查失败:', chrome.runtime.lastError);
        showStatus(i18n.t('ollamaConnectionFailed') + chrome.runtime.lastError.message, 'error');
        showOllamaCorsHint(true);
        return;
      }

      if (!response || !response.success) {
        console.error('Ollama连接检查失败:', response?.error);
        showStatus(i18n.t('ollamaConnectionFailed') + (response?.error || '未知错误'), 'error');
        showOllamaCorsHint(true);
        return;
      }

      const connectionResult = response.data;

      if (!connectionResult.connected) {
        console.error('Ollama服务连接失败:', connectionResult.message);
        showStatus(connectionResult.message, 'error');
        showOllamaCorsHint(true);
        return;
      }

      showStatus(connectionResult.message, 'success');

      // 如果有模型信息，立即更新模型列表
      if (connectionResult.models && connectionResult.models.length > 0) {
        renderOllamaModelOptions(connectionResult.models, config.ollamaConfig?.model || '');
      } else {
        // 如果没有模型信息，再次尝试获取
        fetchOllamaModels();
      }
    });
  } catch (error) {
    console.error('检查Ollama权限错误:', error);
    showStatus(error.message, 'error');
  }
}

function showStatus(message, type) {
  console.log('显示状态消息:', message, type);
  const statusElement = document.getElementById('status');

  if (!statusElement) {
    console.error('状态元素未找到，无法显示消息:', message);
    // 尝试创建一个临时状态元素
    try {
      const tempStatus = document.createElement('div');
      tempStatus.id = 'status';
      tempStatus.className = `status ${type || 'error'}`;
      const container = document.querySelector('.container');
      const languageSwitcher = document.querySelector('.language-switcher');
      if (container && languageSwitcher) {
        container.insertBefore(tempStatus, languageSwitcher.nextSibling);
      } else {
        document.body.appendChild(tempStatus);
      }

      // 递归调用自身使用新创建的元素
      showStatus(message, type);
      return;
    } catch (err) {
      console.error('创建临时状态元素失败:', err);
      return;
    }
  }

  // 根据状态类型添加不同的图标
  let icon = '';
  if (type === 'success') {
    icon = '<span style="color: #137333; font-size: 16px; margin-right: 6px;">✓</span>';
  } else if (type === 'error') {
    icon = '<span style="color: #c5221f; font-size: 16px; margin-right: 6px;">⚠</span>';
  }

  statusElement.innerHTML = icon + message;
  statusElement.className = `status ${type || ''}`;

  // 使状态更明显
  statusElement.style.display = 'block';
  statusElement.style.opacity = '1';

  // 添加轻微的弹跳动画效果
  if (!statusElement.style.animation) {
    statusElement.style.animation = 'bounce 0.3s ease';
    // 检查是否已添加动画样式
    if (!document.querySelector('style[data-status-animation]')) {
      try {
        const style = document.createElement('style');
        style.setAttribute('data-status-animation', 'true');
        style.textContent = `
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
          }
        `;
        document.head.appendChild(style);
      } catch (err) {
        console.error('添加动画样式失败:', err);
      }
    }
  }

  // 成功消息3秒后自动淡出，错误消息需要用户查看
  if (type === 'success') {
    setTimeout(() => {
      if (statusElement) {  // 再次检查元素是否存在
        statusElement.style.opacity = '0';
        setTimeout(() => {
          if (statusElement) {  // 确保元素仍然存在
            statusElement.style.display = 'none';
            statusElement.style.animation = '';
          }
        }, 500);
      }
    }, 3000);
  }
}

// 更新服务设置界面
function updateServiceSettings(service) {
  console.log('更新服务设置界面为:', service);
  const ollamaSection = document.getElementById('ollamaSection');
  const openaiSection = document.getElementById('openaiSection');

  if (!ollamaSection || !openaiSection) {
    console.error('找不到服务设置区域元素:', {ollamaSection, openaiSection});
    return;
  }

  if (service === 'ollama') {
    ollamaSection.style.display = 'block';
    openaiSection.style.display = 'none';

    // 添加加载Ollama模型列表的逻辑
    fetchOllamaModels();
  } else if (service === 'openai') {
    ollamaSection.style.display = 'none';
    openaiSection.style.display = 'block';
  }
}

// 添加获取Ollama模型列表的函数
async function fetchOllamaModels() {
  try {
    const config = await loadConfig();
    const ollamaUrl = config.ollamaConfig?.baseUrl || 'http://localhost:11434';

    // 显示一个正在加载的提示
    const modelSelect = document.getElementById('ollamaModel');
    if (!modelSelect) {
      console.error("无法找到ollamaModel元素");
      showStatus('无法加载Ollama模型列表: 界面元素未找到', 'error');
      return;
    }

    modelSelect.innerHTML = '<option value="">正在加载模型列表...</option>';
    modelSelect.disabled = true;

    showStatus('正在获取Ollama模型列表...', 'info');

    // 通过background.js获取模型列表
    chrome.runtime.sendMessage({
      type: "OLLAMA_API_REQUEST",
      action: "LIST_MODELS",
      baseUrl: ollamaUrl
    }, response => {
      if (!modelSelect) {
        console.error("响应处理时ollamaModel元素不存在");
        return;
      }

      if (chrome.runtime.lastError) {
        console.error('获取模型列表失败:', chrome.runtime.lastError);
        showStatus('获取Ollama模型列表失败: ' + chrome.runtime.lastError.message, 'error');
        modelSelect.innerHTML = '<option value="">获取模型列表失败</option>';
        modelSelect.disabled = false;
        return;
      }

      if (!response || !response.success) {
        console.error('获取模型列表失败:', response?.error);
        showStatus('获取Ollama模型列表失败: ' + (response?.error || '未知错误'), 'error');
        modelSelect.innerHTML = '<option value="">获取模型列表失败</option>';
        modelSelect.disabled = false;
        return;
      }

      const models = response.data;
      renderOllamaModelOptions(models, config.ollamaConfig?.model || '');
      showStatus(`成功获取到${models.length}个Ollama模型`, 'success');
    });
  } catch (error) {
    console.error('获取Ollama模型列表出错:', error);
    showStatus('获取Ollama模型列表失败: ' + error.message, 'error');
  }
}

// 创建Ollama模型选择下拉框
function createOllamaModelSelect() {
  const ollamaSection = document.getElementById('ollamaSection');
  if (!ollamaSection) {
    console.error("无法找到ollamaSection元素，无法创建模型选择器");
    return null;
  }

  const ollamaModelContainer = document.createElement('div');
  ollamaModelContainer.className = 'form-group';
  ollamaModelContainer.innerHTML = `
    <label for="ollamaModel">Ollama模型:</label>
    <select id="ollamaModel" class="form-control">
      <option value="">加载中...</option>
    </select>
    <small class="text-muted">选择要使用的Ollama模型</small>
  `;

  // 查找插入位置，应该在ollamaUrl下方
  const ollamaUrlGroup = ollamaSection.querySelector('.form-group');
  if (!ollamaUrlGroup) {
    console.error("无法找到ollamaUrl表单组，将添加到ollamaSection末尾");
    ollamaSection.appendChild(ollamaModelContainer);
  } else {
    ollamaUrlGroup.after(ollamaModelContainer);
  }

  const modelSelect = document.getElementById('ollamaModel');
  if (modelSelect) {
    modelSelect.addEventListener('change', updateOllamaModel);
  }

  return modelSelect;
}

// 渲染Ollama模型选项
function renderOllamaModelOptions(models, currentModel) {
  const modelSelect = document.getElementById('ollamaModel');
  if (!modelSelect) {
    console.error("无法找到ollamaModel元素，无法渲染模型选项");
    return;
  }

  modelSelect.innerHTML = '';

  if (!models || models.length === 0) {
    modelSelect.innerHTML = '<option value="">未找到可用模型</option>';
    modelSelect.disabled = true;
    return;
  }

  // 添加模型选项
  models.forEach(model => {
    const modelName = model.name || model;
    const option = document.createElement('option');
    option.value = modelName;
    option.textContent = modelName;
    modelSelect.appendChild(option);
  });

  // 设置当前选择的模型
  if (currentModel && modelSelect.querySelector(`option[value="${currentModel}"]`)) {
    modelSelect.value = currentModel;
  } else if (models.length > 0) {
    // 如果当前模型不存在于列表中，选择第一个
    modelSelect.value = models[0].name || models[0];
  }

  modelSelect.disabled = false;
}

// 更新Ollama模型设置
async function updateOllamaModel(event) {
  const model = event.target.value;
  if (!model) return;

  try {
    const config = await loadConfig();

    if (!config.ollamaConfig) {
      config.ollamaConfig = {
        baseUrl: 'http://localhost:11434',
        model: model
      };
    } else {
      config.ollamaConfig.model = model;
    }

    await saveConfig(config);
    showStatus(`已更新Ollama模型为 ${model}`, 'success');
  } catch (error) {
    console.error('更新Ollama模型设置失败:', error);
    showStatus('更新Ollama模型设置失败: ' + error.message, 'error');
  }
}

// 显示Ollama CORS设置提示
function showOllamaCorsHint(isError = false) {
  const ollamaUrlInput = document.getElementById('ollamaUrl');
  if (!ollamaUrlInput) {
    console.error("无法找到ollamaUrl元素，无法显示CORS提示");
    return;
  }

  const corsHint = document.createElement('div');
  corsHint.className = 'hint';

  if (isError) {
    corsHint.innerHTML = `
      <strong>CORS错误解决方法：</strong><br>
      1. 打开终端或命令行<br>
      2. 使用以下命令启动Ollama：<br>
      <code style="background:#f0f0f0;padding:5px;display:block;margin-top:5px;border-radius:3px;">OLLAMA_ORIGINS="*" ollama serve</code><br>
      3. 保持此命令窗口运行
    `;
    corsHint.style.color = '#e67e22';
    corsHint.style.border = '1px solid #e67e22';
    corsHint.style.padding = '10px';
    corsHint.style.borderRadius = '4px';
    corsHint.style.marginTop = '10px';
    corsHint.style.backgroundColor = '#fff7ed';
  } else {
    corsHint.innerHTML = `<strong>提示：</strong>使用命令 <code>OLLAMA_ORIGINS="*" ollama serve</code> 启动Ollama服务以允许浏览器扩展访问`;
    corsHint.style.marginTop = '5px';
    corsHint.style.color = '#e67e22';
  }

  corsHint.style.fontSize = '12px';

  // 避免重复添加提示
  const existingHint = ollamaUrlInput.parentNode.querySelector('.hint');
  if (!existingHint) {
    ollamaUrlInput.parentNode.appendChild(corsHint);
  } else {
    existingHint.innerHTML = corsHint.innerHTML;
    existingHint.style.color = corsHint.style.color;
    if (isError) {
      existingHint.style.border = corsHint.style.border;
      existingHint.style.padding = corsHint.style.padding;
      existingHint.style.borderRadius = corsHint.style.borderRadius;
      existingHint.style.marginTop = corsHint.style.marginTop;
      existingHint.style.backgroundColor = corsHint.style.backgroundColor;
    }
  }
}