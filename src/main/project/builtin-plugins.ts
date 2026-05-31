import type { PluginManifest } from '../../shared/types'

interface BuiltinPluginFile {
  path: string
  content: string
}

export interface BuiltinPlugin {
  id: string
  manifest: PluginManifest
  files: BuiltinPluginFile[]
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

const sillyTavernManifest: PluginManifest = {
  id: 'silly_tavern_compat',
  name: 'SillyTavern 兼容',
  description: '用项目插件数据目录中的角色卡与世界书 JSON 构建 SillyTavern 风格上下文。',
  versionCode: 1,
  dependencies: [],
  entry: {
    initGlobal: 'initGlobal.js',
    initChat: 'initChat.js',
    chatBlockProcessor: 'chatBlockProcessor.js',
    settingsHtml: 'settings.html'
  }
}

const loreBookToolManifest: PluginManifest = {
  id: 'character_card_tool_calls',
  name: '世界书编辑工具',
  description: '把当前已实现的世界书临时编辑工具以聊天工具插件形式暴露给 LLM。',
  versionCode: 1,
  dependencies: ['silly_tavern_compat'],
  entry: {
    initGlobal: 'initGlobal.js',
    initChat: 'initChat.js',
    toolCalls: [
      {
        name: 'lorebook_edit',
        label: '世界书编辑工具组',
        handler: 'handler.js',
        settingsHtml: 'toolSettings.html',
        prompt: [
          '你可以使用世界书编辑工具组来查看、测试、更新或新建当前绑定世界书的条目草稿。',
          '重要规则：这些工具只会编辑插件数据目录中的世界书 JSON，不会直接修改聊天内容。',
          '更新条目前先列出条目，避免重复创建；不确定触发效果时先测试触发。'
        ].join('\n'),
        tools: [
          {
            name: 'list_lorebook_entries',
            description: '获取绑定世界书中的所有条目，只返回 [id, title] 二元组。',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false
            }
          },
          {
            name: 'get_lorebook_entries_json',
            description: '按 id 列表读取绑定世界书中的完整条目 JSON。',
            inputSchema: {
              type: 'object',
              properties: {
                ids: {
                  type: 'array',
                  items: { type: 'number' },
                  description: '要读取完整 JSON 的世界书条目 id 列表。'
                }
              },
              required: ['ids'],
              additionalProperties: false
            }
          },
          {
            name: 'test_lorebook_trigger',
            description: '用一条例句测试绑定世界书会触发哪些条目。',
            inputSchema: {
              type: 'object',
              properties: {
                example: {
                  type: 'string',
                  description: '用于测试世界书触发的例句。'
                }
              },
              required: ['example'],
              additionalProperties: false
            }
          },
          {
            name: 'upsert_lorebook_entry',
            description: '更新或新建绑定世界书中的条目。',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'number', description: '要更新的世界书条目 id；不传时新建。' },
                title: { type: 'string', description: '世界书条目的显示标题或备忘。' },
                order: { type: 'number', description: '条目注入排序。' },
                position: {
                  type: 'number',
                  enum: [0, 1, 4, 5, 6],
                  description: '0=角色定义前，1=角色定义后，4=At Depth，5/6=示例对话。'
                },
                role: {
                  anyOf: [
                    { type: 'number', enum: [0, 1, 2] },
                    { type: 'string', enum: ['system', 'user', 'assistant'] }
                  ],
                  description: 'At Depth 使用的角色。0/system，1/user，2/assistant。'
                },
                depth: { type: 'number', description: 'At Depth 插入深度。' },
                probability: { type: 'number', minimum: 0, maximum: 100, description: '触发概率。' },
                enabled: { type: 'boolean', description: '是否启用。' },
                constant: { type: 'boolean', description: '是否常驻。' },
                selective: { type: 'boolean', description: '是否启用次关键词。' },
                selectiveLogic: { type: 'number', enum: [0, 1, 2, 3], description: '0=AND ANY，3=AND ALL，1=NOT ALL，2=NOT ANY。' },
                keys: { type: 'array', items: { type: 'string' }, description: '主关键词。' },
                secondaryKeys: { type: 'array', items: { type: 'string' }, description: '次关键词。' },
                content: { type: 'string', description: '条目触发后插入提示词中的正文。' }
              },
              additionalProperties: false
            }
          }
        ]
      }
    ],
    settingsHtml: 'settings.html'
  }
}

const promptTemplateManifest: PluginManifest = {
  id: 'st_prompt_template_compat',
  name: 'ST-Prompt-Template 兼容',
  description: '提供 ST-Prompt-Template 风格的 EJS 消息处理与变量设置。',
  versionCode: 1,
  dependencies: ['silly_tavern_compat'],
  entry: {
    initGlobal: 'initGlobal.js',
    initChat: 'initChat.js',
    chatBlockProcessor: 'chatBlockProcessor.js',
    settingsHtml: 'settings.html'
  }
}

