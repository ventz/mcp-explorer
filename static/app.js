// === State ===
const appState = {
    connected: false,
    serverInfo: null,
    activeTab: 'tools',
    tools: [],
    resources: [],
    prompts: [],
    selected: null, // { type, item }
    result: null,
    resultRaw: false,
};

// === API Helper ===
async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// === Toast ===
function showToast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// === URL History ===
const URL_HISTORY_KEY = 'mcp-explorer:url-history';
const AUTH_CACHE_KEY = 'mcp-explorer:auth-cache';
const PARAM_STORE_KEY = 'mcp-explorer:param-store';

function getUrlHistory() {
    try { return JSON.parse(localStorage.getItem(URL_HISTORY_KEY)) || []; }
    catch { return []; }
}

function saveUrlHistory(url) {
    let hist = getUrlHistory().filter(u => u !== url);
    hist.unshift(url);
    if (hist.length > 20) hist = hist.slice(0, 20);
    localStorage.setItem(URL_HISTORY_KEY, JSON.stringify(hist));
    renderUrlDatalist();
}

function renderUrlDatalist() {
    const dl = document.getElementById('url-history-list');
    dl.innerHTML = '';
    for (const url of getUrlHistory()) {
        const opt = document.createElement('option');
        opt.value = url;
        dl.appendChild(opt);
    }
}

function getAuthCache() {
    try { return JSON.parse(localStorage.getItem(AUTH_CACHE_KEY)) || {}; }
    catch { return {}; }
}

function saveAuthCache(url, authType, authValue, headerName) {
    const cache = getAuthCache();
    cache[url] = { authType, authValue, headerName };
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(cache));
}

function restoreAuth(url) {
    const cache = getAuthCache();
    const entry = cache[url];
    if (!entry) return;
    document.getElementById('auth-type').value = entry.authType || 'none';
    document.getElementById('auth-value').value = entry.authValue || '';
    document.getElementById('header-name').value = entry.headerName || '';
    updateAuthFields();
}

// === Parameter Store ===
function getParamStore() {
    try { return JSON.parse(localStorage.getItem(PARAM_STORE_KEY)) || {}; }
    catch { return {}; }
}

function saveParamStore(store) {
    localStorage.setItem(PARAM_STORE_KEY, JSON.stringify(store));
}

function harvestParams(values) {
    const store = getParamStore();
    for (const [k, v] of Object.entries(values)) {
        if (v !== '' && v !== null && v !== undefined) {
            store[k] = v;
        }
    }
    saveParamStore(store);
    updateParamCount();
}

function updateParamCount() {
    const el = document.getElementById('param-store-count');
    if (el) el.textContent = Object.keys(getParamStore()).length;
}

function harvestResultParams(result) {
    if (!result) return;
    const texts = [];
    const sources = [result.content, result.contents, result.messages];
    for (const src of sources) {
        if (!Array.isArray(src)) continue;
        for (const item of src) {
            if (item.text) texts.push(item.text);
            if (item.content && typeof item.content === 'string') texts.push(item.content);
            if (Array.isArray(item.content)) {
                for (const c of item.content) {
                    if (c.text) texts.push(c.text);
                }
            }
        }
    }
    const store = getParamStore();
    for (const text of texts) {
        try {
            const obj = JSON.parse(text);
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                for (const [k, v] of Object.entries(obj)) {
                    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                        store[k] = String(v);
                    }
                }
            }
        } catch { /* not JSON, skip */ }
    }
    saveParamStore(store);
    updateParamCount();
}

// === Auth Fields ===
function updateAuthFields() {
    const authType = document.getElementById('auth-type').value;
    const headerNameEl = document.getElementById('header-name');
    const authValueEl = document.getElementById('auth-value');
    if (authType === 'none') {
        headerNameEl.classList.add('hidden');
        authValueEl.classList.add('hidden');
    } else if (authType === 'bearer') {
        headerNameEl.classList.add('hidden');
        authValueEl.classList.remove('hidden');
        authValueEl.placeholder = 'Bearer token';
    } else if (authType === 'header') {
        headerNameEl.classList.remove('hidden');
        authValueEl.classList.remove('hidden');
        authValueEl.placeholder = 'Header value';
    }
}

// === Connection ===
async function connect() {
    const url = document.getElementById('url-input').value.trim();
    if (!url) return showToast('Enter a server URL', true);

    const authType = document.getElementById('auth-type').value;
    const authValue = document.getElementById('auth-value').value;
    const headerName = document.getElementById('header-name').value;

    const btn = document.getElementById('connect-btn');
    btn.textContent = 'Connecting...';
    btn.disabled = true;

    try {
        const data = await api('POST', '/api/connect', {
            url, auth_type: authType, auth_value: authValue, header_name: headerName,
        });
        appState.connected = true;
        appState.serverInfo = data.server_info;
        saveUrlHistory(url);
        saveAuthCache(url, authType, authValue, headerName);
        updateConnectionUI();
        await loadAllData();
        showToast('Connected');
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        updateConnectionUI();
    }
}

