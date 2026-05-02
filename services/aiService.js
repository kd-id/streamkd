const axios = require('axios');
const AppSettings = require('../models/AppSettings');

class AIService {
    /**
     * Get the AI configuration from AppSettings
     */
    static async getConfig() {
        const configJson = await AppSettings.get('ai_config');
        if (!configJson) return null;
        try {
            return JSON.parse(configJson);
        } catch (e) {
            console.error('Error parsing AI config:', e);
            return null;
        }
    }

    /**
     * Save AI configuration
     */
    static async saveConfig(config) {
        await AppSettings.set('ai_config', JSON.stringify(config));
    }

    /**
     * Get the next API key using round-robin.
     * Normalizes: if keys array is empty but key string exists, use key string.
     */
    static getNextKey(keys, lastIndex = -1) {
        if (!keys || keys.length === 0) return { key: null, index: -1 };
        const nextIndex = (lastIndex + 1) % keys.length;
        return { key: keys[nextIndex], index: nextIndex };
    }

    /**
     * Normalize provider keys: ensure keys array is populated from key string if needed
     */
    static normalizeProviderKeys(provider) {
        if (!provider.keys || provider.keys.length === 0) {
            if (provider.key) {
                provider.keys = [provider.key];
            } else {
                provider.keys = [];
            }
        }
    }

    /**
     * Intelligently join base URL and path
     */
    static joinUrl(base, path) {
        if (!base) return null;
        let url = base.endsWith('/') ? base.slice(0, -1) : base;
        
        // Prevent duplicate segments like /v1/v1 or /models/models
        const pathSegments = path.split('/').filter(s => s);
        const urlSegments = url.split('/').filter(s => s);
        
        if (pathSegments.length > 0 && urlSegments.length > 0) {
            if (urlSegments[urlSegments.length - 1].toLowerCase() === pathSegments[0].toLowerCase()) {
                path = '/' + pathSegments.slice(1).join('/');
            }
        }

        if (!url.toLowerCase().endsWith(path.toLowerCase()) && path !== '/') {
            url += path;
        }
        return url;
    }

    /**
     * Generate metadata using the configured AI provider (with failover)
     */
    static async generateMetadata(keyword, category = '', options = {}) {
        const config = await this.getConfig();
        if (!config || !config.providers) {
            throw new Error('AI configuration not found. Please configure AI in Settings > AI Integration.');
        }

        // Normalize all provider keys
        config.providers.forEach(p => this.normalizeProviderKeys(p));

        // Only consider providers that are both active AND have keys
        const activeProviders = config.providers.filter(p => p.active && p.keys.length > 0);

        console.log('[AIService] Active providers with keys:', activeProviders.map(p => `${p.type}(keys:${p.keys.length})`));

        if (activeProviders.length === 0) {
            throw new Error('No active AI provider with API keys found. Please enable a provider and add keys in Settings > AI Integration.');
        }

        const prompt = this.buildPrompt(keyword, category, options);

        // Try each provider in rotation order, with failover
        const lastProviderIndex = config.lastProviderIndex || 0;
        const errors = [];

        for (let attempt = 0; attempt < activeProviders.length; attempt++) {
            const providerIndex = (lastProviderIndex + attempt) % activeProviders.length;
            const activeProvider = options.providerId
                ? config.providers.find(p => p.id === options.providerId)
                : activeProviders[providerIndex];

            if (!activeProvider) continue;

            console.log(`[AIService] Attempt ${attempt + 1}/${activeProviders.length}: ${activeProvider.type} | model: ${activeProvider.model} | keys: ${activeProvider.keys.length}`);

            // Increment rotation index for the NEXT request (regardless of success/fail to ensure rotation)
            config.lastProviderIndex = (providerIndex + 1) % activeProviders.length;
            await this.saveConfig(config);

            try {
                let result;
                switch (activeProvider.type) {
                    case 'gemini':
                        result = await this.callGemini(activeProvider, prompt, config);
                        break;
                    case 'openai':
                        result = await this.callOpenAI(activeProvider, prompt, config);
                        break;
                    case 'claude':
                        result = await this.callClaude(activeProvider, prompt, config);
                        break;
                    case 'grok':
                        result = await this.callGrok(activeProvider, prompt, config);
                        break;
                    case 'groq':
                        result = await this.callGroq(activeProvider, prompt, config);
                        break;
                    case 'openrouter':
                        result = await this.callOpenRouter(activeProvider, prompt, config);
                        break;
                    case 'custom':
                        result = await this.callCustom(activeProvider, prompt, config);
                        break;
                    default:
                        throw new Error(`Unsupported AI provider: ${activeProvider.type}`);
                }
                
                if (result && result.length > 0) {
                    return result;
                }
                throw new Error('Provider returned no valid variations');
            } catch (error) {
                console.error(`[AIService] Provider ${activeProvider.type} failed:`, error.message);
                errors.push(`${activeProvider.type}: ${error.message}`);
                
                if (options.providerId) throw error;
                console.log(`[AIService] Failing over to next provider...`);
            }
        }

        // All providers failed
        throw new Error(`All AI providers failed:\n${errors.join('\n')}`);
    }

