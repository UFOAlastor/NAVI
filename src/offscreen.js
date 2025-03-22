// 处理来自background.js的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  console.log('Offscreen页面收到消息:', message);

  switch (message.type) {
    case 'OLLAMA_REQUEST':
      handleOllamaRequest(message.data)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // 保持消息通道开放

    default:
      console.warn('未知消息类型:', message.type);
      sendResponse({ success: false, error: '未知消息类型' });
      return false;
  }
});

// 处理Ollama API请求
async function handleOllamaRequest(data) {
  const { baseUrl, model, prompt } = data;

  try {
    console.log(`Offscreen页面发送Ollama请求: ${baseUrl}/api/generate`);

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

      // 添加Origin头但这可能在某些浏览器中被忽略
      requestOptions.headers.Origin = location.origin;
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
        `3. 端口11434未被防火墙阻止`
      );
    }

    throw error;
  }
}

console.log('NAVI Offscreen页面已加载，准备处理网络请求');