async function disconnect() {
    try {
        await api('POST', '/api/disconnect');
    } catch { /* ignore */ }
    appState.connected = false;
    appState.serverInfo = null;
    appState.tools = [];
    appState.resources = [];
    appState.prompts = [];
    appState.selected = null;
    appState.result = null;
    updateConnectionUI();
    updateContent();
    showToast('Disconnected');
}

function updateConnectionUI() {
    const btn = document.getElementById('connect-btn');
    const dot = document.getElementById('status-dot');
    const tabBar = document.getElementById('tab-bar');
    const main = document.getElementById('main-content');

    if (appState.connected) {
        btn.textContent = 'Disconnect';
        btn.className = 'btn btn-danger';
        btn.onclick = disconnect;
        dot.className = 'status-dot connected';
        dot.title = 'Connected' + (appState.serverInfo?.name ? ` to ${appState.serverInfo.name}` : '');
        tabBar.classList.remove('hidden');
        main.classList.remove('hidden');
    } else {
        btn.textContent = 'Connect';
        btn.className = 'btn btn-primary';
        btn.onclick = connect;
        dot.className = 'status-dot disconnected';
        dot.title = 'Disconnected';
        tabBar.classList.add('hidden');
        main.classList.add('hidden');
    }
}

// === Data Loading ===
async function loadAllData() {
    const [toolsRes, resourcesRes, promptsRes] = await Promise.allSettled([
        api('GET', '/api/tools'),
        api('GET', '/api/resources'),
        api('GET', '/api/prompts'),
    ]);
    appState.tools = toolsRes.status === 'fulfilled' ? (toolsRes.value.tools || []) : [];
    appState.resources = resourcesRes.status === 'fulfilled' ? (resourcesRes.value.resources || []) : [];
    appState.prompts = promptsRes.status === 'fulfilled' ? (promptsRes.value.prompts || []) : [];
    updateTabCounts();
    updateContent();
}

function updateTabCounts() {
    document.querySelectorAll('.tab').forEach(t => {
        const tab = t.dataset.tab;
        const count = (appState[tab] || []).length;
        t.textContent = `${tab.charAt(0).toUpperCase() + tab.slice(1)} (${count})`;
    });
}

// === Tab Switching ===
function switchTab(tab) {
    appState.activeTab = tab;
    appState.selected = null;
    appState.result = null;
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.list-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`list-${tab}`).classList.remove('hidden');
    updateContent();
}

// === Content Rendering ===
function updateContent() {
    renderList();
    renderDetail();
}

function renderList() {
    const items = appState[appState.activeTab] || [];
    const container = document.getElementById(`list-${appState.activeTab}`);
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<div class="list-item"><span class="list-item-desc">No items</span></div>';
        return;
    }

    for (const item of items) {
        const div = document.createElement('div');
        div.className = 'list-item';
        const name = item.name || item.uri || 'Unnamed';
        const desc = item.description || '';
        div.innerHTML = `<div class="list-item-name">${esc(name)}</div>` +
            (desc ? `<div class="list-item-desc">${esc(desc)}</div>` : '');
        div.addEventListener('click', () => selectItem(appState.activeTab, item));
        if (appState.selected?.item === item) div.classList.add('selected');
        container.appendChild(div);
    }
}

function selectItem(type, item) {
    appState.selected = { type, item };
    appState.result = null;
    appState.resultRaw = false;
    updateContent();
}

function renderDetail() {
    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    const formEl = document.getElementById('detail-form');
    const actionEl = document.getElementById('detail-action');
    const resultEl = document.getElementById('detail-result');

    if (!appState.selected) {
        emptyEl.classList.remove('hidden');
        contentEl.classList.add('hidden');
        return;
    }

    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    const { type, item } = appState.selected;
    document.getElementById('detail-name').textContent = item.name || item.uri || '';
    document.getElementById('detail-description').textContent = item.description || '';

    // Form
    formEl.innerHTML = '';
    formEl.classList.add('hidden');
    actionEl.classList.add('hidden');

    if (type === 'tools' && item.inputSchema) {
        renderSchemaForm(item.inputSchema, formEl);
        formEl.classList.remove('hidden');
        actionEl.classList.remove('hidden');
        actionEl.textContent = 'Call Tool';
        actionEl.onclick = () => callTool(item);
    } else if (type === 'resources') {
        actionEl.classList.remove('hidden');
        actionEl.textContent = 'Read Resource';
        actionEl.onclick = () => readResource(item);
    } else if (type === 'prompts') {
        if (item.arguments && item.arguments.length > 0) {
            const schema = promptArgsToSchema(item.arguments);
            renderSchemaForm(schema, formEl);
            formEl.classList.remove('hidden');
        }
        actionEl.classList.remove('hidden');
        actionEl.textContent = 'Get Prompt';
        actionEl.onclick = () => getPrompt(item);
    }

    // Result
    renderResult();
}