const commonStyle = `
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; padding: 12px; color: #253041; background: #fff; font-size: 13px; }
    h1 { margin: 0 0 10px; font-size: 16px; }
    h2 { margin: 16px 0 8px; font-size: 13px; color: #536071; }
    label { display: grid; gap: 5px; margin: 8px 0; color: #536071; }
    input, select, textarea, button { font: inherit; }
    input, select, textarea { border: 1px solid #cfd7e2; border-radius: 6px; padding: 7px 8px; color: #1f2935; background: #fff; }
    textarea { min-height: 140px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    button { border: 1px solid #cfd7e2; border-radius: 6px; background: #f8fafc; color: #253041; padding: 7px 10px; cursor: pointer; }
    button.primary { border-color: #2f6fca; background: #2f6fca; color: #fff; }
    button.danger { color: #9d2c2c; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .grid { display: grid; gap: 8px; }
    .muted { color: #6b7583; font-size: 12px; }
    .list { display: grid; gap: 6px; margin-top: 8px; }
    .item { border: 1px solid #dce3ec; border-radius: 8px; padding: 8px; background: #fbfcfd; }
    .item strong { display: block; margin-bottom: 2px; }
    .status { min-height: 18px; color: #2a8655; }
    .error { color: #c43e3e; }
  </style>
`

const sillyTavernSettingsHtml = `<!doctype html>
<html>
<head><meta charset="UTF-8" />${commonStyle}</head>
<body>
  <h1>SillyTavern 兼容数据</h1>
  <p class="muted">角色卡保存在 <code>pluginData/silly_tavern_compat/characters</code>，世界书保存在 <code>pluginData/silly_tavern_compat/worldbooks</code>。</p>
  <section class="grid">
    <h2>角色卡</h2>
    <div class="row">
      <select id="characterSelect"></select>
      <button id="newCharacter">新建</button>
      <button id="saveCharacter" class="primary">保存</button>
    </div>
    <label>文件名<input id="characterFile" placeholder="character.json" /></label>
    <textarea id="characterJson" spellcheck="false"></textarea>
  </section>
  <section class="grid">
    <h2>世界书</h2>
    <div class="row">
      <select id="worldBookSelect"></select>
      <button id="newWorldBook">新建</button>
      <button id="saveWorldBook" class="primary">保存</button>
    </div>
    <label>文件名<input id="worldBookFile" placeholder="worldbook.json" /></label>
    <textarea id="worldBookJson" spellcheck="false"></textarea>
  </section>
  <p id="status" class="status"></p>
  <script>
    const api = window.parentPluginApi;
    const $ = (id) => document.getElementById(id);
    const sampleCharacter = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Untitled Character', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], extensions: { depth_prompt: { prompt: '', depth: 4, role: 'system' } } } };
    const sampleWorldBook = { name: 'Untitled WorldBook', entries: [] };
    function fileName(value, fallback) {
      const clean = String(value || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
      return clean.endsWith('.json') ? clean : (clean || fallback).replace(/\\.json$/, '') + '.json';
    }
    function setStatus(text, error = false) {
      $('status').textContent = text;
      $('status').className = error ? 'status error' : 'status';
    }
    async function listJson(dir) {
      const files = await api.storage.list(dir);
      return files.filter(file => file.name.endsWith('.json'));
    }
    async function refreshSelect(select, dir) {
      const files = await listJson(dir);
      select.innerHTML = '<option value="">选择文件</option>' + files.map(file => '<option value="' + file.path + '">' + file.name + '</option>').join('');
    }
    async function loadFile(path, textarea, input) {
      if (!path) return;
      const text = await api.storage.readText(path);
      textarea.value = JSON.stringify(JSON.parse(text), null, 2);
      input.value = path.split('/').pop();
    }
    async function boot() {
      await Promise.all([
        refreshSelect($('characterSelect'), 'characters'),
        refreshSelect($('worldBookSelect'), 'worldbooks')
      ]);
    }
    $('characterSelect').addEventListener('change', () => loadFile($('characterSelect').value, $('characterJson'), $('characterFile')).catch(error => setStatus(error.message, true)));
    $('worldBookSelect').addEventListener('change', () => loadFile($('worldBookSelect').value, $('worldBookJson'), $('worldBookFile')).catch(error => setStatus(error.message, true)));
    $('newCharacter').addEventListener('click', () => { $('characterFile').value = 'character.json'; $('characterJson').value = JSON.stringify(sampleCharacter, null, 2); });
    $('newWorldBook').addEventListener('click', () => { $('worldBookFile').value = 'worldbook.json'; $('worldBookJson').value = JSON.stringify(sampleWorldBook, null, 2); });
    $('saveCharacter').addEventListener('click', async () => {
      try {
        const parsed = JSON.parse($('characterJson').value);
        await api.storage.writeText('characters/' + fileName($('characterFile').value, 'character.json'), JSON.stringify(parsed, null, 2));
        await refreshSelect($('characterSelect'), 'characters');
        setStatus('角色卡已保存');
      } catch (error) { setStatus(error.message, true); }
    });
    $('saveWorldBook').addEventListener('click', async () => {
      try {
        const parsed = JSON.parse($('worldBookJson').value);
        await api.storage.writeText('worldbooks/' + fileName($('worldBookFile').value, 'worldbook.json'), JSON.stringify(parsed, null, 2));
        await refreshSelect($('worldBookSelect'), 'worldbooks');
        setStatus('世界书已保存');
      } catch (error) { setStatus(error.message, true); }
    });
    boot().catch(error => setStatus(error.message, true));
  </script>
</body>
</html>
`

