const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const packageJson = require('./package.json');
const fs = require('fs');

// 读取manifest.json并更新版本号
const manifestPath = path.resolve(__dirname, 'manifest.json');
const manifest = require(manifestPath);
manifest.version = packageJson.version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

module.exports = {
  entry: {
    background: './src/background.js',
    content: './src/content.js',
    popup: './src/popup.js',
    offscreen: './src/offscreen.js',
    'utils/i18n': './src/utils/i18n.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.VERSION': JSON.stringify(packageJson.version)
    }),
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'src/popup.html', to: 'popup.html' },
        { from: 'src/content.css', to: 'content.css' },
        { from: 'src/offscreen.html', to: 'offscreen.html' },
        { from: 'src/troubleshooting.html', to: 'troubleshooting.html' },
        { from: 'icons', to: 'icons' },
        { from: '_locales', to: '_locales' }
      ]
    })
  ]
};