    /**
     * Build the prompt based on user requirements
     */
    static buildPrompt(keyword, category, options = {}) {
        const isTheme = options.isTheme || false;
        const targetField = options.targetField || 'all';

        let inputLine = `Input keyword (2–5 kata): ${keyword}`;
        if (isTheme) {
            inputLine = `Input Theme/Vibe: ${keyword}`;
        }

        let taskFocus = '';
        if (targetField === 'title') taskFocus = 'Fokuskan pada pembuatan JUDUL yang menarik.';
        else if (targetField === 'description') taskFocus = 'Fokuskan pada pembuatan DESKRIPSI yang mengalir dan natural.';
        else if (targetField === 'tags') taskFocus = 'Fokuskan pada pembuatan TAG yang relevan dan bervariasi.';
        else taskFocus = 'Buat metadata yang lengkap.';

        let expectedOutput = [];
        if (targetField === 'title' || targetField === 'all') {
            expectedOutput.push(`=== JUDUL ===
- 1 kalimat
- Maksimal 70 karakter
- Pola Wajib: Hook (emosi/kejadian) + twist / rasa penasaran + sedikit personal/umum
- Natural, tidak kaku, tidak terlalu SEO
- Terasa seperti tulisan manusia`);
        }
        if (targetField === 'description' || targetField === 'all') {
            expectedOutput.push(`=== DESKRIPSI ===
- Berisi judul + category
- Mengalir seperti orang menjelaskan
- Pola Wajib: Cerita singkat + refleksi/emosi + ajakan interaksi
- Boleh sedikit opini / pengalaman
- Tidak terlalu rapi atau terlalu “sempurna”
- Hindari kalimat klise dan terlalu marketing`);
        }
        if (targetField === 'tags' || targetField === 'all') {
            expectedOutput.push(`=== TAG ===
- Maksimal 15 tag
- Relevan dengan keyword + judul + category
- Variasi (tidak hanya mengulang keyword)
- Format dipisahkan koma saja (jangan tambahkan simbol markdown seperti --- atau ###)`);
        }

        let formatStructure = '';
        if (targetField === 'title') formatStructure = '=== JUDUL ===';
        else if (targetField === 'description') formatStructure = '=== DESKRIPSI ===';
        else if (targetField === 'tags') formatStructure = '=== TAG ===';
        else formatStructure = '=== JUDUL ===, === DESKRIPSI ===, dan === TAG ===';

        return `Kamu adalah penulis konten yang berpengalaman.

${inputLine}
${category ? `Kategori: ${category}` : ''}

Tugas kamu:
Kembangkan input tersebut menjadi metadata YouTube yang premium. ${taskFocus}

${expectedOutput.join('\n\n')}

Aturan penting:
- Gunakan Bahasa Inggris untuk semua output (Judul, Deskripsi, Tag)
- Jangan terdengar seperti AI (human-like voice)
- Jangan gunakan kalimat template umum
- Gunakan bahasa santai dan realistis
- Variasikan struktur kalimat
- Gunakan tone dan format seperti contoh di bawah:

Contoh Gaya Deskripsi:
"Can you stay awake listening to this? 🔥

This is a real cozy fireplace ASMR with a perfect seamless loop — no talking, no distractions… just pure relaxing fire sounds.

If you’re feeling stressed, can’t sleep, or just need something calming in the background, this might be exactly what you need tonight.

Close your eyes, put on your headphones 🎧, and let the crackling wood do its thing…

A lot of people say they fall asleep within minutes — curious if it works for you too 😴

✨ Perfect for:
• Sleep & insomnia relief  
• Relaxing after a long day  
• Studying or focusing  
• Creating a cozy night vibe  

No camera movement. No sudden changes. Just a smooth infinite loop you can keep on for hours.

Let me know in the comments… did you make it to the end? 🔁🔥

#asmr #fireplace #sleep #relaxing #cozyvibes"

PENTING: Berikan 5 variasi hasil yang berbeda. Format setiap variasi dimulai dengan "VARIASI [nomor]" dan ikuti struktur ${formatStructure} untuk setiap variasi.`;
    }