const loreBookToolSettingsHtml = `<!doctype html>
<html>
<head><meta charset="UTF-8" />${commonStyle}</head>
<body>
  <h1>世界书编辑工具</h1>
  <label>绑定世界书<select id="worldBook"></select></label>
  <p class="muted">保存后会把该世界书文件名写入工具通参。</p>
  <p id="status" class="status"></p>
  <script>
    const api = window.parentPluginApi;
    const $ = (id) => document.getElementById(id);
    async function boot() {
      const files = await api.storage.listFor('silly_tavern_compat', 'worldbooks');
      const select = $('worldBook');
      select.innerHTML = '<option value="">未选择</option>' + files.filter(file => file.name.endsWith('.json')).map(file => '<option value="' + file.name + '">' + file.name + '</option>').join('');
      const current = await api.toolSettings.getCommonArgs();
      select.value = current.worldBookFile || '';
      select.addEventListener('change', () => api.toolSettings.setCommonArgs({ worldBookFile: select.value }));
    }
    boot().catch(error => { $('status').textContent = error.message; $('status').className = 'status error'; });
  </script>
</body>
</html>
`

const promptSettingsHtml = `<!doctype html>
<html>
<head><meta charset="UTF-8" />${commonStyle}</head>
<body>
  <h1>ST-Prompt-Template 兼容</h1>
  <label><span><input id="enabled" type="checkbox" /> 启用</span></label>
  <label><span><input id="renderMessages" type="checkbox" /> 渲染聊天消息中的 EJS</span></label>
  <label>全局变量 JSON<textarea id="globals" spellcheck="false"></textarea></label>
  <button id="save" class="primary">保存</button>
  <p id="status" class="status"></p>
  <script>
    const api = window.parentPluginApi;
    const $ = (id) => document.getElementById(id);
    const defaults = { enabled: true, renderMessages: true, globalVariables: {} };
    async function boot() {
      const config = await api.storage.readJson('config.json', defaults);
      $('enabled').checked = config.enabled !== false;
      $('renderMessages').checked = config.renderMessages !== false;
      $('globals').value = JSON.stringify(config.globalVariables || {}, null, 2);
    }
    $('save').addEventListener('click', async () => {
      try {
        const config = {
          enabled: $('enabled').checked,
          renderMessages: $('renderMessages').checked,
          globalVariables: JSON.parse($('globals').value || '{}')
        };
        await api.storage.writeJson('config.json', config);
        $('status').textContent = '设置已保存';
      } catch (error) {
        $('status').textContent = error.message;
        $('status').className = 'status error';
      }
    });
    boot().catch(error => { $('status').textContent = error.message; $('status').className = 'status error'; });
  </script>
</body>
</html>
`

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  {
    id: sillyTavernManifest.id,
    manifest: sillyTavernManifest,
    files: [
      { path: 'plugin.json', content: json(sillyTavernManifest) },
      { path: 'settings.html', content: sillyTavernSettingsHtml },
      { path: 'initGlobal.js', content: 'return { id: context.plugin.id };\n' },
      { path: 'initChat.js', content: 'return { id: context.plugin.id, chatId: context.chat.id };\n' },
      { path: 'chatBlockProcessor.js', content: 'return context.api.sillyTavernCompat.createProcessor(context);\n' }
    ]
  },
  {
    id: loreBookToolManifest.id,
    manifest: loreBookToolManifest,
    files: [
      { path: 'plugin.json', content: json(loreBookToolManifest) },
      { path: 'settings.html', content: '<!doctype html><meta charset="UTF-8" />' + commonStyle + '<body><h1>世界书编辑工具</h1><p class="muted">在聊天块菜单中插入工具，并在工具设置中选择要编辑的世界书。</p></body>' },
      { path: 'toolSettings.html', content: loreBookToolSettingsHtml },
      { path: 'initGlobal.js', content: 'return { id: context.plugin.id };\n' },
      { path: 'initChat.js', content: 'return { id: context.plugin.id, chatId: context.chat.id };\n' },
      { path: 'handler.js', content: 'return context.api.loreBookTools.createHandler(context);\n' }
    ]
  },
  {
    id: promptTemplateManifest.id,
    manifest: promptTemplateManifest,
    files: [
      { path: 'plugin.json', content: json(promptTemplateManifest) },
      { path: 'settings.html', content: promptSettingsHtml },
      { path: 'initGlobal.js', content: 'return { id: context.plugin.id };\n' },
      { path: 'initChat.js', content: 'return { id: context.plugin.id, chatId: context.chat.id };\n' },
      { path: 'chatBlockProcessor.js', content: 'return context.api.promptTemplateCompat.createProcessor(context);\n' }
    ]
  }
]
