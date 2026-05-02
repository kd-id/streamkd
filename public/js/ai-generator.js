/**
 * AI Metadata Generator Logic for StreamFlow
 */

let aiVariations = [];
let aiCurrentContext = ''; // 'manual', 'youtube', 'edit-manual', 'edit-youtube'
let aiTargetField = 'all'; // 'all', 'title', 'description', 'tags'

async function openAIGenerator(context) {
    aiCurrentContext = context;
    
    // Check if keyword is provided (using the title as keyword if empty)
    let keywordInputId = '';
    let categoryInputId = '';
    
    if (context === 'manual') {
        keywordInputId = 'streamTitle';
    } else if (context === 'youtube') {
        keywordInputId = 'ytStreamTitle';
        categoryInputId = 'ytCategory';
    } else if (context === 'edit-manual') {
        keywordInputId = 'editStreamTitle';
    } else if (context === 'edit-youtube') {
        keywordInputId = 'editYtStreamTitle';
        categoryInputId = 'editYtCategory';
    }

    const keywordInput = document.getElementById(keywordInputId);
    let keyword = keywordInput ? keywordInput.value.trim() : '';
    
    // If keyword is empty, ask for one
    if (!keyword || keyword.length < 3) {
        const userInput = prompt('Please enter a keyword (2-5 words) to generate metadata:', '');
        if (!userInput || userInput.trim().length < 3) return;
        keyword = userInput.trim();
    }

    const categoryInput = categoryInputId ? document.getElementById(categoryInputId) : null;
    const category = categoryInput ? categoryInput.options[categoryInput.selectedIndex].text : '';

    showAILoading(true);
    
    try {
        const response = await fetch('/api/ai/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('input[name="_csrf"]')?.value || ''
            },
            body: JSON.stringify({ keyword, category })
        });
        
        const data = await response.json();
        
        if (data.success) {
            aiVariations = data.variations;
            showAIResults(aiVariations);
        } else {
            showToast('error', data.error || 'Failed to generate AI metadata');
        }
    } catch (error) {
        console.error('AI Generation Error:', error);
        showToast('error', 'An error occurred during AI generation');
    } finally {
        showAILoading(false);
    }
}

function showAILoading(show) {
    const modalId = 'ai-results-modal';
    let modal = document.getElementById(modalId);
    
    if (!modal) {
        createAIResultsModal();
        modal = document.getElementById(modalId);
    }

    if (show) {
        modal.classList.remove('hidden');
        document.getElementById('ai-results-content').innerHTML = `
            <div class="flex flex-col items-center justify-center py-12">
                <div class="relative w-20 h-20 mb-4">
                    <div class="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
                    <div class="absolute inset-4 rounded-full border-4 border-blue-400/20 border-b-blue-400 animate-spin-slow"></div>
                    <i class="ti ti-robot absolute inset-0 flex items-center justify-center text-3xl text-primary"></i>
                </div>
                <p class="text-white font-medium">Generating Metadata Variations...</p>
                <p class="text-gray-400 text-sm mt-1">Applying cozy & natural style</p>
            </div>
        `;
        document.getElementById('ai-modal-footer').classList.add('hidden');
    }
}

