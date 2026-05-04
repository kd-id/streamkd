// AI Settings - Provider & Auth + Model & Test
(function() {
  let aiConfig = { providers: [] };
  let currentProviderId = '';
  let currentModelList = [];
  let selectedModel = '';
  let selectedImageModel = '';
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
    openrouter: ['meta-llama/llama-3-8b-instruct','google/gemini-1.5-flash','openai/gpt-4o','anthropic/claude-3.5-sonnet'],
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

    const imgInput = document.getElementById('ai-image-model-input');
    if (imgInput) {
      imgInput.addEventListener('input', (e) => {
        selectedImageModel = e.target.value.trim();
        updateActiveImageModelDisplay();
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
      selectedImageModel = currentProv.imageModel || '';
      savedKeys = Array.isArray(currentProv.keys) ? [...currentProv.keys] : (currentProv.key ? [currentProv.key] : []);
      currentModelList = currentProv.models || defaultModels[currentProv.type] || [];
      const ep = document.getElementById('ai-endpoint-input');
      if (ep) ep.value = currentProv.endpoint || '';
      const imgModel = document.getElementById('ai-image-model-input');
      if (imgModel) imgModel.value = selectedImageModel;
    } else {
      selectedModel = '';
      selectedImageModel = '';
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

    // Image model
    const imgModelInput = document.getElementById('ai-image-model-input');
    if (imgModelInput) imgModelInput.value = selectedImageModel;
    updateActiveImageModelDisplay();

    // Toggle switch
    const activeToggle = document.getElementById('ai-provider-active-toggle');
    if (activeToggle) {
      activeToggle.checked = currentProv && currentProv.active === true;
    }
  }

  function updateActiveImageModelDisplay() {
    const status = document.getElementById('ai-active-image-model-status');
    const name = document.getElementById('ai-current-image-model-name');
    if (status && name) {
      if (selectedImageModel) {
        status.classList.remove('hidden');
        name.textContent = selectedImageModel;
      } else {
        status.classList.add('hidden');
      }
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

  // Keywords to detect image-capable models
  const IMAGE_MODEL_KEYWORDS = ['dall-e', 'imagen', 'flux', 'stable-diffusion', 'sdxl', 'sd-', 'sd3', 'midjourney', 'stability', 'kandinsky', 'playground', 'ideogram', 'recraft'];

  // Known image models to always show even if not in API list
  const KNOWN_IMAGE_MODELS = {
    openai: ['dall-e-3', 'dall-e-2'],
    gemini: ['imagen-3.0-generate-001'],
    openrouter: [
      'openai/dall-e-3', 
      'black-forest-labs/flux-1.1-pro', 
      'black-forest-labs/flux-schnell',
      'stabilityai/stable-diffusion-3-medium',
      'stabilityai/sdxl'
    ],
    custom: [],
    claude: [],
    groq: [],
    grok: []
  };

  function isImageModel(modelName) {
    return IMAGE_MODEL_KEYWORDS.some(kw => modelName.toLowerCase().includes(kw));
  }

  function renderModelList() {
    const list = document.getElementById('ai-model-list');
    const imageList = document.getElementById('ai-image-model-list');
    if (!list) return;

    if (currentModelList.length === 0) {
      list.innerHTML = '<p class="text-xs text-gray-600 text-center py-6">No models found. Try "Update List".</p>';
      if (imageList) imageList.innerHTML = '<p class="text-[9px] text-gray-600 text-center py-3">Click "Update List" above to detect image models</p>';
      return;
    }

    // Separate text vs image models
    const textModels = currentModelList.filter(m => !isImageModel(m));
    const detectedImageModels = currentModelList.filter(m => isImageModel(m));
    
    // Add known image models for this provider type that aren't already in the list
    const type = currentProviderId.includes('-') ? 'custom' : currentProviderId;
    const known = KNOWN_IMAGE_MODELS[type] || [];
    const allImageModels = [...new Set([...detectedImageModels, ...known])];

    // Render Text Models
    const showTextModels = textModels.length > 0 ? textModels : currentModelList;
    list.innerHTML = showTextModels.map(m => `
      <button type="button" onclick="selectAIModel('${m}')" 
        class="ai-model-opt w-full text-left px-3 py-2 rounded-md text-xs transition-all hover:bg-gray-700/50 ${m === selectedModel ? 'active bg-primary/20 text-primary font-bold' : 'text-gray-400'}" 
        data-model="${m}">
        ${m}
      </button>
    `).join('');

    // Render Image Models (clickable buttons)
    if (imageList) {
      if (allImageModels.length > 0) {
        imageList.innerHTML = allImageModels.map(m => `
          <button type="button" onclick="selectImageModel('${m}')" 
            class="ai-img-model-opt w-full text-left px-3 py-2 rounded-md text-[11px] transition-all hover:bg-orange-500/10 ${m === selectedImageModel ? 'bg-orange-500/20 text-orange-400 font-bold border border-orange-500/30' : 'text-gray-400 border border-transparent'}" 
            data-model="${m}">
            <i class="ti ti-photo text-[9px] mr-1"></i> ${m}
          </button>
        `).join('');
      } else {
        imageList.innerHTML = '<p class="text-[9px] text-gray-600 text-center py-3">No image models detected. Use the input below to set manually.</p>';
      }
    }
  }

  window.selectImageModel = function(model) {
    selectedImageModel = model;
    
    // Update button styles
    document.querySelectorAll('.ai-img-model-opt').forEach(opt => {
      const isActive = opt.dataset.model === model;
      opt.classList.toggle('bg-orange-500/20', isActive);
      opt.classList.toggle('text-orange-400', isActive);
      opt.classList.toggle('font-bold', isActive);
      opt.classList.toggle('border-orange-500/30', isActive);
      opt.classList.toggle('text-gray-400', !isActive);
      opt.classList.toggle('border-transparent', !isActive);
    });

    // Update manual input
    const imgInput = document.getElementById('ai-image-model-input');
    if (imgInput) imgInput.value = model;

    updateActiveImageModelDisplay();

    // Auto-save
    let p = (aiConfig.providers || []).find(x => (x.id || x.type) === currentProviderId);
    if (p) {
      p.imageModel = model;
      showToast('info', `Image model "${model}" selected. Auto-saving...`);
      window.saveAIConfiguration();
    }
  };

  window.selectImageModelManual = function() {
    const input = document.getElementById('ai-image-model-input');
    if (!input || !input.value.trim()) {
      showToast('warning', 'Please type an image model name first');
      return;
    }
    window.selectImageModel(input.value.trim());
  };

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
        if (p) p.models = d.models;

        // Count detected image models
        const imgCount = d.models.filter(m => isImageModel(m)).length;
        const type = p ? p.type : (currentProviderId.includes('-') ? 'custom' : currentProviderId);
        const knownCount = (KNOWN_IMAGE_MODELS[type] || []).length;
        const totalImg = imgCount + knownCount;

        renderModelList();
        showToast('success', `Found ${d.models.length} models (${totalImg} image). Auto-saving...`);
        
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
      p.imageModel = document.getElementById('ai-image-model-input')?.value.trim() || '';
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

    // Get current provider's type and use current UI state for testing
    const prov = (aiConfig.providers || []).find(p => (p.id || p.type) === currentProviderId);
    const type = prov ? prov.type : (currentProviderId.includes('-') ? 'custom' : currentProviderId);
    
    // Prioritize what is currently in the UI fields, fall back to saved config
    const endpoint = document.getElementById('ai-endpoint-input')?.value.trim() || prov?.endpoint || '';
    const model = selectedModel || prov?.model || (defaultModels[type] ? defaultModels[type][0] : '');
    const provName = prov?.name || providerMeta[type]?.name || type;

    const btn = document.getElementById('test-ai-connection-btn');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="ti ti-loader animate-spin"></i> Testing ${savedKeys.length} keys (${provName})...`;

    try {
      const r = await fetch('/api/ai/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ type, keys: savedKeys, model, endpoint })
      });
      const d = await r.json();

      // Show per-key results
      const resultPanel = document.getElementById('ai-test-results');
      if (resultPanel && d.results) {
        const successCount = d.results.filter(r => r.success).length;
        const allOk = successCount === savedKeys.length;
        const headerBg = allOk ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5';
        
        let html = `<div class="mt-3 rounded-lg border ${headerBg} overflow-hidden">`;
        html += `<div class="flex items-center justify-between px-3 py-2">
          <div class="flex items-center gap-2">
            <i class="ti ti-${providerMeta[type]?.icon || 'robot'} text-sm ${allOk ? 'text-green-400' : 'text-orange-400'}"></i>
            <span class="text-[11px] font-bold text-white">${provName}</span>
            ${endpoint ? `<code class="text-[8px] text-gray-600 font-mono">${endpoint.substring(0, 35)}</code>` : ''}
          </div>
          <span class="text-[9px] font-bold ${allOk ? 'text-green-400' : 'text-orange-400'}">${successCount}/${savedKeys.length} valid</span>
        </div>`;

        d.results.forEach(r => {
          const icon = r.success ? 'ti-check text-green-400' : 'ti-x text-red-400';
          html += `<div class="flex items-center justify-between px-3 py-1.5 border-t border-gray-800/50">
            <div class="flex items-center gap-2">
              <i class="ti ${icon} text-[10px]"></i>
              <code class="text-[9px] text-gray-500 font-mono">${r.keyHint}</code>
            </div>
            <span class="text-[8px] ${r.success ? 'text-green-500' : 'text-red-500'}">${r.success ? '✓ Valid' : (r.error || 'Failed').substring(0, 40)}</span>
          </div>`;
        });
        html += '</div>';
        resultPanel.innerHTML = html;
      }

      // Show rate limits
      const limitsPanel = document.getElementById('ai-rate-limits');
      if (limitsPanel) {
        if (d.rateLimits && (d.rateLimits.requestsRemaining !== null || d.rateLimits.tokensRemaining !== null)) {
          const rl = d.rateLimits;
          let html = `<div class="mt-3"><div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Rate Limits</div><div class="grid grid-cols-2 gap-2">`;
          if (rl.requestsRemaining !== null) {
            const pct = rl.requestsLimit ? Math.round((rl.requestsRemaining / rl.requestsLimit) * 100) : null;
            html += `<div class="bg-dark-700/50 rounded-lg p-3 border border-gray-700/30">
              <div class="text-[9px] text-gray-500 uppercase font-bold mb-1">Requests</div>
              <div class="text-sm font-black text-white">${rl.requestsRemaining}<span class="text-gray-600">/${rl.requestsLimit || '∞'}</span></div>
              ${pct !== null ? `<div class="w-full h-1 bg-dark-900 rounded-full mt-2"><div class="h-1 rounded-full ${pct > 30 ? 'bg-green-500' : pct > 10 ? 'bg-yellow-500' : 'bg-red-500'}" style="width:${pct}%"></div></div>` : ''}
            </div>`;
          }
          if (rl.tokensRemaining !== null) {
            const pct = rl.tokensLimit ? Math.round((rl.tokensRemaining / rl.tokensLimit) * 100) : null;
            html += `<div class="bg-dark-700/50 rounded-lg p-3 border border-gray-700/30">
              <div class="text-[9px] text-gray-500 uppercase font-bold mb-1">Tokens</div>
              <div class="text-sm font-black text-white">${Number(rl.tokensRemaining).toLocaleString()}<span class="text-gray-600">/${rl.tokensLimit ? Number(rl.tokensLimit).toLocaleString() : '∞'}</span></div>
              ${pct !== null ? `<div class="w-full h-1 bg-dark-900 rounded-full mt-2"><div class="h-1 rounded-full ${pct > 30 ? 'bg-green-500' : pct > 10 ? 'bg-yellow-500' : 'bg-red-500'}" style="width:${pct}%"></div></div>` : ''}
            </div>`;
          }
          html += '</div></div>';
          limitsPanel.innerHTML = html;
        } else {
          limitsPanel.innerHTML = `<div class="mt-3 px-3 py-2 bg-dark-900/50 rounded-lg border border-gray-700/20">
            <div class="text-[9px] text-gray-500 text-center"><i class="ti ti-info-circle"></i> ${provName} tidak mengirim rate limit headers</div>
            <div class="text-[8px] text-gray-600 text-center mt-1">Rate limit tersedia untuk: OpenAI, Claude, OpenRouter</div>
          </div>`;
        }
      }

      const ok = d.results?.some(r => r.success);
      showToast(ok ? 'success' : 'error', `${provName}: ${d.result}`);
    } catch (e) {
      showToast('error', `Network error testing ${provName}`);
    } finally {
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
