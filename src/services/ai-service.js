import OpenAI from 'openai';
import { CacheManager, RateLimiter, RetryManager, ResultProcessor } from '../utils/ai-utils';

// AI服务接口基类
class AIService {
  constructor(config) {
    this.config = config;
    this.cache = new CacheManager();
    this.rateLimiter = new RateLimiter(
      config.rateLimit?.maxRequests || 60,
      config.rateLimit?.timeWindow || 60000
    );
    this.retryManager = new RetryManager(
      config.retry?.maxRetries || 3,
      config.retry?.baseDelay || 1000
    );
  }

  async translate(text, targetLang) {
    throw new Error('Method not implemented');
  }

  async explain(text) {
    throw new Error('Method not implemented');
  }

  async detectLanguage(text) {
    throw new Error('Method not implemented');
  }

  async detectDomain(text) {
    throw new Error('Method not implemented');
  }

  // 通用错误处理方法
  handleError(error) {
    console.error('AI Service Error:', error);
    throw new Error(`AI服务错误: ${error.message}`);
  }

  // 生成缓存键
  generateCacheKey(method, text, params = {}) {
    return `${method}:${text}:${JSON.stringify(params)}`;
  }

  // 通用API调用包装器
  async callWithRetry(operation) {
    return this.retryManager.execute(async () => {
      await this.rateLimiter.waitForSlot();
      return operation();
    });
  }

  // 通用缓存包装器
  async withCache(method, text, params, operation) {
    const cacheKey = this.generateCacheKey(method, text, params);
    const cachedResult = this.cache.get(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    const result = await this.callWithRetry(operation);
    this.cache.set(cacheKey, result);
    return result;
  }
}

// OpenAI服务实现
class OpenAIService extends AIService {
  constructor(config) {
    super(config);
    if (!config.apiKeys?.openai) {
      throw new Error('OpenAI API密钥未配置');
    }
    const openaiConfig = {
      apiKey: config.apiKeys.openai,
      dangerouslyAllowBrowser: true
    };
    if (config.apiUrls?.openai) {
      openaiConfig.baseURL = config.apiUrls.openai;
    }
    this.client = new OpenAI(openaiConfig);
    this.model = config.openaiConfig?.model || "gpt-4o-mini";
  }

  // 识别常见OpenAI错误并给出更友好的错误信息
  handleOpenAIError(error) {
    // 网络相关错误
    if (error.code === 'ECONNABORTED') {
      throw new Error('网络连接超时，请检查网络设置');
    }
    if (error.message?.includes('Failed to fetch') || error.message?.includes('Network Error')) {
      throw new Error('网络连接失败，请检查网络设置');
    }

    // API密钥相关错误
    if (error.response?.status === 401) {
      throw new Error('OpenAI API密钥无效或已过期');
    }
    if (error.response?.status === 403) {
      throw new Error('没有权限访问OpenAI API，请检查账户状态');
    }

    // 限流和容量错误
    if (error.response?.status === 429) {
      const errorMessage = error.response?.data?.error?.message || '';
      if (errorMessage.includes('Rate limit')) {
        throw new Error('API调用频率超限，请稍后再试');
      }
      if (errorMessage.includes('capacity')) {
        throw new Error('OpenAI服务当前负载过高，请稍后再试');
      }
      throw new Error('API调用次数超限，请稍后再试或检查账户额度');
    }

    // 模型相关错误
    if (error.response?.status === 404) {
      throw new Error(`OpenAI模型"${this.model}"不存在或不可用，请在设置中选择其他模型`);
    }

    // 服务器错误
    if (error.response?.status >= 500) {
      throw new Error('OpenAI服务器错误，请稍后再试');
    }

    // 请求超时
    if (error.message?.includes('timeout')) {
      throw new Error('请求超时，OpenAI服务响应时间过长');
    }

    // 内容过滤
    if (error.message?.includes('content filter') || error.message?.includes('content_filter')) {
      throw new Error('您的请求触发了内容过滤器，请修改内容后重试');
    }

    // 默认错误
    console.error('OpenAI服务错误详情:', error);
    this.handleError(error);
  }