function showAIResults(variations) {
    if (!document.getElementById('ai-results-modal')) {
        createAIResultsModal();
    }
    
    const content = document.getElementById('ai-results-content');
    const footer = document.getElementById('ai-modal-footer');
    
    if (!variations || variations.length === 0) {
        content.innerHTML = '<p class="text-center py-8 text-gray-400">No results found.</p>';
        return;
    }

    content.innerHTML = `
        <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
            ${variations.map((v, i) => `
                <div class="bg-dark-900 rounded-xl border border-gray-700 overflow-hidden hover:border-primary transition-all cursor-pointer group" onclick="selectAIVariation(${i})">
                    <div class="bg-gray-700/50 px-4 py-2 flex items-center justify-between">
                        <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Option ${i + 1}</span>
                        <div class="flex items-center gap-2">
                            <button type="button" class="text-gray-400 hover:text-primary transition-colors" title="Preview" onclick="event.stopPropagation(); previewAIVariation(${i})">
                                <i class="ti ti-eye"></i>
                            </button>
                            <span class="w-5 h-5 rounded-full border-2 border-gray-600 flex items-center justify-center group-hover:border-primary transition-colors ai-radio-outer">
                                <span class="w-2.5 h-2.5 rounded-full bg-primary scale-0 group-hover:scale-100 transition-transform ai-radio-inner"></span>
                            </span>
                        </div>
                    </div>
                    <div class="p-4">
                        ${v.title ? `<h4 class="text-white font-semibold mb-1 truncate">${v.title}</h4>` : ''}
                        ${v.description ? `<p class="text-gray-400 text-xs line-clamp-2">${v.description}</p>` : ''}
                        ${v.tags ? `
                        <div class="mt-2 flex flex-wrap gap-1">
                            ${v.tags.split(',').slice(0, 3).map(tag => `<span class="px-2 py-0.5 bg-dark-700 text-gray-500 text-[10px] rounded">${tag.trim()}</span>`).join('')}
                            ${v.tags.split(',').length > 3 ? `<span class="text-[10px] text-gray-600 ml-1">+${v.tags.split(',').length - 3} more</span>` : ''}
                        </div>
                        ` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    footer.classList.remove('hidden');
    document.getElementById('ai-results-modal').classList.remove('hidden');
}

function createAIResultsModal() {
    const modal = document.createElement('div');
    modal.id = 'ai-results-modal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 hidden';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-scale-in border border-gray-700">
            <div class="px-6 py-4 border-b border-gray-700 flex items-center justify-between bg-gradient-to-r from-gray-800 to-dark-800">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                        <i class="ti ti-robot text-2xl"></i>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-white">AI Metadata Suggestions</h3>
                        <p class="text-xs text-gray-400">Choose the best variation for your stream</p>
                    </div>
                </div>
                <button onclick="closeAIResultsModal()" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-700 text-gray-400 hover:text-white transition-all">
                    <i class="ti ti-x text-xl"></i>
                </button>
            </div>
            <div class="p-6" id="ai-results-content">
                <!-- Content will be injected here -->
            </div>
            <div class="px-6 py-4 border-t border-gray-700 flex items-center justify-between bg-dark-800" id="ai-modal-footer">
                <button onclick="regenerateAI()" class="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm">
                    <i class="ti ti-refresh"></i>
                    <span>Generate More</span>
                </button>
                <div class="flex items-center gap-3">
                    <button onclick="closeAIResultsModal()" class="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm font-medium">Cancel</button>
                    <button id="apply-ai-btn" disabled class="px-6 py-2 bg-primary/50 text-white/50 rounded-lg transition-all text-sm font-bold flex items-center gap-2 cursor-not-allowed">
                        <i class="ti ti-check"></i>
                        <span>Apply Selected</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Add styles for animation
    const style = document.createElement('style');
    style.innerHTML = `
        .animate-scale-in { animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        .animate-spin-slow { animation: spin 3s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #374151; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4b5563; }
    `;
    document.head.appendChild(style);
}

function closeAIResultsModal() {
    document.getElementById('ai-results-modal').classList.add('hidden');
}

let selectedVariationIndex = -1;

function selectAIVariation(index) {
    selectedVariationIndex = index;
    
    // Update UI
    const options = document.querySelectorAll('#ai-results-content > div > div');
    options.forEach((opt, i) => {
        const radio = opt.querySelector('.ai-radio-inner');
        const container = opt.querySelector('.ai-radio-outer');
        if (i === index) {
            opt.classList.add('border-primary', 'bg-primary/5');
            opt.classList.remove('border-gray-700');
            radio.classList.remove('scale-0');
            radio.classList.add('scale-100');
            container.classList.add('border-primary');
            container.classList.remove('border-gray-600');
        } else {
            opt.classList.remove('border-primary', 'bg-primary/5');
            opt.classList.add('border-gray-700');
            radio.classList.add('scale-0');
            radio.classList.remove('scale-100');
            container.classList.remove('border-primary');
            container.classList.add('border-gray-600');
        }
    });

    // Enable Apply Button
    const applyBtn = document.getElementById('apply-ai-btn');
    applyBtn.disabled = false;
    applyBtn.classList.remove('bg-primary/50', 'text-white/50', 'cursor-not-allowed');
    applyBtn.classList.add('bg-primary', 'text-white', 'hover:bg-blue-600', 'shadow-lg', 'shadow-primary/20');
    applyBtn.onclick = () => applySelectedVariation();
}

function applySelectedVariation() {
    if (selectedVariationIndex === -1) return;
    const variation = aiVariations[selectedVariationIndex];
    
    const contextMap = {
        'manual': { title: 'streamTitle' },
        'youtube': { title: 'ytStreamTitle', desc: 'ytDescription', tags: { input: 'ytTagsInput', hidden: 'ytTags', container: 'ytTagsContainer', count: 'ytTagsCharCount' } },
        'edit-manual': { title: 'editStreamTitle' },
        'edit-youtube': { title: 'editYtStreamTitle', desc: 'editYtDescription', tags: { input: 'editYtTagsInput', hidden: 'editYtTags', container: 'editYtTagsContainer', count: 'editYtTagsCharCount' } }
    };

    const ids = contextMap[aiCurrentContext];
    if (!ids) return;

    if (aiTargetField === 'all' || aiTargetField === 'title') {
        if (ids.title) {
            const el = document.getElementById(ids.title);
            if (el) el.value = variation.title;
        }
    }
    
    if (aiTargetField === 'all' || aiTargetField === 'description') {
        if (ids.desc) {
            const el = document.getElementById(ids.desc);
            if (el) el.value = variation.description;
        }
    }
    
    if (aiTargetField === 'all' || aiTargetField === 'tags') {
        if (ids.tags) {
            setTags(ids.tags.input, ids.tags.hidden, ids.tags.container, ids.tags.count, variation.tags);
        }
    }

    showToast('success', `${aiTargetField === 'all' ? 'Metadata' : aiTargetField.charAt(0).toUpperCase() + aiTargetField.slice(1)} applied successfully!`);
    closeAIResultsModal();
}

/**
 * Generate All Metadata based on Theme
 */
async function generateAllAI(context) {
    aiCurrentContext = context;
    aiTargetField = 'all';
    
    const response = await fetch('/api/ai/config');
    const configData = await response.json();
    if (configData.success && configData.config) {
        const hasActiveWithKeys = (configData.config.providers || []).some(p => p.active && (p.key || (p.keys && p.keys.length > 0)));
        if (!hasActiveWithKeys) {
            showToast('error', 'No active AI provider with API keys found. Please enable/add keys in Settings > AI.');
            return;
        }
    }

    const themeInputId = context === 'youtube' ? 'ytAiTheme' : 'editYtAiTheme';
    const theme = document.getElementById(themeInputId)?.value.trim() || '';
    
    const categoryInputId = context === 'youtube' ? 'ytCategory' : 'editYtCategory';
    const categoryInput = document.getElementById(categoryInputId);
    const category = categoryInput ? categoryInput.options[categoryInput.selectedIndex].text : '';

    const btnId = context === 'youtube' ? 'yt-generate-all-btn' : 'edit-yt-generate-all-btn';
    const btn = document.getElementById(btnId);
    const originalBtn = btn ? btn.innerHTML : '';

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="ti ti-loader animate-spin"></i> Processing...';
    }

    try {
        const response = await fetch('/api/ai/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('input[name="_csrf"]')?.value || ''
            },
            body: JSON.stringify({ keyword: theme, category, isTheme: true })
        });
        
        const data = await response.json();
        if (data.success) {
            aiVariations = data.variations;
            showAIResults(aiVariations);
        } else {
            showToast('error', data.error || 'Failed to generate AI metadata');
        }
    } catch (error) {
        console.error('AI Generation Error:', error);
        showToast('error', 'An error occurred during AI generation');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtn;
        }
    }
}

