// 从package.json读取版本号
export function getVersion () {
    // VERSION 将由 webpack 在构建时注入
    return process.env.VERSION || 'x.x.x';
}