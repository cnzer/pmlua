(function() {
    'use strict';
    
    const EXTENSION_ID = 'conzer-pmlua';
    
    if (!Scratch.extensions.unsandboxed) {
        throw new Error('This extension must be run unsandboxed!');
    }
    
    const vm = Scratch.vm;
    
    const runningScripts = new Map();
    let scriptIdCounter = 0;
    
    const scripts = new Map();
    
    let tab = null;
    
    let rootElement = null;
    let scriptListElement = null;
    let editorContainer = null;
    let codeMirrorInstance = null;
    let currentScriptName = null;
    let statusElement = null;
    
    function loadCodeMirror() {
        return new Promise((resolve, reject) => {
            if (window.CodeMirror) {
                resolve();
                return;
            }
            
            const cssLink = document.createElement('link');
            cssLink.rel = 'stylesheet';
            cssLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css';
            document.head.appendChild(cssLink);
            
            const themeLink = document.createElement('link');
            themeLink.rel = 'stylesheet';
            themeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/monokai.min.css';
            document.head.appendChild(themeLink);
            
            const cmScript = document.createElement('script');
            cmScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js';
            cmScript.onload = () => {
                const luaScript = document.createElement('script');
                luaScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/lua/lua.min.js';
                luaScript.onload = () => resolve();
                luaScript.onerror = reject;
                document.head.appendChild(luaScript);
            };
            cmScript.onerror = reject;
            document.head.appendChild(cmScript);
        });
    }
    
    function createElement(type, properties = {}, parent) {
        const el = document.createElement(type);
        Object.entries(properties).forEach(([k, v]) => {
            if (k === 'innerHTML') {
                el.innerHTML = v;
            } else if (k === 'innerText') {
                el.innerText = v;
            } else if (k === 'style' && typeof v === 'object') {
                Object.assign(el.style, v);
            } else {
                el[k] = v;
            }
        });
        if (parent) parent.appendChild(el);
        return el;
    }
    
    function createTabUI() {
        const style = `
        .pmlua-root {
            display: flex;
            flex-direction: column;
            height: 100%;
            background: var(--ui-primary, #4c97ff);
            box-sizing: border-box;
        }
        .pmlua-toolbar {
            display: flex;
            gap: 0.375rem;
            align-items: center;
            flex-wrap: wrap;
            padding: 0.5rem 0.75rem;
            background: var(--ui-primary, #4c97ff);
            border-bottom: 1px solid rgba(0, 0, 0, 0.15);
        }
        .pmlua-toolbar button {
            border: 1px solid rgba(0, 0, 0, 0.15);
            background: white;
            color: #575e75;
            padding: 0.375rem 0.75rem;
            border-radius: 0.25rem;
            cursor: pointer;
            font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
            font-size: 0.75rem;
            font-weight: bold;
            height: 2rem;
            transition: background 0.2s ease;
        }
        .pmlua-toolbar button:hover {
            background: #f9f9f9;
        }
        .pmlua-toolbar button:active {
            background: #eee;
        }
        .pmlua-toolbar input {
            padding: 0.375rem 0.5rem;
            border-radius: 0.25rem;
            border: 1px solid rgba(0, 0, 0, 0.15);
            font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
            font-size: 0.75rem;
            height: 2rem;
            box-sizing: border-box;
            background: white;
            color: #575e75;
        }
        .pmlua-main {
            display: flex;
            flex: 1;
            min-height: 0;
            background: var(--ui-secondary, #e9f1fc);
        }
        .pmlua-sidebar {
            width: 220px;
            display: flex;
            flex-direction: column;
            background: white;
            border-right: 1px solid rgba(0, 0, 0, 0.15);
        }
        .pmlua-sidebar-header {
            padding: 0.5rem 0.75rem;
            background: white;
            color: #575e75;
            font-weight: bold;
            font-size: 0.875rem;
            font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
            border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        }
        .pmlua-script-list {
            flex: 1;
            overflow-y: auto;
            padding: 0.25rem 0;
        }
        .pmlua-script-item {
            padding: 0.5rem 0.75rem;
            margin: 0.125rem 0.375rem;
            cursor: pointer;
            border-radius: 0.25rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
            font-size: 0.8125rem;
            color: #575e75;
            transition: background 0.1s ease;
        }
        .pmlua-script-item:hover {
            background: #f0f0f0;
        }
        .pmlua-script-item.active {
            background: #4c97ff;
            color: white;
            font-weight: 600;
        }
        .pmlua-script-item.running {
            color: #0f9d58;
        }
        .pmlua-script-item.active.running {
            color: white;
        }
        .pmlua-editor-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0;
            padding: 0.5rem;
        }
        .pmlua-editor-container {
            flex: 1;
            border: 1px solid rgba(0, 0, 0, 0.15);
            border-radius: 0.25rem;
            overflow: hidden;
            background: #272822;
            position: relative;
        }
        .pmlua-editor-container .CodeMirror {
            height: 100%;
            width: 100%;
            font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
            font-size: 0.8125rem;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
        }
        .pmlua-editor-container .CodeMirror-scroll {
            padding-bottom: 30px;
        }
        .pmlua-status {
            padding: 0.375rem 0.5rem;
            font-size: 0.75rem;
            font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
            color: #575e75;
            opacity: 0.9;
        }
        `;
        
        createElement('style', { innerHTML: style }, document.head);
        
        rootElement = createElement('div', { className: 'pmlua-root' });
        tab.setDOM(rootElement);
        
        const toolbar = createElement('div', { className: 'pmlua-toolbar' }, rootElement);
        createElement('button', { innerText: 'New Script' }, toolbar).onclick = createNewScript;
        createElement('button', { innerText: 'Save' }, toolbar).onclick = saveCurrentScript;
        createElement('button', { innerText: 'Delete' }, toolbar).onclick = deleteCurrentScript;
        createElement('button', { innerText: 'Run' }, toolbar).onclick = runCurrentScript;
        createElement('button', { innerText: 'Stop' }, toolbar).onclick = stopCurrentScript;
        
        const nameInput = createElement('input', { type: 'text', placeholder: 'Script name', id: 'pmlua-script-name' }, toolbar);
        nameInput.onchange = () => {
            if (currentScriptName) {
                renameCurrentScript(nameInput.value);
            }
        };
        

        const mainArea = createElement('div', { className: 'pmlua-main' }, rootElement);
        
        const sidebar = createElement('div', { className: 'pmlua-sidebar' }, mainArea);
        createElement('div', { className: 'pmlua-sidebar-header', innerText: 'Scripts' }, sidebar);
        scriptListElement = createElement('div', { className: 'pmlua-script-list' }, sidebar);
        
        const editorArea = createElement('div', { className: 'pmlua-editor-area' }, mainArea);
        editorContainer = createElement('div', { className: 'pmlua-editor-container' }, editorArea);
        statusElement = createElement('div', { className: 'pmlua-status', innerText: 'Loading CodeMirror...' }, editorArea);
        
        loadCodeMirror().then(() => {
            codeMirrorInstance = CodeMirror(editorContainer, {
                value: '-- New Lua Script\n',
                mode: 'lua',
                theme: 'monokai',
                lineNumbers: true,
                indentUnit: 4,
                tabSize: 4,
                indentWithTabs: false,
                lineWrapping: true,
                autofocus: false
            });
            statusElement.innerText = 'Ready';
            updateScriptList();
        }).catch(err => {
            statusElement.innerText = 'Failed to load CodeMirror: ' + err.message;
            console.error(err);
        });
    }
    
    function updateScriptList() {
        scriptListElement.innerHTML = '';
        for (let [name, script] of scripts) {
            const item = createElement('div', { className: 'pmlua-script-item' }, scriptListElement);
            if (name === currentScriptName) {
                item.classList.add('active');
            }
            if (runningScripts.has(name)) {
                item.classList.add('running');
            }
            createElement('span', { innerText: name }, item);
            
            if (runningScripts.has(name)) {
                createElement('span', { innerText: '●', style: { color: '#0f0' } }, item);
            }
            
            item.onclick = () => {
                loadScript(name);
            };
        }
    }
    
    function createNewScript() {
        const name = prompt('Script name:', 'script' + (scripts.size + 1));
        if (!name || name.trim() === '') return;
        const trimmedName = name.trim();
        if (scripts.has(trimmedName)) {
            alert('Script already exists!');
            return;
        }
        scripts.set(trimmedName, { content: '-- New Lua Script\n', lastModified: Date.now() });
        loadScript(trimmedName);
        updateScriptList();
    }
    
    function loadScript(name) {
        currentScriptName = name;
        const script = scripts.get(name);
        if (script && codeMirrorInstance) {
            codeMirrorInstance.setValue(script.content);
        }
        const nameInput = document.getElementById('pmlua-script-name');
        if (nameInput) {
            nameInput.value = name;
        }
        updateScriptList();
        if (statusElement) {
            statusElement.innerText = `Loaded: ${name}`;
        }
    }
    
    function saveCurrentScript() {
        if (!currentScriptName) {
            alert('No script selected!');
            return;
        }
        if (codeMirrorInstance) {
            const content = codeMirrorInstance.getValue();
            scripts.set(currentScriptName, { content: content, lastModified: Date.now() });
            if (statusElement) {
                statusElement.innerText = `Saved: ${currentScriptName}`;
            }
            updateScriptList();
        }
    }
    
    function renameCurrentScript(newName) {
        if (!currentScriptName) return;
        const trimmedName = newName.trim();
        if (trimmedName === '') {
            alert('Invalid name!');
            return;
        }
        if (trimmedName === currentScriptName) return;
        if (scripts.has(trimmedName)) {
            alert('Script already exists!');
            const nameInput = document.getElementById('pmlua-script-name');
            if (nameInput) nameInput.value = currentScriptName;
            return;
        }
        const script = scripts.get(currentScriptName);
        scripts.delete(currentScriptName);
        scripts.set(trimmedName, script);
        currentScriptName = trimmedName;
        updateScriptList();
        if (statusElement) {
            statusElement.innerText = `Renamed to: ${trimmedName}`;
        }
    }
    
    function deleteCurrentScript() {
        if (!currentScriptName) {
            alert('No script selected!');
            return;
        }
        if (confirm(`Delete script "${currentScriptName}"?`)) {
            if (runningScripts.has(currentScriptName)) {
                stopScript(currentScriptName);
            }
            scripts.delete(currentScriptName);
            currentScriptName = null;
            if (codeMirrorInstance) {
                codeMirrorInstance.setValue('');
            }
            const nameInput = document.getElementById('pmlua-script-name');
            if (nameInput) nameInput.value = '';
            updateScriptList();
            if (statusElement) {
                statusElement.innerText = 'Script deleted';
            }
        }
    }
    
    function runScript(scriptName) {
        if (runningScripts.has(scriptName)) {
            console.log(`Script ${scriptName} is already running`);
            return false;
        }
        const script = scripts.get(scriptName);
        if (!script) {
            console.error(`Script ${scriptName} not found`);
            return false;
        }
        
        try {
            const scriptId = scriptIdCounter++;
            let content = script.content;
            
            content = content.replace(/--\[\[[\s\S]*?\]\]/g, '');
            content = content.replace(/--[^\n\r]*/g, '');
            
            const wrappedScript = `
                (function() {
                    var scratch = (function() {
                        var api = {};
                        return new Proxy(api, {
                            get: function(target, prop) {
                                if (prop === '__target__') return target;
                                if (prop === 'toString') return function() { return '[scratch]'; };
                                if (typeof prop === 'symbol') return undefined;
                                var targets = vm.runtime.targets;
                                for (var i = 0; i < targets.length; i++) {
                                    var targetObj = targets[i];
                                    if (targetObj.variables) {
                                        for (var varId in targetObj.variables) {
                                            var variable = targetObj.variables[varId];
                                            var varName = variable.name;
                                            var normalizedProp = String(prop).replace(/_/g, ' ').replace(/-/g, ' ');
                                            var normalizedVar = varName.replace(/_/g, ' ').replace(/-/g, ' ');
                                            if (normalizedProp.toLowerCase() === normalizedVar.toLowerCase()) {
                                                if (variable.value === undefined || variable.value === null) {
                                                    return 0;
                                                }
                                                return variable.value;
                                            }
                                        }
                                    }
                                }
                                return undefined;
                            },
                            set: function(target, prop, value) {
                                var targets = vm.runtime.targets;
                                for (var i = 0; i < targets.length; i++) {
                                    var targetObj = targets[i];
                                    if (targetObj.variables) {
                                        for (var varId in targetObj.variables) {
                                            var variable = targetObj.variables[varId];
                                            var varName = variable.name;
                                            var normalizedProp = String(prop).replace(/_/g, ' ').replace(/-/g, ' ');
                                            var normalizedVar = varName.replace(/_/g, ' ').replace(/-/g, ' ');
                                            if (normalizedProp.toLowerCase() === normalizedVar.toLowerCase()) {
                                                if (value === undefined) {
                                                    value = 0;
                                                }
                                                variable.value = value;
                                                if (vm.runtime.requestUpdateMonitor) {
                                                    vm.runtime.requestUpdateMonitor(varId);
                                                }
                                                if (vm.runtime.emit) {
                                                    vm.runtime.emit('MONITOR_UPDATE', {id: varId, value: value});
                                                }
                                                return true;
                                            }
                                        }
                                    }
                                }
                                console.warn('[pmlua] Cannot create variable "' + prop + '". Variables must exist in Scratch first.');
                                return false;
                            },
                            has: function(target, prop) {
                                var targets = vm.runtime.targets;
                                for (var i = 0; i < targets.length; i++) {
                                    var targetObj = targets[i];
                                    if (targetObj.variables) {
                                        for (var varId in targetObj.variables) {
                                            var variable = targetObj.variables[varId];
                                            var varName = variable.name;
                                            var normalizedProp = String(prop).replace(/_/g, ' ').replace(/-/g, ' ');
                                            var normalizedVar = varName.replace(/_/g, ' ').replace(/-/g, ' ');
                                            if (normalizedProp.toLowerCase() === normalizedVar.toLowerCase()) {
                                                return true;
                                            }
                                        }
                                    }
                                }
                                return false;
                            }
                        });
                    })();
                    var print = console.log.bind(console);
                    var math = Math;
                    var string = String;
                    var table = {};
                    var assert = function(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); };
                    var type = function(v) { return typeof v; };
                    var tonumber = Number;
                    var tostring = String;
                    try {
                        ${content}
                    } catch(e) {
                        console.error('[pmlua] Error in script "${scriptName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}":', e);
                        throw e;
                    }
                })();
            `;
            
            eval(wrappedScript);
            
            runningScripts.set(scriptName, {
                id: scriptId,
                startTime: Date.now()
            });
            
            updateScriptList();
            if (statusElement && currentScriptName === scriptName) {
                statusElement.innerText = `Running: ${scriptName}`;
            }
            console.log(`[pmlua] Started script: ${scriptName}`);
            return true;
        } catch (e) {
            console.error(`[pmlua] Failed to run script ${scriptName}:`, e);
            alert(`Error running script: ${e.message}`);
            return false;
        }
    }
    
    function createScratchAPI() {
        const api = {};
        return new Proxy(api, {
            get(target, prop) {
                if (prop === '__target__') return target;
                if (prop === 'toString') return function() { return '[scratch]'; };
                if (typeof prop === 'symbol') return undefined;
                const targets = vm.runtime.targets;
                for (let i = 0; i < targets.length; i++) {
                    const target = targets[i];
                    if (target.variables) {
                        for (let varId in target.variables) {
                            const variable = target.variables[varId];
                            const varName = variable.name;
                            const normalizedProp = String(prop).replace(/_/g, ' ').replace(/-/g, ' ');
                            const normalizedVar = varName.replace(/_/g, ' ').replace(/-/g, ' ');
                            if (normalizedProp.toLowerCase() === normalizedVar.toLowerCase()) {
                                if (variable.value === undefined || variable.value === null) {
                                    return 0;
                                }
                                return variable.value;
                            }
                        }
                    }
                }
                return undefined;
            },
            set(target, prop, value) {
                const targets = vm.runtime.targets;
                for (let i = 0; i < targets.length; i++) {
                    const target = targets[i];
                    if (target.variables) {
                        for (let varId in target.variables) {
                            const variable = target.variables[varId];
                            const varName = variable.name;
                            const normalizedProp = String(prop).replace(/_/g, ' ').replace(/-/g, ' ');
                            const normalizedVar = varName.replace(/_/g, ' ').replace(/-/g, ' ');
                            if (normalizedProp.toLowerCase() === normalizedVar.toLowerCase()) {
                                if (value === undefined) {
                                    value = 0;
                                }
                                variable.value = value;
                                if (vm.runtime.requestUpdateMonitor) {
                                    vm.runtime.requestUpdateMonitor(varId);
                                }
                                if (vm.runtime.emit) {
                                    vm.runtime.emit('MONITOR_UPDATE', {id: varId, value: value});
                                }
                                return true;
                            }
                        }
                    }
                }
                console.warn(`[pmlua] Cannot create variable "${prop}". Variables must exist in Scratch first.`);
                return false;
            },
            has(target, prop) {
                const targets = vm.runtime.targets;
                for (let i = 0; i < targets.length; i++) {
                    const target = targets[i];
                    if (target.variables) {
                        for (let varId in target.variables) {
                            const variable = target.variables[varId];
                            const varName = variable.name;
                            const normalizedProp = String(prop).replace(/_/g, ' ').replace(/-/g, ' ');
                            const normalizedVar = varName.replace(/_/g, ' ').replace(/-/g, ' ');
                            if (normalizedProp.toLowerCase() === normalizedVar.toLowerCase()) {
                                return true;
                            }
                        }
                    }
                }
                return false;
            }
        });
    }
    
    function stopScript(scriptName) {
        if (!runningScripts.has(scriptName)) {
            console.log(`Script ${scriptName} is not running`);
            return false;
        }
        
        runningScripts.delete(scriptName);
        updateScriptList();
        if (statusElement && currentScriptName === scriptName) {
            statusElement.innerText = `Stopped: ${scriptName}`;
        }
        console.log(`[pmlua] Stopped script: ${scriptName}`);
        return true;
    }
    
    function runCurrentScript() {
        if (!currentScriptName) {
            alert('No script selected!');
            return;
        }
        saveCurrentScript();
        runScript(currentScriptName);
    }
    
    function stopCurrentScript() {
        if (!currentScriptName) {
            alert('No script selected!');
            return;
        }
        stopScript(currentScriptName);
    }
    
    class PmLuaExtension {
        constructor() {
            if (vm.runtime.tabManager) {
                tab = vm.runtime.tabManager.register(EXTENSION_ID, 'lua-scripts', 'Lua Scripts', 
                    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PHJlY3QgeD0iMiIgeT0iMiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0iIzAwMDA4MCIvPjx0ZXh0IHg9IjEwIiB5PSIxMyIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjYiIGZpbGw9IiNmZmYiIHRleH0tYW5jaG9yPSJtaWRkbGUiPkxVQTwvdGV4dD48L3N2Zz4='
                );
                createTabUI();
            }
            
            if (scripts.size === 0) {
                scripts.set('hello', { 
                    content: '-- Hello World Lua Script\nprint("Hello from Lua Script!")\n', 
                    lastModified: Date.now() 
                });
                scripts.set('variables', { 
                    content: '-- Scratch Variable Example\n-- Create a variable in Scratch first (e.g. "my variable")\n-- Access with scratch.variable_name or scratch["my variable"]\n-- scratch.my_variable = 10\n-- print(scratch.my_variable)\n', 
                    lastModified: Date.now() 
                });
            }
        }
        
        getInfo() {
            return {
                id: EXTENSION_ID,
                name: 'Lua',
                color1: '#000080',
                color2: '#000066',
                color3: '#00004d',
                blocks: [
                    {
                        opcode: 'runScript',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'run script [NAME]',
                        arguments: {
                            NAME: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'hello'
                            }
                        }
                    },
                    {
                        opcode: 'stopScript',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'stop script [NAME]',
                        arguments: {
                            NAME: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'hello'
                            }
                        }
                    },
                    '---',
                    {
                        opcode: 'isScriptRunning',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'script [NAME] running?',
                        arguments: {
                            NAME: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'hello'
                            }
                        }
                    }
                ]
            };
        }
        
        runScript(args) {
            const scriptName = args.NAME;
            runScript(scriptName);
        }
        
        stopScript(args) {
            const scriptName = args.NAME;
            stopScript(scriptName);
        }
        
        isScriptRunning(args) {
            const scriptName = args.NAME;
            return runningScripts.has(scriptName);
        }
    }
    
    Scratch.extensions.register(new PmLuaExtension());
})();