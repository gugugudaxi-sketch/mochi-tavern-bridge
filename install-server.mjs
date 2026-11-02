import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function installServer(extensionDirectory, tavernDirectory) {
    const root = path.resolve(tavernDirectory);
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    if (String(pkg.name).toLowerCase() !== 'sillytavern') throw new Error('这不是 SillyTavern 根目录，未修改任何文件');
    const configPath = path.join(root, 'config.yaml');
    const config = await fs.readFile(configPath, 'utf8');
    const source = path.join(extensionDirectory, 'server');
    const files = ['index.mjs', 'core.mjs'];
    const payload = await Promise.all(files.map(file => fs.readFile(path.join(source, file))));
    const destination = path.join(root, 'plugins', 'mochi-bridge-server');
    await fs.mkdir(destination, { recursive: true });
    // Only replace executable plugin sources. Pairing codes and memories are never copied or removed.
    for (let i = 0; i < files.length; i++) await fs.writeFile(path.join(destination, files[i]), payload[i]);
    const updated = /^enableServerPlugins:\s*(?:true|false)\b/m.test(config)
        ? config.replace(/^(enableServerPlugins:\s*)(?:true|false)\b/m, '$1true')
        : `${config.replace(/\s*$/, '')}\nenableServerPlugins: true\n`;
    if (updated !== config) {
        const backup = `${configPath}.before-mochi-bridge`;
        try { await fs.writeFile(backup, config, { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        await fs.writeFile(configPath, updated);
    }
    return destination;
}
export async function findTavernDirectory(start) {
    let cursor = path.resolve(start);
    while (true) {
        try {
            const pkg = JSON.parse(await fs.readFile(path.join(cursor, 'package.json'), 'utf8'));
            if (String(pkg.name).toLowerCase() === 'sillytavern') return cursor;
        } catch { /* Continue to the containing directory. */ }
        const parent = path.dirname(cursor);
        if (parent === cursor) throw new Error('请把扩展安装进酒馆后再运行此脚本');
        cursor = parent;
    }
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
    try {
        const directory = path.dirname(self);
        const root = process.argv[2] || await findTavernDirectory(directory);
        await installServer(directory, root);
        console.log('Mochi 服务端已安装，已开启 enableServerPlugins。请重启酒馆，再打开扩展配对。');
    } catch (error) { console.error(`安装未完成：${error.message}`); process.exitCode = 1; }
}
