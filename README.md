# NAVI - 智能划词助手

NAVI是一个强大的浏览器划词翻译插件，支持多AI平台和本地模型，提供智能翻译和解释功能。

## 主要特性

- 支持多AI平台API（OpenAI、Gemini等）
- 支持本地Ollama模型部署
- 智能文本类型识别
- 动态任务分配（翻译/解释）
- 专业术语注释
- 跨浏览器支持（Chrome/Edge）

## 安装说明

1. 克隆仓库：
```bash
git clone https://github.com/yourusername/navi.git
cd navi
```

2. 安装依赖：
```bash
npm install
```

3. 构建项目：
```bash
npm run build
```

4. 在Chrome/Edge中加载插件：
   - 打开浏览器扩展管理页面
   - 启用开发者模式
   - 点击"加载已解压的扩展程序"
   - 选择项目中的`dist`目录

## 配置说明

1. 点击浏览器工具栏中的NAVI图标
2. 在设置页面中：
   - 选择默认AI服务
   - 配置API密钥
   - 设置Ollama服务器地址和模型

## 使用方法

1. 在网页上选中任意文本
2. NAVI会自动检测文本类型并执行相应任务：
   - 外语文本 → 翻译
   - 专业术语 → 解释+百科补充
   - 混合模式 → 翻译+术语注释

## 开发说明

- 开发模式：`npm run dev`
- 生产构建：`npm run build`

## 技术栈

- JavaScript (ES6+)
- Chrome Extension Manifest V3
- Webpack
- OpenAI API
- Ollama

## 许可证

MIT License
