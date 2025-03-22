import { AIServiceFactory } from './services/ai-service';

// 允许访问的本地服务域名白名单
const allowedDomains = [
  "localhost",
  "127.0.0.1"
];

// 初始化配置
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

// 监听安装事件
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['config'], (result) => {
    if (!result.config) {
      chrome.storage.sync.set({ config: defaultConfig });
    }
  });
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('接收到消息:', request);

  if (request.type === "AI_REQUEST") {
    handleAIRequest(request, sendResponse);
    return true; // 保持消息通道开放以支持异步响应
  } else if (request.type === "OLLAMA_API_REQUEST") {
    console.log("接收到Ollama API请求:", request);

    // 获取Ollama模型列表
    if (request.action === "LIST_MODELS") {
      fetchOllamaModels(request.baseUrl)
        .then(models => {
          console.log("获取到Ollama模型列表:", models);
          sendResponse({ success: true, data: models });
        })
        .catch(error => {
          console.error("获取Ollama模型列表失败:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // 保持消息通道开放
    }

    // 生成文本请求
    if (request.action === "GENERATE") {
      // 尝试先使用offscreen API
      makeOllamaRequestViaOffscreen(request.baseUrl, request.model, request.prompt)
        .then(result => {
          sendResponse({ success: true, data: result });
        })
        .catch(error => {
          console.error("Ollama生成请求失败:", error);
          // 如果offscreen方式失败，尝试直接请求
          return makeOllamaRequest(request.baseUrl, request.model, request.prompt);
        })
        .then(result => {
          if (result) sendResponse({ success: true, data: result });
        })
        .catch(error => {
          console.error("所有Ollama请求方式均失败:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // 保持消息通道开放
    }
  } else if (request.type === "GET_CONFIG") {
    console.log("接收到配置请求:", request);

    // 检查Ollama连接状态
    if (request.action === "checkOllamaConnection") {
      checkOllamaConnection(request.baseUrl)
        .then(result => {
          console.log("Ollama连接检查结果:", result);
          sendResponse({ success: true, data: result });
        })
        .catch(error => {
          console.error("Ollama连接检查失败:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // 保持消息通道开放
    }

    // 获取当前配置
    if (request.action === "getConfig") {
      getConfig()
        .then(config => {
          sendResponse({ success: true, data: config });
        })
        .catch(error => {
          console.error("获取配置失败:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // 保持消息通道开放
    }
  } else if (request.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
  }

  return false; // 对于其他消息，不保持消息通道开放
});

async function handleAIRequest(request, sendResponse) {
  try {
    const config = await getConfig();

    // 如果使用Ollama，先尝试检查连接
    if (config.defaultService === 'ollama') {
      try {
        const baseUrl = config.ollamaConfig?.baseUrl || 'http://localhost:11434';
        console.log(`检查Ollama服务连接: ${baseUrl}`);

        const checkResult = await checkOllamaConnection(baseUrl);
        if (!checkResult.connected) {
          console.error('Ollama服务连接检查失败:', checkResult.message);
          throw new Error(`Ollama服务连接失败: ${checkResult.message}`);
        } else {
          console.log('Ollama服务连接检查成功:', checkResult.message);
        }
      } catch (error) {
        console.error('Ollama服务检查失败:', error);

        // 提供详细的错误信息和解决方案
        const errorMessage = error.message && error.message.includes('CORS')
          ? error.message
          : `Ollama服务连接失败。请按照以下步骤操作:

1. 确保Ollama服务已启动
2. 使用以下命令启动Ollama服务以允许浏览器扩展访问:
   OLLAMA_ORIGINS="*" ollama serve
3. 确保防火墙未阻止端口11434
4. 如果问题仍然存在，尝试切换到OpenAI服务`;

        throw new Error(errorMessage);
      }
    }

    const service = AIServiceFactory.createService(config.defaultService, config);

    let result;
    switch (request.action) {
      case 'translate':
        result = await service.translate(request.text, request.targetLang);
        break;
      case 'explain':
        result = await service.explain(request.text);
        break;
      case 'detectLanguage':
        result = await service.detectLanguage(request.text);
        break;
      case 'detectDomain':
        result = await service.detectDomain(request.text);
        break;
      default:
        throw new Error(`Unsupported action: ${request.action}`);
    }

    sendResponse({ success: true, data: result });
  } catch (error) {
    console.error('AI请求处理错误:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Ollama模型列表获取函数
async function fetchOllamaModels(baseUrl) {
  try {
    console.log(`尝试获取Ollama模型列表: ${baseUrl}/api/tags`);

    // 添加CORS相关头信息
    const requestOptions = {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Accept': 'application/json',
        'Origin': chrome.runtime.getURL('')
      }
    };

    const response = await fetch(`${baseUrl}/api/tags`, requestOptions);

    if (!response.ok) {
      const errorText = await response.text();
      // 403错误特殊处理
      if (response.status === 403) {
        throw new Error(`Ollama服务拒绝访问 (HTTP 403)。请确保使用命令启动Ollama服务:
OLLAMA_ORIGINS="*" ollama serve`);
      } else {
        throw new Error(`Ollama API错误 (${response.status}): ${errorText}`);
      }
    }

    const data = await response.json();
    console.log("Ollama返回原始模型数据:", data);

    let models = [];

    if (!data.models) {
      if (Array.isArray(data)) {
        // 有些版本可能直接返回模型数组
        models = data.map(model => ({
          name: model.name || model,
          modified_at: model.modified_at || new Date().toISOString()
        }));
      } else {
        // 尝试其他可能的格式
        models = data.models || data.tags || [];
      }
    } else {
      models = data.models;
    }

    // 过滤掉嵌入模型，只保留对话模型
    // 嵌入模型通常包含'embed'、'embedding'等关键词
    const chatModels = models.filter(model => {
      const modelName = model.name || model;
      const lowerName = modelName.toLowerCase();
      return !lowerName.includes('embed') &&
             !lowerName.includes('encoding') &&
             !lowerName.includes('clip') &&
             !lowerName.includes('text-embedding');
    });

    console.log("过滤后的对话模型:", chatModels);
    return chatModels;
  } catch (error) {
    console.error("获取Ollama模型列表错误:", error);

    if (error.message.includes('Failed to fetch') ||
        error.message.includes('NetworkError') ||
        error.message.includes('CORS') ||
        error.message.includes('403')) {
      throw new Error(
        `无法连接到Ollama服务 (${baseUrl})。请确保:\n` +
        `1. Ollama服务已启动\n` +
        `2. 使用命令 OLLAMA_ORIGINS="*" ollama serve 启动服务\n` +
        `3. 端口11434未被防火墙阻止`
      );
    }

    throw error;
  }
}

// Ollama生成文本请求函数
async function makeOllamaRequest(baseUrl, model, prompt) {
  try {
    console.log(`发送Ollama生成请求: ${baseUrl}/api/generate, 模型: ${model}`);

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    // 构建请求选项
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 1000
        }
      }),
      signal: controller.signal
    };

    // 尝试添加跨域请求头
    try {
      requestOptions.mode = 'cors';
      requestOptions.credentials = 'omit';

      // 添加Origin头，但这可能在某些浏览器中被忽略
      if (!requestOptions.headers.Origin) {
        requestOptions.headers.Origin = chrome.runtime.getURL('');
      }
    } catch (headerError) {
      console.warn('添加跨域头信息失败，继续尝试请求:', headerError);
    }

    const response = await fetch(`${baseUrl}/api/generate`, requestOptions);

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      // 403错误特殊处理
      if (response.status === 403) {
        throw new Error(`Ollama服务拒绝访问 (HTTP 403)。请确保使用正确的命令启动Ollama服务:\nOLLAMA_ORIGINS="*" ollama serve`);
      } else {
        throw new Error(`Ollama API错误 (${response.status}): ${errorText}`);
      }
    }

    const data = await response.json();
    console.log("Ollama生成响应:", data);

    // 处理不同的响应格式
    if (data.response) {
      return data.response;
    } else if (data.message) {
      return data.message;
    } else if (data.text || data.content) {
      return data.text || data.content;
    } else if (typeof data === 'string') {
      return data;
    } else if (data.error) {
      throw new Error(`Ollama服务错误: ${data.error}`);
    } else {
      console.warn('Ollama返回了未知格式的数据:', data);
      return JSON.stringify(data);
    }
  } catch (error) {
    console.error("Ollama生成请求错误:", error);

    if (error.name === 'AbortError') {
      throw new Error('Ollama服务请求超时，请检查服务是否正常运行');
    }

    if (error.message.includes('Failed to fetch') ||
        error.message.includes('NetworkError') ||
        error.message.includes('CORS') ||
        error.message.includes('403')) {
      throw new Error(
        `无法连接到Ollama服务 (${baseUrl})。请确保:\n` +
        `1. Ollama服务已启动\n` +
        `2. 使用命令 OLLAMA_ORIGINS="*" ollama serve 启动服务\n` +
        `3. 端口11434未被防火墙阻止\n` +
        `4. 浏览器扩展有权限访问本地服务`
      );
    }

    throw error;
  }
}

// 改进版Ollama连接检查函数
async function checkOllamaConnection(baseUrl) {
  try {
    console.log(`检查Ollama服务连接: ${baseUrl}/api/version`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // 添加CORS相关头信息
    const requestOptions = {
      method: 'GET',
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Accept': 'application/json',
        'Origin': chrome.runtime.getURL('')
      }
    };

    const response = await fetch(`${baseUrl}/api/version`, requestOptions);

    clearTimeout(timeoutId);

    if (!response.ok) {
      // 403错误特殊处理
      if (response.status === 403) {
        return {
          connected: false,
          message: `Ollama服务拒绝访问 (HTTP 403)。请确保使用命令启动Ollama服务:
OLLAMA_ORIGINS="*" ollama serve`
        };
      }
      return {
        connected: false,
        message: `Ollama服务返回错误: ${response.status} ${response.statusText}`
      };
    }

    const data = await response.json();

    // 尝试获取模型列表
    try {
      const models = await fetchOllamaModels(baseUrl);
      const modelCount = Array.isArray(models) ? models.length : 0;
      return {
        connected: true,
        message: `Ollama服务连接正常 (v${data.version || 'unknown'})，已安装${modelCount}个模型`,
        models: models
      };
    } catch (modelError) {
      console.warn("获取模型列表失败，但服务连接正常:", modelError);

      // 检查是否是权限错误
      if (modelError.message && modelError.message.includes('403')) {
        return {
          connected: false,
          message: `连接到Ollama服务成功，但获取模型列表时被拒绝 (403)。请确保使用命令启动Ollama服务:
OLLAMA_ORIGINS="*" ollama serve`
        };
      }

      return {
        connected: true,
        message: `Ollama服务连接正常 (v${data.version || 'unknown'})，但无法获取模型列表`,
        models: []
      };
    }
  } catch (error) {
    let message = 'Ollama服务连接失败';

    if (error.name === 'AbortError') {
      message = 'Ollama服务连接超时';
    } else if (
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError') ||
      error.message.includes('Network Error') ||
      error.message.includes('CORS') ||
      error.message.includes('cross-origin')
    ) {
      message = `无法连接到Ollama服务 (CORS错误)。请使用以下命令启动Ollama:

OLLAMA_ORIGINS="*" ollama serve

确保端口11434未被防火墙阻止，且服务正在运行。`;
    } else if (error.message.includes('403')) {
      message = `Ollama服务拒绝访问 (HTTP 403)。请确保使用命令启动Ollama服务:
OLLAMA_ORIGINS="*" ollama serve`;
    }

    return {
      connected: false,
      message: message
    };
  }
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['config'], (result) => {
      resolve(result.config || defaultConfig);
    });
  });
}

// 创建offscreen文档以处理网络请求
async function createOffscreenDocument() {
  if (await chrome.offscreen.hasDocument?.()) return;

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: '用于与本地Ollama服务通信'
    });
    console.log('已创建offscreen文档以处理网络请求');
  } catch (error) {
    console.error('创建offscreen文档失败:', error);
    // 如果不支持offscreen API，静默失败
  }
}

// 通过offscreen页面发送Ollama请求
async function makeOllamaRequestViaOffscreen(baseUrl, model, prompt) {
  // 检查是否支持offscreen API
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    console.warn('当前浏览器不支持Offscreen API，将直接使用fetch请求');
    return makeOllamaRequest(baseUrl, model, prompt);
  }

  try {
    await createOffscreenDocument();

    // 如果创建成功，尝试使用消息通信
    try {
      return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('等待Offscreen响应超时，将尝试直接请求'));
        }, 5000);

        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'OLLAMA_REQUEST',
          data: {
            baseUrl,
            model,
            prompt
          }
        }, response => {
          clearTimeout(timeoutId);

          if (chrome.runtime.lastError) {
            console.warn('Offscreen通信错误:', chrome.runtime.lastError);
            // 尝试直接请求
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!response || !response.success) {
            reject(new Error(response?.error || '请求失败，未收到有效响应'));
          } else {
            resolve(response.data);
          }
        });
      });
    } catch (messageError) {
      console.warn('通过Offscreen通信失败，尝试直接请求:', messageError);
      // 如果offscreen方式失败，回退到直接请求
      return makeOllamaRequest(baseUrl, model, prompt);
    }
  } catch (error) {
    console.warn('Offscreen文档创建失败，尝试直接请求:', error);
    // 如果offscreen方式失败，回退到直接请求
    return makeOllamaRequest(baseUrl, model, prompt);
  }
}