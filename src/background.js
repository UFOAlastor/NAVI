import { AIServiceFactory } from './services/ai-service';

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
      makeOllamaRequest(request.baseUrl, request.model, request.prompt)
        .then(result => {
          sendResponse({ success: true, data: result });
        })
        .catch(error => {
          console.error("Ollama生成请求失败:", error);
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
    const response = await fetch(`${baseUrl}/api/tags`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API错误 (${response.status}): ${errorText}`);
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
        error.message.includes('CORS')) {
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
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 1000
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API错误 (${response.status}): ${errorText}`);
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

    if (error.message.includes('Failed to fetch') ||
        error.message.includes('NetworkError') ||
        error.message.includes('CORS')) {
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

// 改进版Ollama连接检查函数
async function checkOllamaConnection(baseUrl) {
  try {
    console.log(`检查Ollama服务连接: ${baseUrl}/api/version`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/api/version`, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
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