  async translate(text, targetLang) {
    return this.withCache('translate', text, { targetLang }, async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content: `你是一个专业的翻译和分析助手。请处理以下文本并返回三个信息：
1. 将文本翻译成${targetLang}
2. 提供一句话简短解释其含义（通俗易懂，让外行也能理解）
3. 确定文本所属的专业领域（如：计算机、医学、法律、经济等）

返回格式为JSON: {
  "translated": "翻译结果",
  "explanation": "一句话解释",
  "domain": "所属领域"
}`
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        });

        let result;
        try {
          result = JSON.parse(response.choices[0].message.content);
        } catch (e) {
          // 如果解析失败，使用普通文本处理
          result = {
            translated: response.choices[0].message.content,
            explanation: "无法获取解释",
            domain: "未知"
          };
        }

        return {
          translated: result.translated || response.choices[0].message.content,
          explanation: result.explanation || "无法获取解释",
          domain: result.domain || "未知",
          sourceLang: 'auto',
          targetLang,
          timestamp: Date.now()
        };
      } catch (error) {
        this.handleOpenAIError(error);
      }
    });
  }

  async explain(text) {
    return this.withCache('explain', text, {}, async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "你是一个专业的解释助手。请对以下文本进行一句话简短解释，确保通俗易懂，让外行人士也能理解。禁止长篇大论，禁止分点分段，只能用一句话概括。返回格式为JSON: {\"explanation\": \"一句话解释\"}"
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        });

        let result;
        try {
          result = JSON.parse(response.choices[0].message.content);
        } catch (e) {
          // 如果解析失败，使用普通文本处理
          result = {
            explanation: response.choices[0].message.content
          };
        }

        return {
          explanation: result.explanation || response.choices[0].message.content,
          timestamp: Date.now()
        };
      } catch (error) {
        this.handleOpenAIError(error);
      }
    });
  }

  async detectLanguage(text) {
    return this.withCache('detectLanguage', text, {}, async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "你是一个语言检测助手。请检测以下文本的语言，只返回ISO 639-1语言代码（如：zh、en、ja等）。"
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.1
        });
        return ResultProcessor.formatLanguageDetection(
          text,
          response.choices[0].message.content.trim().toLowerCase()
        );
      } catch (error) {
        this.handleOpenAIError(error);
      }
    });
  }

  async detectDomain(text) {
    return this.withCache('detectDomain', text, {}, async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "你是一个领域检测助手。请检测以下文本属于哪个专业领域（如：计算机、医学、法律等），只返回领域名称。"
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.1
        });
        return ResultProcessor.formatDomainDetection(
          text,
          response.choices[0].message.content.trim()
        );
      } catch (error) {
        this.handleOpenAIError(error);
      }
    });
  }
}

// Ollama本地服务实现
class OllamaService extends AIService {
  constructor(config) {
    super(config);
    this.baseUrl = config.ollamaConfig.baseUrl || 'http://localhost:11434';
    this.model = config.ollamaConfig.model || 'qwen2.5:7b';
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 3;
    this.connectionTimeout = 5000;
  }

  // 识别Ollama特定错误并给出友好提示
  handleOllamaError(error) {
    const errorMsg = error.message || '';

    // 连接相关错误
    if (errorMsg.includes('AbortError') || errorMsg.includes('timeout')) {
      throw new Error('Ollama服务响应超时，请检查服务是否正常运行');
    }

    if (errorMsg.includes('Failed to fetch') || errorMsg.includes('network error')) {
      throw new Error('无法连接到Ollama服务，请确保服务已启动并可以访问');
    }

    if (errorMsg.includes('无法连接到Ollama服务')) {
      throw new Error('无法连接到Ollama服务，请确保服务已启动且端口 11434 可访问');
    }

    // 模型相关错误
    if (errorMsg.includes('model') && errorMsg.includes('not found')) {
      throw new Error(`Ollama模型"${this.model}"未找到，请在Ollama中下载该模型`);
    }

    if (errorMsg.includes('模型 ') && errorMsg.includes(' 下载失败')) {
      throw new Error(`Ollama模型下载失败，请手动通过Ollama CLI下载"${this.model}"`);
    }

    // 权限错误
    if (errorMsg.includes('Permission denied') || errorMsg.includes('403')) {
      throw new Error('没有权限访问Ollama服务，请检查服务配置');
    }

    // API响应错误
    if (errorMsg.includes('Ollama API错误') || errorMsg.includes('Ollama返回数据格式错误')) {
      throw new Error('Ollama服务返回错误数据，可能是版本不兼容或配置问题');
    }

    // 默认错误处理
    console.error('Ollama服务错误详情:', error);
    throw new Error(`Ollama服务错误: ${errorMsg}`);
  }