// === Schema Form Builder ===
function renderSchemaForm(schema, container) {
    const props = schema.properties || {};
    const required = schema.required || [];
    const store = getParamStore();

    for (const [key, prop] of Object.entries(props)) {
        const group = document.createElement('div');
        group.className = 'form-group';

        const isRequired = required.includes(key);
        const storeValue = store[key];
        const hasAutoFill = storeValue !== undefined;

        // Label row with link button
        const labelRow = document.createElement('div');
        labelRow.className = 'label-row';

        let labelHtml = `${esc(key)}`;
        if (isRequired) labelHtml += '<span class="required">*</span>';
        if (hasAutoFill) labelHtml += '<span class="auto-badge">auto</span>';

        const label = document.createElement('label');
        label.innerHTML = labelHtml;
        label.setAttribute('for', `field-${key}`);
        labelRow.appendChild(label);

        // Link button — show available store params to inject
        const storeEntries = Object.entries(store);
        if (storeEntries.length > 0) {
            const linkWrap = document.createElement('div');
            linkWrap.className = 'link-wrap';

            const linkBtn = document.createElement('button');
            linkBtn.type = 'button';
            linkBtn.className = 'link-btn';
            linkBtn.title = 'Insert from parameter store';
            linkBtn.innerHTML = '&#x1f517;';

            const dropdown = document.createElement('div');
            dropdown.className = 'link-dropdown hidden';
            dropdown.innerHTML = `<div class="link-dropdown-header">Insert param into <strong>${esc(key)}</strong></div>`;

            for (const [sk, sv] of storeEntries) {
                const option = document.createElement('div');
                option.className = 'link-dropdown-item';
                const preview = String(sv).length > 40 ? String(sv).slice(0, 40) + '...' : String(sv);
                option.innerHTML = `<span class="link-key">${esc(sk)}</span><span class="link-value">${esc(preview)}</span>`;
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const input = document.getElementById(`field-${key}`);
                    if (input) input.value = sv;
                    dropdown.classList.add('hidden');
                });
                dropdown.appendChild(option);
            }

            linkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close any other open dropdowns
                document.querySelectorAll('.link-dropdown').forEach(d => d.classList.add('hidden'));
                dropdown.classList.toggle('hidden');
            });

            linkWrap.appendChild(linkBtn);
            linkWrap.appendChild(dropdown);
            labelRow.appendChild(linkWrap);
        }

        group.appendChild(labelRow);

        let input;
        const type = prop.type || 'string';

        if (prop.enum) {
            input = document.createElement('select');
            input.innerHTML = '<option value="">Select...</option>' +
                prop.enum.map(v => `<option value="${esc(String(v))}">${esc(String(v))}</option>`).join('');
        } else if (type === 'boolean') {
            input = document.createElement('select');
            input.innerHTML = '<option value="">Select...</option><option value="true">true</option><option value="false">false</option>';
        } else if (type === 'number' || type === 'integer') {
            input = document.createElement('input');
            input.type = 'number';
            if (type === 'integer') input.step = '1';
        } else if (type === 'object' || type === 'array') {
            input = document.createElement('textarea');
            input.placeholder = type === 'object' ? '{ }' : '[ ]';
        } else {
            input = document.createElement('input');
            input.type = 'text';
        }

        input.id = `field-${key}`;
        input.name = key;

        // Auto-fill from store or default
        if (hasAutoFill) {
            input.value = storeValue;
        } else if (prop.default !== undefined) {
            input.value = typeof prop.default === 'object' ? JSON.stringify(prop.default) : String(prop.default);
        }

        group.appendChild(input);

        if (prop.description) {
            const hint = document.createElement('span');
            hint.className = 'field-hint';
            hint.textContent = prop.description;
            group.appendChild(hint);
        }

        container.appendChild(group);
    }
}

// Close link dropdowns when clicking elsewhere
document.addEventListener('click', () => {
    document.querySelectorAll('.link-dropdown').forEach(d => d.classList.add('hidden'));
});

function promptArgsToSchema(args) {
    const properties = {};
    const required = [];
    for (const arg of args) {
        properties[arg.name] = {
            type: 'string',
            description: arg.description || '',
        };
        if (arg.required) required.push(arg.name);
    }
    return { properties, required };
}