/**
 * Generate AI for a specific field
 */
async function generateAIField(context, field) {
    aiCurrentContext = context;
    aiTargetField = field;

    const responseConfig = await fetch('/api/ai/config');
    const configData = await responseConfig.json();
    if (configData.success && configData.config) {
        const hasActiveWithKeys = (configData.config.providers || []).some(p => p.active && (p.key || (p.keys && p.keys.length > 0)));
        if (!hasActiveWithKeys) {
            showToast('error', 'No active AI provider with API keys found. Please enable/add keys in Settings > AI.');
            return;
        }
    }

    let keywordInputId = '';
    let categoryInputId = '';
    
    if (context === 'youtube') {
        keywordInputId = 'ytStreamTitle';
        categoryInputId = 'ytCategory';
    } else if (context === 'edit-youtube') {
        keywordInputId = 'editYtStreamTitle';
        categoryInputId = 'editYtCategory';
    }

    const keywordInput = document.getElementById(keywordInputId);
    let keyword = keywordInput ? keywordInput.value.trim() : '';
    
    if (!keyword || keyword.split(/\s+/).filter(w => w.length > 0).length < 2) {
        const userInput = prompt(`Masukkan minimal 2 kata untuk referensi generate ${field}:`, keyword);
        if (!userInput || userInput.trim().split(/\s+/).filter(w => w.length > 0).length < 2) {
            showToast('warning', 'Dibutuhkan minimal 2 kata untuk mulai generate AI.');
            return;
        }
        keyword = userInput.trim();
    }

    const categoryInput = categoryInputId ? document.getElementById(categoryInputId) : null;
    const category = categoryInput ? categoryInput.options[categoryInput.selectedIndex].text : '';

    showAILoading(true);
    
    try {
        const response = await fetch('/api/ai/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('input[name="_csrf"]')?.value || ''
            },
            body: JSON.stringify({ keyword, category, targetField: field })
        });
        
        const data = await response.json();
        if (data.success) {
            aiVariations = data.variations;
            showAIResults(aiVariations);
        } else {
            showToast('error', data.error || 'Failed to generate AI metadata');
        }
    } catch (error) {
        console.error('AI Generation Error:', error);
        showToast('error', 'An error occurred during AI generation');
    } finally {
        showAILoading(false);
    }
}