  // 使用背景脚本的消息通信方式替代直接API调用
  async makeRequest(prompt) {
    if (!this.isConnected) {
      await this.checkConnection();
    }

    try {
      console.log('通过background.js发送请求到Ollama服务，模型:', this.model);

      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "OLLAMA_API_REQUEST",
          action: "GENERATE",
          baseUrl: this.baseUrl,
          model: this.model,
          prompt: prompt
        }, response => {
          if (chrome.runtime.lastError) {
            this.isConnected = false;
            return reject(new Error('与背景脚本通信失败: ' + chrome.runtime.lastError.message));
          }

          if (!response || !response.success) {
            this.isConnected = false;
            return reject(new Error(response?.error || '请求失败，未收到有效响应'));
          }

          resolve(response.data);
        });
      });
    } catch (error) {
      this.isConnected = false;
      this.handleOllamaError(error);
    }
  }

  async checkConnection() {
    if (this.connectionAttempts >= this.maxConnectionAttempts) {
      this.isConnected = false;
      throw new Error(`无法连接到Ollama服务 (${this.baseUrl})。请确保：
1. Ollama 服务已启动
2. 浏览器扩展有权限访问本地服务
3. 端口 11434 未被占用`);
    }

    try {
      console.log(`通过background.js检查Ollama服务连接: ${this.baseUrl}`);

      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "GET_CONFIG",
          action: "checkOllamaConnection",
          baseUrl: this.baseUrl
        }, response => {
          if (chrome.runtime.lastError) {
            return reject(new Error('与背景脚本通信失败: ' + chrome.runtime.lastError.message));
          }

          if (!response || !response.success) {
            return reject(new Error(response?.error || '检查连接失败，未收到有效响应'));
          }

          resolve(response.data);
        });
      });

      if (!result.connected) {
        throw new Error(result.message);
      }

      // 如果有可用模型，更新模型列表
      if (result.models && result.models.length > 0) {
        console.log('发现可用Ollama模型:', result.models);
        // 优先使用第一个可用模型作为默认模型
        if (this.model === 'qwen2.5:7b' && result.models.length > 0) {
          this.model = result.models[0].name || result.models[0];
          console.log('自动设置默认模型为:', this.model);
        }
      }

      console.log('Ollama服务连接状态:', result.message);
      this.isConnected = true;
      this.connectionAttempts = 0;
      return true;
    } catch (error) {
      this.isConnected = false;
      this.connectionAttempts++;

      let errorMessage = error.message;
      console.warn(`Ollama服务连接失败 (${this.connectionAttempts}/${this.maxConnectionAttempts}): ${errorMessage}`);

      if (this.connectionAttempts < this.maxConnectionAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.checkConnection();
      }

      throw new Error(errorMessage);
    }
  }

  async getAvailableModels() {
    try {
      console.log(`通过background.js获取Ollama可用模型列表: ${this.baseUrl}`);

      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "OLLAMA_API_REQUEST",
          action: "LIST_MODELS",
          baseUrl: this.baseUrl
        }, response => {
          if (chrome.runtime.lastError) {
            return reject(new Error('与背景脚本通信失败: ' + chrome.runtime.lastError.message));
          }

          if (!response || !response.success) {
            return reject(new Error(response?.error || '获取模型列表失败，未收到有效响应'));
          }

          resolve(response.data);
        });
      });
    } catch (error) {
      console.error('获取Ollama模型列表失败:', error);
      throw error;
    }
  }

  async translate(text, targetLang) {
    return this.withCache('translate', text, { targetLang }, async () => {
      try {
        const prompt = `你是一个专业的翻译和分析助手。
请处理以下文本并返回三个信息：
1. 将文本翻译成${targetLang}
2. 提供一句话简短解释其含义（通俗易懂，让外行也能理解）
3. 确定文本所属的专业领域（如：计算机、医学、法律、经济等）

请按照以下JSON格式返回结果:
{
  "translated": "翻译结果",
  "explanation": "一句话解释",
  "domain": "所属领域"
}

以下是需要处理的文本:
${text}`;

        const result = await this.makeRequest(prompt);

        // 尝试解析JSON结果
        try {
          const parsedResult = JSON.parse(result);
          return {
            translated: parsedResult.translated || result,
            explanation: parsedResult.explanation || "无法获取解释",
            domain: parsedResult.domain || "未知",
            sourceLang: 'auto',
            targetLang,
            timestamp: Date.now()
          };
        } catch (e) {
          console.error('解析Ollama响应失败:', e);
          // 解析失败时返回原始文本作为翻译结果
          return {
            translated: result,
            explanation: "无法获取解释",
            domain: "未知",
            sourceLang: 'auto',
            targetLang,
            timestamp: Date.now()
          };
        }
      } catch (error) {
        this.handleOllamaError(error);
      }
    });
  }

  async explain(text) {
    return this.withCache('explain', text, {}, async () => {
      try {
        const prompt = `请对以下文本进行一句话简短解释，确保通俗易懂，让外行人士也能理解。禁止长篇大论，禁止分点分段，只能用一句话概括：\n${text}`;
        const result = await this.makeRequest(prompt);
        return ResultProcessor.formatExplanation(result);
      } catch (error) {
        this.handleOllamaError(error);
      }
    });
  }

  async detectDomain(text) {
    return this.withCache('detectDomain', text, {}, async () => {
      try {
        const prompt = `请检测以下文本属于哪个专业领域（如：计算机、医学、法律等），只返回领域名称：\n${text}`;
        const result = await this.makeRequest(prompt);
        return ResultProcessor.formatDomainDetection(text, result.trim());
      } catch (error) {
        this.handleOllamaError(error);
      }
    });
  }
}