function collectFormValues() {
    const form = document.getElementById('detail-form');
    const values = {};
    for (const el of form.querySelectorAll('input, select, textarea')) {
        if (!el.name) continue;
        const val = el.value.trim();
        if (val === '') continue;

        // Try to parse JSON for object/array fields
        if (el.tagName === 'TEXTAREA') {
            try { values[el.name] = JSON.parse(val); continue; } catch { /* use as string */ }
        }
        // Number fields
        if (el.type === 'number' && val !== '') {
            values[el.name] = Number(val);
            continue;
        }
        // Boolean selects
        if (val === 'true') { values[el.name] = true; continue; }
        if (val === 'false') { values[el.name] = false; continue; }

        values[el.name] = val;
    }
    return values;
}

// === Actions ===
async function callTool(item) {
    const args = collectFormValues();
    harvestParams(args);
    const btn = document.getElementById('detail-action');
    btn.disabled = true;
    btn.textContent = 'Calling...';
    try {
        const result = await api('POST', '/api/tools/call', { name: item.name, arguments: args });
        appState.result = result;
        harvestResultParams(result);
        renderResult();
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Call Tool';
    }
}

async function readResource(item) {
    const btn = document.getElementById('detail-action');
    btn.disabled = true;
    btn.textContent = 'Reading...';
    try {
        const result = await api('POST', '/api/resources/read', { uri: item.uri });
        appState.result = result;
        harvestResultParams(result);
        renderResult();
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Read Resource';
    }
}

async function getPrompt(item) {
    const args = collectFormValues();
    harvestParams(args);
    const btn = document.getElementById('detail-action');
    btn.disabled = true;
    btn.textContent = 'Getting...';
    try {
        const result = await api('POST', '/api/prompts/get', { name: item.name, arguments: args });
        appState.result = result;
        harvestResultParams(result);
        renderResult();
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Get Prompt';
    }
}

// === Result Display ===
function renderResult() {
    const resultEl = document.getElementById('detail-result');
    const outputEl = document.getElementById('result-output');

    if (!appState.result) {
        resultEl.classList.add('hidden');
        return;
    }

    resultEl.classList.remove('hidden');
    if (appState.resultRaw) {
        outputEl.textContent = JSON.stringify(appState.result);
    } else {
        outputEl.textContent = JSON.stringify(appState.result, null, 2);
    }
}

document.getElementById('result-toggle').addEventListener('click', () => {
    appState.resultRaw = !appState.resultRaw;
    document.getElementById('result-toggle').textContent = appState.resultRaw ? 'Formatted' : 'Raw';
    renderResult();
});

// === Utility ===
function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// === Parameter Store UI ===
function renderParamStorePanel() {
    const store = getParamStore();
    const entries = Object.entries(store);
    const countEl = document.getElementById('param-store-count');
    countEl.textContent = entries.length;

    const listEl = document.getElementById('param-store-list');
    listEl.innerHTML = '';

    if (entries.length === 0) {
        listEl.innerHTML = '<div class="param-store-empty">No parameters stored yet.<br>Parameters are captured from form submissions and tool results.</div>';
        return;
    }

    for (const [key, value] of entries) {
        const item = document.createElement('div');
        item.className = 'param-store-item';
        item.innerHTML = `
            <div>
                <div class="param-item-key">${esc(key)}</div>
                <div class="param-item-value" title="${esc(String(value))}">${esc(String(value))}</div>
            </div>
            <button class="param-item-remove" title="Remove">&times;</button>
        `;
        item.querySelector('.param-item-remove').addEventListener('click', () => {
            const s = getParamStore();
            delete s[key];
            saveParamStore(s);
            renderParamStorePanel();
        });
        listEl.appendChild(item);
    }
}

document.getElementById('param-store-toggle').addEventListener('click', () => {
    const panel = document.getElementById('param-store-panel');
    panel.classList.toggle('hidden');
    renderParamStorePanel();
});

document.getElementById('param-store-close').addEventListener('click', () => {
    document.getElementById('param-store-panel').classList.add('hidden');
});

document.getElementById('param-store-clear').addEventListener('click', () => {
    saveParamStore({});
    renderParamStorePanel();
    showToast('Parameter store cleared');
});

// === Init ===
document.getElementById('connect-btn').onclick = connect;
document.getElementById('auth-type').addEventListener('change', updateAuthFields);

document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
});

// Restore auth when URL is selected from history
document.getElementById('url-input').addEventListener('change', (e) => {
    restoreAuth(e.target.value);
});

// Init
updateAuthFields();
renderUrlDatalist();
updateConnectionUI();
renderParamStorePanel();

// Check if already connected (e.g., page reload)
(async function checkStatus() {
    try {
        const status = await api('GET', '/api/status');
        if (status.connected) {
            appState.connected = true;
            appState.serverInfo = status.server_info;
            updateConnectionUI();
            await loadAllData();
        }
    } catch { /* not connected */ }
})();