    /**
     * Call Gemini API
     */
    static async callGemini(provider, prompt, config) {
        const { key, index } = this.getNextKey(provider.keys, provider.lastUsedIndex || -1);
        if (!key) throw new Error('No API key found for Gemini');
        provider.lastUsedIndex = index;
        await this.saveConfig(config);

        // Standardize model name: ensure it has the 'models/' prefix and use v1 (stable)
        let modelName = provider.model || 'gemini-1.5-flash';

        // Ensure prefix 'models/' is present for the URL path
        const modelPath = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
        
        // Use v1beta for maximum compatibility with all models
        const url = provider.endpoint 
            ? this.joinUrl(provider.endpoint, `/${modelPath}:generateContent?key=${key}`)
            : `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${key}`;
        
        try {
            const response = await axios.post(url, {
                contents: [{ parts: [{ text: prompt }] }]
            });

            if (!response.data || !response.data.candidates || response.data.candidates.length === 0) {
                console.error('[AIService] Gemini returned no candidates:', response.data);
                throw new Error('Gemini returned no results. This might be due to safety filters.');
            }

            const candidate = response.data.candidates[0];
            if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
                // Check for safety ratings if blocked
                if (candidate.finishReason === 'SAFETY') {
                    throw new Error('Gemini blocked the response due to safety filters. Try a different prompt.');
                }
                throw new Error('Gemini returned an empty response.');
            }

            const text = candidate.content.parts[0].text;
            return this.parseResponse(text);
        } catch (error) {
            // Log full error for debugging but return clean message
            const errorData = error.response?.data;
            console.error('Gemini API Error details:', JSON.stringify(errorData, null, 2));
            
            let message = error.message;
            if (errorData && errorData.error) {
                message = errorData.error.message || message;
            }
            throw new Error(`Gemini API Error: ${message}`);
        }
    }

    /**
     * Call OpenAI API
     */
    static async callOpenAI(provider, prompt, config) {
        const { key, index } = this.getNextKey(provider.keys, provider.lastUsedIndex || -1);
        if (!key) throw new Error('No API key found for OpenAI');
        provider.lastUsedIndex = index;
        await this.saveConfig(config);

        const url = provider.endpoint 
            ? this.joinUrl(provider.endpoint, '/chat/completions')
            : 'https://api.openai.com/v1/chat/completions';
        try {
            const response = await axios.post(url, {
                model: provider.model || 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }]
            }, {
                headers: { 'Authorization': `Bearer ${key}` }
            });

            const text = response.data.choices[0].message.content;
            return this.parseResponse(text);
        } catch (error) {
            console.error('OpenAI API Error:', error.response?.data || error.message);
            throw new Error(`OpenAI API Error: ${error.message}`);
        }
    }

    /**
     * Call Claude API
     */
    static async callClaude(provider, prompt, config) {
        const { key, index } = this.getNextKey(provider.keys, provider.lastUsedIndex || -1);
        if (!key) throw new Error('No API key found for Claude');
        provider.lastUsedIndex = index;
        await this.saveConfig(config);

        const url = provider.endpoint 
            ? this.joinUrl(provider.endpoint, '/v1/messages')
            : 'https://api.anthropic.com/v1/messages';
        try {
            const response = await axios.post(url, {
                model: provider.model || 'claude-3-haiku-20240307',
                max_tokens: 1024,
                messages: [{ role: 'user', content: prompt }]
            }, {
                headers: { 
                    'x-api-key': key,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                }
            });

            const text = response.data.content[0].text;
            return this.parseResponse(text);
        } catch (error) {
            console.error('Claude API Error:', error.response?.data || error.message);
            throw new Error(`Claude API Error: ${error.message}`);
        }
    }

    /**
     * Call Groq API
     */
    static async callGroq(provider, prompt, config) {
        const { key, index } = this.getNextKey(provider.keys, provider.lastUsedIndex || -1);
        if (!key) throw new Error('No API key found for Groq');
        provider.lastUsedIndex = index;
        await this.saveConfig(config);

        const url = provider.endpoint 
            ? this.joinUrl(provider.endpoint, '/chat/completions')
            : 'https://api.groq.com/openai/v1/chat/completions';
        try {
            const response = await axios.post(url, {
                model: provider.model || 'llama3-8b-8192',
                messages: [{ role: 'user', content: prompt }]
            }, {
                headers: { 'Authorization': `Bearer ${key}` }
            });

            const text = response.data.choices[0].message.content;
            return this.parseResponse(text);
        } catch (error) {
            console.error('Groq API Error:', error.response?.data || error.message);
            throw new Error(`Groq API Error: ${error.message}`);
        }
    }

    /**
     * Call Custom API (Generic OpenAI-compatible)
     */
    static async callCustom(provider, prompt, config) {
        if (!provider.endpoint) throw new Error('Custom provider requires an endpoint URL');
        
        const { key, index } = this.getNextKey(provider.keys, provider.lastUsedIndex || -1);
        if (!key) throw new Error('No API key found for Custom provider');
        provider.lastUsedIndex = index;
        await this.saveConfig(config);

        const url = this.joinUrl(provider.endpoint, '/chat/completions');
        try {
            const response = await axios.post(url, {
                model: provider.model || 'default',
                messages: [{ role: 'user', content: prompt }]
            }, {
                headers: { 'Authorization': `Bearer ${key}` }
            });

            const text = response.data.choices[0].message.content;
            return this.parseResponse(text);
        } catch (error) {
            console.error('Custom AI API Error:', error.response?.data || error.message);
            throw new Error(`Custom AI API Error: ${error.message}`);
        }
    }

    /**
     * Call xAI Grok API
     */
    static async callGrok(provider, prompt, config) {
        const { key, index } = this.getNextKey(provider.keys, provider.lastUsedIndex || -1);
        if (!key) throw new Error('No API key found for Grok');
        provider.lastUsedIndex = index;
        await this.saveConfig(config);

        const url = provider.endpoint 
            ? this.joinUrl(provider.endpoint, '/chat/completions')
            : 'https://api.x.ai/v1/chat/completions';
        try {
            const response = await axios.post(url, {
                model: provider.model || 'grok-2-latest',
                messages: [{ role: 'user', content: prompt }]
            }, {
                headers: { 'Authorization': `Bearer ${key}` }
            });

            const text = response.data.choices[0].message.content;
            return this.parseResponse(text);
        } catch (error) {
            console.error('Grok API Error:', error.response?.data || error.message);
            throw new Error(`Grok API Error: ${error.message}`);
        }
    }

    /**
     * Call OpenRouter API
     */
    static async callOpenRouter(provider, prompt, config) {
        const { key, index } = this.getNextKey(provider.keys, provider.lastUsedIndex || -1);
        if (!key) throw new Error('No API key found for OpenRouter');
        provider.lastUsedIndex = index;
        await this.saveConfig(config);

        const url = provider.endpoint 
            ? this.joinUrl(provider.endpoint, '/chat/completions')
            : 'https://openrouter.ai/api/v1/chat/completions';
        try {
            // Ensure Referer header is NOT sent to avoid image loading issues
            const headers = { 
                'Authorization': `Bearer ${key}`,
                'HTTP-Referer': 'https://streamflow.app',
                'X-Title': 'StreamFlow'
            };

            const response = await axios.post(url, {
                model: provider.model || 'google/gemini-flash-1.5',
                messages: [{ role: 'user', content: prompt }]
            }, { headers });

            if (!response.data || !response.data.choices || response.data.choices.length === 0) {
                console.error('[AIService] OpenRouter returned no choices:', response.data);
                throw new Error('OpenRouter returned no results.');
            }

            const text = response.data.choices[0].message.content;
            return this.parseResponse(text);
        } catch (error) {
            const errorMsg = error.response?.data?.error?.message || error.message;
            console.error('OpenRouter API Error:', error.response?.data || error.message);
            throw new Error(`OpenRouter API Error: ${errorMsg}`);
        }
    }
    
    /**
            });

            const text = response.data.choices[0].message.content;
            return this.parseResponse(text);
        } catch (error) {
            console.error('Custom AI API Error:', error.response?.data || error.message);
            throw new Error(`Custom AI API Error: ${error.message}`);
        }
    }


    /**
     * Parse the AI response into variations
     */
    static parseResponse(text) {
        if (!text) return [];
        
        console.log('[AIService] Parsing AI response (length: ' + text.length + ')');
        
        const variations = [];
        
        // Split by VARIASI [nomor] or similar markers, ignoring markdown symbols like **
        // Regex looks for "VARIASI" preceded by optional non-word chars and followed by digits
        const variationBlocks = text.split(/[\*\-\s]*VARIASI\s*\d+[:\s]*/i).filter(b => b.trim().length > 0);
        
        console.log('[AIService] Found ' + variationBlocks.length + ' variation blocks');

        variationBlocks.forEach((block, idx) => {
            // More lenient regex for titles, descriptions, and tags
            // Supports: === JUDUL ===, **=== JUDUL ===**, JUDUL:, ### JUDUL, etc.
            const titleMatch = block.match(/(?:={3,}|#{1,6}|\*\*)\s*JUDUL\s*(?:={3,}|#{1,6}|\*\*|:)?\s*\n?([\s\S]*?)(?=\n\s*(?:={3,}|#{1,6}|\*\*)\s*(?:DESKRIPSI|TAG)|$)/i);
            const descMatch = block.match(/(?:={3,}|#{1,6}|\*\*)\s*DESKRIPSI\s*(?:={3,}|#{1,6}|\*\*|:)?\s*\n?([\s\S]*?)(?=\n\s*(?:={3,}|#{1,6}|\*\*)\s*(?:TAG|JUDUL)|$)/i);
            const tagMatch = block.match(/(?:={3,}|#{1,6}|\*\*)\s*TAG\s*(?:={3,}|#{1,6}|\*\*|:)?\s*\n?([\s\S]*?)(?=\n\s*(?:={3,}|#{1,6}|\*\*)\s*(?:JUDUL|DESKRIPSI)|$)/i);

            let title = titleMatch ? titleMatch[1].trim() : '';
            let description = descMatch ? descMatch[1].trim() : '';
            let tagsParsed = tagMatch ? tagMatch[1].trim() : '';

            // Clean up tags
            if (tagsParsed) {
                // Remove markdown artifacts, newlines, and bullet points
                tagsParsed = tagsParsed
                    .replace(/---|###|\*\*|\*|#|`|- /g, '')
                    .replace(/\n/g, ' ')
                    .replace(/,\s*,/g, ',')
                    .replace(/\s+/g, ' ')
                    .trim();
            }

            if (title || description || tagsParsed) {
                variations.push({ title, description, tags: tagsParsed });
            }
        });

        // Fallback for single variation without "VARIASI" marker
        if (variations.length === 0) {
            console.log('[AIService] No variations found with split, trying direct match');
            const titleMatch = text.match(/(?:={3,}|#{1,6}|\*\*)\s*JUDUL\s*(?:={3,}|#{1,6}|\*\*|:)?\s*\n?([\s\S]*?)(?=\n\s*(?:={3,}|#{1,6}|\*\*)\s*(?:DESKRIPSI|TAG)|$)/i);
            const descMatch = text.match(/(?:={3,}|#{1,6}|\*\*)\s*DESKRIPSI\s*(?:={3,}|#{1,6}|\*\*|:)?\s*\n?([\s\S]*?)(?=\n\s*(?:={3,}|#{1,6}|\*\*)\s*(?:TAG|JUDUL)|$)/i);
            const tagMatch = text.match(/(?:={3,}|#{1,6}|\*\*)\s*TAG\s*(?:={3,}|#{1,6}|\*\*|:)?\s*\n?([\s\S]*?)(?=\n\s*(?:={3,}|#{1,6}|\*\*)\s*(?:JUDUL|DESKRIPSI)|$)/i);

            let tagsParsed = tagMatch ? tagMatch[1].trim() : '';
            if (tagsParsed) {
                tagsParsed = tagsParsed.replace(/---|###|\*\*|\*|#|`|- /g, '').replace(/\n/g, ' ').replace(/,\s*,/g, ',').trim();
            }

            if (titleMatch || descMatch || tagMatch) {
                variations.push({
                    title: titleMatch ? titleMatch[1].trim() : '',
                    description: descMatch ? descMatch[1].trim() : '',
                    tags: tagsParsed
                });
            }
        }

        console.log('[AIService] Parsing complete. Variations found:', variations.length);
        return variations.slice(0, 5);
    }

    /**
     * Fetch available models for a provider
     */
    static async fetchModels(type, key, endpoint = null) {
        try {
            switch (type) {
                case 'gemini':
                    const geminiUrl = endpoint || `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
                    const geminiRes = await axios.get(geminiUrl);
                    return geminiRes.data.models
                        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                        .map(m => m.name.replace('models/', ''));
                
                case 'openai':
                case 'groq':
                case 'grok':
                case 'openrouter':
                case 'custom':
                    let base = '';
                    if (type === 'openai') base = 'https://api.openai.com/v1';
                    else if (type === 'groq') base = 'https://api.groq.com/openai/v1';
                    else if (type === 'grok') base = 'https://api.x.ai/v1';
                    else if (type === 'openrouter') base = 'https://openrouter.ai/api/v1';
                    else if (type === 'custom') base = endpoint;
                    
                    const url = this.joinUrl(endpoint || base, '/models');
                    if (!url) return [];
                    
                    const res = await axios.get(url, {
                        headers: { 'Authorization': `Bearer ${key}` }
                    });
                    if (res.data && res.data.data) {
                        return res.data.data.map(m => m.id);
                    }
                    return [];

                case 'claude':
                    const anthropicUrl = this.joinUrl(endpoint || 'https://api.anthropic.com', '/v1/models');
                    try {
                        const anthropicRes = await axios.get(anthropicUrl, {
                            headers: { 
                                'x-api-key': key,
                                'anthropic-version': '2023-06-01'
                            }
                        });
                        if (anthropicRes.data && anthropicRes.data.data) {
                            return anthropicRes.data.data.map(m => m.id);
                        }
                        return ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'];
                    } catch (e) {
                        return ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'];
                    }

                default:
                    return [];
            }
        } catch (error) {
            console.error(`Error fetching models for ${type}:`, error.message);
            return [];
        }
    }
}

module.exports = AIService;