// AI服务工厂
class AIServiceFactory {
  static createService(type, config) {
    console.log(`AIServiceFactory: 创建 ${type} 服务，配置:`, config);

    try {
      switch(type) {
        case 'openai':
          // 确保配置满足要求
          if (!config.apiKeys || !config.apiKeys.openai) {
            console.warn('AIServiceFactory: OpenAI API密钥未配置');
            return new DummyService({
              errorMessage: 'OpenAI API密钥未配置，请在扩展设置中添加API密钥'
            });
          }

          // 确保OpenAI配置存在
          config.openaiConfig = config.openaiConfig || {};
          config.openaiConfig.model = config.openaiConfig.model || 'gpt-4o-mini';

          // 确保API URL存在
          config.apiUrls = config.apiUrls || {};
          config.apiUrls.openai = config.apiUrls.openai || 'https://api.openai.com/v1';

          console.log('AIServiceFactory: 创建OpenAI服务，使用模型:', config.openaiConfig.model);
          return new OpenAIService(config);

        case 'ollama':
          // 确保配置满足要求
          if (!config.ollamaConfig || !config.ollamaConfig.baseUrl) {
            console.warn('AIServiceFactory: Ollama 服务器地址未配置');
            return new DummyService({
              errorMessage: 'Ollama 服务器地址未配置，请在扩展设置中完成配置'
            });
          }

          console.log('AIServiceFactory: 创建Ollama服务，使用模型:', config.ollamaConfig.model);
          return new OllamaService(config);

        default:
          console.warn('AIServiceFactory: 未知服务类型:', type);
          return new DummyService({
            errorMessage: `未知服务类型: ${type}`
          });
      }
    } catch (error) {
      console.error('AIServiceFactory: 创建服务时出错:', error);
      return new DummyService({
        errorMessage: `创建服务时出错: ${error.message}`
      });
    }
  }
}

// 用于处理配置错误情况的虚拟服务
class DummyService extends AIService {
  constructor(config) {
    super(config);
    this.errorMessage = config.errorMessage || '服务未正确配置';
  }

  async translate() { throw new Error(this.errorMessage); }
  async explain() { throw new Error(this.errorMessage); }
  async detectLanguage() { return 'unknown'; }
  async detectDomain() { return 'unknown'; }
}

export { AIService, AIServiceFactory, OpenAIService, OllamaService, DummyService };