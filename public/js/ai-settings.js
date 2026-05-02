// AI Settings - Provider & Auth + Model & Test
(function() {
  let aiConfig = { providers: [] };
  let currentProviderId = '';
  let currentModelList = [];
  let selectedModel = '';
  let savedKeys = [];
  let csrfToken = '';
  let configLoaded = false;

  const providerMeta = {
    gemini:     { icon: 'brand-google',  name: 'Google Gemini' },
    openai:     { icon: 'brand-openai',  name: 'OpenAI' },
    claude:     { icon: 'letter-c',      name: 'Anthropic Claude' },
    grok:       { icon: 'letter-x',      name: 'xAI Grok' },
    groq:       { icon: 'bolt',          name: 'Groq' },
    openrouter: { icon: 'route',         name: 'OpenRouter' }
  };

  const defaultModels = {
    gemini:     ['gemini-1.5-flash','gemini-1.5-pro','gemini-2.0-flash-exp','gemini-2.0-flash-lite-preview-02-05'],
    openai:     ['gpt-4o','gpt-4-turbo','gpt-3.5-turbo'],
    claude:     ['claude-3-5-sonnet-20240620','claude-3-opus-20240229','claude-3-haiku-20240307'],
    grok:       ['grok-2-latest','grok-2-mini-latest','grok-beta'],
    groq:       ['llama3-70b-8192','llama3-8b-8192','mixtral-8x7b-32768'],
    openrouter: ['google/gemini-flash-1.5','openai/gpt-4o','anthropic/claude-3.5-sonnet','meta-llama/llama-3-70b-instruct'],
    custom:     []
  };

  function init() {
    csrfToken = window._aiCsrf || '';

    // Listen for tab click
    const aiTab = document.querySelector('.settings-tab[data-tab="ai"]');
    if (aiTab) {
      aiTab.addEventListener('click', () => {
        loadAIConfig();
      });
    }

    if (window.location.hash === '#ai') {
      loadAIConfig();
    }

    window.addEventListener('hashchange', () => {
      if (window.location.hash === '#ai') {
        loadAIConfig();
      }
    });
  }

  async function loadAIConfig() {
    try {
      const r = await fetch('/api/ai/config');
      const d = await r.json();
      if (d.success && d.config) {
        aiConfig = d.config;
        
        // On first load, select first active provider or first available
        if (!configLoaded) {
          const firstActive = (aiConfig.providers || []).find(x => x.active);
          if (firstActive) {
            currentProviderId = firstActive.id || firstActive.type;
          } else if ((aiConfig.providers || []).length > 0) {
            currentProviderId = aiConfig.providers[0].id || aiConfig.providers[0].type;
          } else {
            // Default to Gemini if empty
            currentProviderId = 'gemini';
          }
          configLoaded = true;
        }
        
        loadProviderDetails();
      }
    } catch (e) { console.error('[AI Settings] Load error:', e); }
    
    refreshUI();
  }

  function loadProviderDetails() {
    const currentProv = (aiConfig.providers || []).find(p => (p.id || p.type) === currentProviderId);
    if (currentProv) {
      selectedModel = currentProv.model || '';
      savedKeys = Array.isArray(currentProv.keys) ? [...currentProv.keys] : (currentProv.key ? [currentProv.key] : []);
      currentModelList = currentProv.models || defaultModels[currentProv.type] || [];
      const ep = document.getElementById('ai-endpoint-input');
      if (ep) ep.value = currentProv.endpoint || '';
    } else {
      selectedModel = '';
      savedKeys = [];
      const type = currentProviderId.includes('-') ? 'custom' : currentProviderId;
      currentModelList = defaultModels[type] || [];
    }
  }

  function refreshUI() {
    renderProviderGrid();

    const currentProv = (aiConfig.providers || []).find(p => (p.id || p.type) === currentProviderId);
    const type = currentProv ? currentProv.type : (currentProviderId.includes('-') ? 'custom' : currentProviderId);
    
    // Badge
    const meta = providerMeta[type] || providerMeta.custom;
    const badgeIcon = document.getElementById('ai-badge-icon');
    const badgeName = document.getElementById('ai-badge-name');
    if (badgeIcon) badgeIcon.className = `ti ti-${meta.icon} text-primary text-lg`;
    if (badgeName) badgeName.textContent = currentProv?.name || meta.name;

    // Delete button - show only for custom providers (or any provider with a custom ID)
    const delBtn = document.getElementById('delete-ai-provider-btn');
    if (delBtn) delBtn.classList.toggle('hidden', !currentProv || !currentProv.id || !currentProv.id.includes('-'));

    // Endpoint - show for custom, openrouter, and all dynamic providers (IDs containing '-')
    const epSection = document.getElementById('ai-endpoint-section');
    const isDynamic = currentProviderId.includes('-');
    const needsEndpoint = type === 'custom' || type === 'openrouter' || isDynamic;
    if (epSection) epSection.classList.toggle('hidden', !needsEndpoint);

    // Keys
    renderSavedKeys();

    // Models
    renderModelList();

    // Active model
    const activeEl = document.getElementById('ai-active-model-name');
    if (activeEl) activeEl.textContent = selectedModel || 'Not selected';

    // Toggle switch
    const activeToggle = document.getElementById('ai-provider-active-toggle');
    if (activeToggle) {
      activeToggle.checked = currentProv && currentProv.active === true;
    }
  }

  function renderProviderGrid() {
    const grid = document.getElementById('ai-provider-grid');
    if (!grid) return;

    let html = '';
    
    // Standard providers (ensure they exist in config or show as options)
    const standardTypes = ['gemini', 'openai', 'claude', 'groq', 'grok', 'openrouter'];
    
    standardTypes.forEach(type => {
      const p = (aiConfig.providers || []).find(x => x.type === type && (!x.id || !x.id.includes('-')));
      const meta = providerMeta[type];
      const isActive = p && p.active === true;
      const isSelected = currentProviderId === type;
      
      html += `
        <button type="button" onclick="window.selectAIProvider('${type}')" 
          class="ai-prov-btn relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all ${isSelected ? 'active bg-primary/5 border-primary' : 'border-transparent bg-dark-900 hover:border-gray-700'}" 
          data-provider="${type}">
          <div class="active-indicator ${isActive ? '' : 'hidden'} absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
          <i class="ti ti-${meta.icon} text-xl ${isSelected ? 'text-primary' : ''}"></i>
          <span class="text-[10px] font-medium">${meta.name.split(' ').pop()}</span>
        </button>
      `;
    });

    // Custom providers from config
    (aiConfig.providers || []).filter(p => p.id && p.id.includes('-')).forEach(p => {
      const type = p.type || 'openai';
      const meta = providerMeta[type] || { icon: 'api', name: 'Custom' };
      const isSelected = currentProviderId === p.id;
      const isActive = p.active === true;
      
      html += `
        <button type="button" onclick="window.selectAIProvider('${p.id}')" 
          class="ai-prov-btn relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all ${isSelected ? 'active bg-primary/5 border-primary' : 'border-transparent bg-dark-900 hover:border-gray-700'}" 
          data-provider="${p.id}">
          <div class="active-indicator ${isActive ? '' : 'hidden'} absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
          <i class="ti ti-${meta.icon} text-xl ${isSelected ? 'text-primary' : ''}"></i>
          <span class="text-[10px] font-medium truncate w-full px-1">${p.name || 'Custom'}</span>
        </button>
      `;
    });

    // Add Custom Button
    html += `
      <button type="button" onclick="window.addNewAIProvider()" 
        class="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 border-dashed border-gray-700 bg-transparent hover:border-primary/50 hover:bg-primary/5 transition-all text-gray-500 hover:text-primary">
        <i class="ti ti-plus text-xl"></i>
        <span class="text-[10px] font-medium">Add New</span>
      </button>
    `;

    grid.innerHTML = html;
  }

  window.selectAIProvider = function(id) {
    currentProviderId = id;
    loadProviderDetails();
    refreshUI();
  };

  window.addNewAIProvider = function() {
    const protocolChoice = prompt('Choose protocol for New Provider:\n1. OpenAI Compatible (LocalAI, Ollama, vLLM, etc.)\n2. Anthropic Compatible\n\nEnter 1 or 2:', '1');
    if (!protocolChoice) return;
    
    const type = protocolChoice === '2' ? 'claude' : 'openai';
    const name = prompt(`Enter a name for this ${type === 'claude' ? 'Anthropic' : 'OpenAI'} provider:`, 'My Custom AI');
    if (!name) return;

    const newId = 'custom-' + Date.now();
    const newProv = {
      id: newId,
      type: type,
      name: name,
      active: false,
      keys: [],
      model: '',
      endpoint: ''
    };

    if (!aiConfig.providers) aiConfig.providers = [];
    aiConfig.providers.push(newProv);
    
    currentProviderId = newId;
    loadProviderDetails();
    refreshUI();
    showToast('info', 'New provider added. Please configure endpoint and keys, then save.');
  };

  window.deleteCurrentAIProvider = function() {
    if (!currentProviderId.includes('-')) {
      showToast('error', 'Cannot delete standard providers.');
      return;
    }

    if (!confirm('Are you sure you want to delete this provider?')) return;

    const idx = aiConfig.providers.findIndex(p => p.id === currentProviderId);
    if (idx !== -1) {
      aiConfig.providers.splice(idx, 1);
      currentProviderId = 'gemini';
      loadProviderDetails();
      refreshUI();
      showToast('warning', 'Provider removed from list. Save configuration to persist.');
    }
  };

  window.toggleProviderActive = function(isActive) {
    let p = (aiConfig.providers || []).find(x => (x.id || x.type) === currentProviderId);
    if (!p) {
      // Create if doesn't exist (for standard ones not yet in DB)
      p = {
        id: currentProviderId.includes('-') ? currentProviderId : undefined,
        type: currentProviderId.includes('-') ? 'custom' : currentProviderId,
        active: isActive,
        keys: [],
        model: selectedModel
      };
      if (!aiConfig.providers) aiConfig.providers = [];
      aiConfig.providers.push(p);
    }
    p.active = isActive;
    refreshUI();
  };

  window.addAISavedKey = function() {
    const input = document.getElementById('ai-new-key-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    // Support multiple keys at once
    const newKeys = val.split(/[\n,\s]+/).map(k => k.trim()).filter(k => k);
    savedKeys = [...savedKeys, ...newKeys];
    input.value = '';
    renderSavedKeys();
  };

  window.removeAISavedKey = function(idx) {
    savedKeys.splice(idx, 1);
    renderSavedKeys();
  };

  function renderSavedKeys() {
    const list = document.getElementById('ai-saved-keys-list');
    const count = document.getElementById('ai-keys-count');
    if (count) count.textContent = savedKeys.length;
    if (!list) return;

    if (savedKeys.length === 0) {
      list.innerHTML = '<p class="text-xs text-gray-600 text-center py-3">No keys saved yet</p>';
      return;
    }

    list.innerHTML = savedKeys.map((k, i) => `
      <div class="flex items-center justify-between bg-dark-700/50 rounded-lg px-3 py-2 border border-gray-700/30 group">
        <code class="text-[10px] text-gray-400 font-mono">${k.substring(0, 8)}...${k.substring(k.length - 4)}</code>
        <button type="button" onclick="removeAISavedKey(${i})" class="text-gray-600 hover:text-red-500 transition-colors">
          <i class="ti ti-trash text-xs"></i>
        </button>
      </div>
    `).join('');
  }

  window.selectAIModel = function(model) {
    selectedModel = model;
    const activeEl = document.getElementById('ai-active-model-name');
    if (activeEl) activeEl.textContent = model;
    
    document.querySelectorAll('.ai-model-opt').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.model === model);
    });

    // Update the model in the config and auto-save
    let p = (aiConfig.providers || []).find(x => (x.id || x.type) === currentProviderId);
    if (p) {
      p.model = model;
      showToast('info', `Model ${model} selected. Auto-saving...`);
      window.saveAIConfiguration();
    }
  };

  function renderModelList() {
    const list = document.getElementById('ai-model-list');
    if (!list) return;

    if (currentModelList.length === 0) {
      list.innerHTML = '<p class="text-xs text-gray-600 text-center py-6">No models found. Try "Update List".</p>';
      return;
    }

    list.innerHTML = currentModelList.map(m => `
      <button type="button" onclick="selectAIModel('${m}')" 
        class="ai-model-opt w-full text-left px-3 py-2 rounded-md text-xs transition-all hover:bg-gray-700/50 ${m === selectedModel ? 'active bg-primary/20 text-primary font-bold' : 'text-gray-400'}" 
        data-model="${m}">
        ${m}
      </button>
    `).join('');
  }

  window.filterAIModels = function() {
    const q = document.getElementById('ai-model-search')?.value.toLowerCase() || '';
    document.querySelectorAll('.ai-model-opt').forEach(opt => {
      const show = opt.dataset.model.toLowerCase().includes(q);
      opt.classList.toggle('hidden', !show);
    });
  };

  window.updateAIModelList = async function() {
    if (savedKeys.length === 0) {
      showToast('warning', 'Please add at least one API key first.');
      return;
    }

    const btn = document.getElementById('update-model-btn');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader animate-spin"></i> Updating...';

    try {
      const p = (aiConfig.providers || []).find(x => (x.id || x.type) === currentProviderId);
      const type = p ? p.type : (currentProviderId.includes('-') ? 'openai' : currentProviderId);
      const endpoint = document.getElementById('ai-endpoint-input')?.value.trim();
      
      const r = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ type, key: savedKeys[0], endpoint })
      });
      const d = await r.json();
      if (d.success && d.models) {
        currentModelList = d.models;
        if (p) p.models = d.models; // Update the list in config
        renderModelList();
        showToast('success', `Found ${d.models.length} models. Auto-saving...`);
        
        // Automatically save the configuration
        await window.saveAIConfiguration();
      } else {
        showToast('error', d.error || 'Failed to fetch models');
      }
    } catch (e) { showToast('error', 'Network error while fetching models'); }
    finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  };

  window.saveAIConfiguration = async function() {
    const btn = document.getElementById('save-ai-config-btn');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader animate-spin"></i> Saving...';

    try {
      // Update the current provider object in aiConfig.providers before saving
      let p = (aiConfig.providers || []).find(x => (x.id || x.type) === currentProviderId);
      if (!p) {
        p = {
          id: currentProviderId.includes('-') ? currentProviderId : undefined,
          type: currentProviderId.includes('-') ? 'custom' : currentProviderId,
          name: document.getElementById('ai-badge-name')?.textContent || 'Custom AI'
        };
        if (!aiConfig.providers) aiConfig.providers = [];
        aiConfig.providers.push(p);
      }
      
      p.active = document.getElementById('ai-provider-active-toggle')?.checked || false;
      p.keys = [...savedKeys];
      p.key = savedKeys[0] || '';
      p.model = selectedModel;
      p.models = [...currentModelList];
      
      const isDynamic = p.id && p.id.includes('-');
      const needsEndpoint = p.type === 'custom' || p.type === 'openrouter' || isDynamic;
      if (needsEndpoint) {
        p.endpoint = document.getElementById('ai-endpoint-input')?.value.trim();
      }

      const r = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ config: aiConfig })
      });
      const d = await r.json();
      if (d.success) {
        showToast('success', 'AI configuration saved successfully');
      } else {
        showToast('error', d.error || 'Failed to save configuration');
      }
    } catch (e) { showToast('error', 'Network error while saving'); }
    finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  };

  window.testAIConnection = async function() {
    if (savedKeys.length === 0) {
      showToast('warning', 'Please add an API key first');
      return;
    }

    const btn = document.getElementById('test-ai-connection-btn');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader animate-spin"></i> Testing...';

    try {
      const type = currentProviderId.includes('-') ? 'custom' : currentProviderId;
      const endpoint = document.getElementById('ai-endpoint-input')?.value.trim();
      
      const r = await fetch('/api/ai/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ 
          type, 
          key: savedKeys[0], 
          model: selectedModel || (defaultModels[type] ? defaultModels[type][0] : ''),
          endpoint
        })
      });
      const d = await r.json();
      if (d.success) {
        showToast('success', 'Connection successful: ' + d.result);
      } else {
        showToast('error', 'Connection failed: ' + d.error);
      }
    } catch (e) { showToast('error', 'Network error during test'); }
    finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  };

  window.toggleKeyVisibility = function(id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    const icon = btn.querySelector('i');
    if (el.type === 'password') {
      el.type = 'text';
      icon.className = 'ti ti-eye-off text-sm';
    } else {
      el.type = 'password';
      icon.className = 'ti ti-eye text-sm';
    }
  };

  // Initial load
  init();
})();