// Helper to set tags in the existing tag system
function setTags(inputId, hiddenId, containerId, countId, tagsString) {
    const tags = tagsString.split(',').map(t => t.trim()).filter(t => t);
    const hiddenInput = document.getElementById(hiddenId);
    hiddenInput.value = tags.join(',');
    
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    
    // Clear existing tags (except the input)
    const existingTags = container.querySelectorAll('.bg-primary\\/20');
    existingTags.forEach(t => t.remove());
    
    tags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'flex items-center gap-1.5 px-2 py-1 bg-primary/20 text-primary text-xs rounded font-medium group/tag';
        tagEl.innerHTML = `
            ${tag}
            <i class="ti ti-x cursor-pointer hover:text-white transition-colors" onclick="this.parentElement.remove(); updateTagsHiddenValue('${hiddenId}', '${containerId}', '${countId}')"></i>
        `;
        container.insertBefore(tagEl, input);
    });
    
    updateTagsHiddenValue(hiddenId, containerId, countId);
}

function updateTagsHiddenValue(hiddenId, containerId, countId) {
    const container = document.getElementById(containerId);
    const tags = Array.from(container.querySelectorAll('span')).map(span => span.textContent.trim());
    document.getElementById(hiddenId).value = tags.join(',');
    document.getElementById(countId).textContent = `${tags.join(',').length}/500`;
}

function regenerateAI() {
    openAIGenerator(aiCurrentContext);
}

window.previewAIVariation = (index) => {
    const v = aiVariations[index];
    const previewModal = document.createElement('div');
    previewModal.id = 'ai-preview-detail';
    previewModal.className = 'fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 animate-fade-in';
    previewModal.innerHTML = `
        <div class="bg-dark-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-700 overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                <h3 class="text-lg font-bold text-white">Full Preview</h3>
                <button onclick="this.closest('#ai-preview-detail').remove()" class="text-gray-400 hover:text-white">
                    <i class="ti ti-x text-xl"></i>
                </button>
            </div>
            <div class="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                ${v.title ? `
                <div>
                    <label class="text-xs font-bold text-primary uppercase tracking-widest mb-2 block">Title</label>
                    <p class="text-white text-lg font-semibold leading-snug">${v.title}</p>
                </div>
                ` : ''}
                ${v.description ? `
                <div>
                    <label class="text-xs font-bold text-primary uppercase tracking-widest mb-2 block">Description</label>
                    <div class="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed bg-gray-900/50 p-4 rounded-xl border border-gray-700/50">${v.description}</div>
                </div>
                ` : ''}
                ${v.tags ? `
                <div>
                    <label class="text-xs font-bold text-primary uppercase tracking-widest mb-2 block">Tags</label>
                    <div class="flex flex-wrap gap-2">
                        ${v.tags.split(',').map(tag => `<span class="px-2 py-1 bg-gray-700 text-gray-400 text-xs rounded-lg">${tag.trim()}</span>`).join('')}
                    </div>
                </div>
                ` : ''}
            </div>
            <div class="px-6 py-4 bg-dark-900 flex justify-end">
                <button onclick="this.closest('#ai-preview-detail').remove(); selectAIVariation(${index})" class="px-6 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg font-bold transition-all shadow-lg shadow-primary/20">
                    Select This One
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(previewModal);
};
