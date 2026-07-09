document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const chatHistoryEl = document.getElementById('chatHistory');
    const errorEl = document.getElementById('error');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    
    // Sidebar elements
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const sidebarHistoryEl = document.getElementById('sidebarHistory');

    // State
    let messages = []; // Used for LLM context
    let displayMessages = []; // Used for re-rendering UI (includes chartConfigs)
    let currentSessionId = null;
    let currentChatId = null;

    // Load saved chats from localStorage
    let savedChats = JSON.parse(localStorage.getItem('savedChats') || '{}');

    function saveCurrentChat() {
        if (!currentChatId) {
            currentChatId = 'chat-' + Date.now();
        }
        
        let title = "New Chat";
        const firstUserMsg = displayMessages.find(m => m.role === 'user');
        if (firstUserMsg) {
            title = firstUserMsg.content.substring(0, 30);
            if (firstUserMsg.content.length > 30) title += "...";
        }

        savedChats[currentChatId] = {
            id: currentChatId,
            title: title,
            messages: messages,
            displayMessages: displayMessages,
            sessionId: currentSessionId,
            timestamp: Date.now()
        };
        
        localStorage.setItem('savedChats', JSON.stringify(savedChats));
        renderSidebar();
    }

    function loadChat(chatId) {
        if (savedChats[chatId]) {
            currentChatId = chatId;
            messages = [...savedChats[chatId].messages];
            displayMessages = [...savedChats[chatId].displayMessages];
            currentSessionId = savedChats[chatId].sessionId;
            
            chatHistoryEl.innerHTML = '';
            
            // Re-render greeting
            const greetingDiv = document.createElement('div');
            greetingDiv.className = 'message bot';
            greetingDiv.innerHTML = '<div class="bubble markdown-content">Hello! I\'m your AI data visualization assistant. Please provide some data and ask me to create a chart!</div>';
            chatHistoryEl.appendChild(greetingDiv);

            // Re-render UI
            displayMessages.forEach(msg => {
                if (msg.role === 'user') {
                    appendMessageUI('user', msg.content);
                } else if (msg.role === 'assistant') {
                    // Fallback for old saved chats that used chartConfig instead of chartConfigs array
                    const configs = msg.chartConfigs || (msg.chartConfig ? [msg.chartConfig] : null);
                    appendBotResponseUI(msg.content, configs);
                }
            });

            renderSidebar();
            scrollToBottom();
            
            if (window.innerWidth < 768) {
                sidebar.classList.add('collapsed');
            }
        }
    }

    function startNewChat() {
        currentChatId = null;
        messages = [];
        displayMessages = [];
        currentSessionId = null;
        
        chatHistoryEl.innerHTML = '';
        const greetingDiv = document.createElement('div');
        greetingDiv.className = 'message bot';
        greetingDiv.innerHTML = '<div class="bubble markdown-content">Hello! I\'m your AI data visualization assistant. Please provide some data and ask me to create a chart!</div>';
        chatHistoryEl.appendChild(greetingDiv);
        
        renderSidebar();
    }

    function renderSidebar() {
        sidebarHistoryEl.innerHTML = '';
        const sortedChats = Object.values(savedChats).sort((a, b) => b.timestamp - a.timestamp);
        
        sortedChats.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'history-item';
            if (chat.id === currentChatId) item.classList.add('active');
            item.textContent = chat.title;
            
            item.addEventListener('click', () => {
                loadChat(chat.id);
            });
            
            sidebarHistoryEl.appendChild(item);
        });
    }

    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    newChatBtn.addEventListener('click', () => {
        startNewChat();
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value.trim() === '') {
            sendBtn.disabled = true;
        } else {
            sendBtn.disabled = false;
        }
    });

    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) {
                sendMessage();
            }
        }
    });

    sendBtn.addEventListener('click', sendMessage);

    uploadBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        fileInput.value = '';

        const formData = new FormData();
        formData.append('file', file);

        const uploadMsg = `[Uploaded file: ${file.name}]`;
        messages.push({ role: 'user', content: uploadMsg });
        displayMessages.push({ role: 'user', content: uploadMsg });
        appendMessageUI('user', uploadMsg);
        
        saveCurrentChat();

        const typingId = 'typing-' + Date.now();
        appendTypingIndicator(typingId);

        try {
            const response = await fetch('http://localhost:8000/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            removeElement(typingId);

            if (!response.ok) {
                throw new Error(data.detail || 'Upload failed');
            }

            currentSessionId = data.session_id;
            const rowCount = data.schema.row_count;
            const columns = Object.keys(data.schema.columns).join(', ');

            const botMsg = `Successfully loaded **${file.name}** (${rowCount} rows).\nDetected columns: \`${columns}\`\n\nWhat would you like to visualize? Provide a prompt and I will automatically generate a beautiful dashboard!`;
            
            messages.push({ role: 'assistant', content: botMsg });
            displayMessages.push({ role: 'assistant', content: botMsg, chartConfigs: null });
            
            appendBotResponseUI(botMsg, null);
            saveCurrentChat();

        } catch (error) {
            console.error(error);
            removeElement(typingId);
            showError("Failed to upload file: " + error.message);
        }
    });

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.disabled = true;
        errorEl.classList.add('hidden');

        messages.push({ role: 'user', content: text });
        displayMessages.push({ role: 'user', content: text });
        appendMessageUI('user', text);
        saveCurrentChat();

        const typingId = 'typing-' + Date.now();
        appendTypingIndicator(typingId);

        try {
            const response = await fetch('http://localhost:8000/generate-chart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    messages: messages,
                    session_id: currentSessionId
                })
            });

            const responseData = await response.json();
            removeElement(typingId);

            if (!response.ok) {
                throw new Error(responseData.detail || "Failed to get response from server.");
            }

            let botMessage = responseData.message || "";
            const chartConfigs = responseData.chartConfigs || [];

            if (botMessage.includes("Error executing SQL") || botMessage.includes("Catalog Error: Table with name temp_data/")) {
                botMessage += "\n\n*(Note: It looks like the data file for this session is missing, possibly because the server restarted. Please re-upload your dataset!)*";
            }

            messages.push({ role: 'assistant', content: botMessage });
            displayMessages.push({ role: 'assistant', content: botMessage, chartConfigs: chartConfigs });

            appendBotResponseUI(botMessage, chartConfigs.length > 0 ? chartConfigs : null);
            saveCurrentChat();

        } catch (error) {
            console.error("Chat error:", error);
            removeElement(typingId);
            showError(error.message || "An unexpected error occurred.");
        }
    }

    function appendMessageUI(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;
        
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        
        if (role === 'user') {
            bubble.textContent = text;
        } else {
            bubble.innerHTML = window.marked ? marked.parse(text) : text;
        }
        
        msgDiv.appendChild(bubble);
        chatHistoryEl.appendChild(msgDiv);
        scrollToBottom();
    }

    function appendBotResponseUI(text, chartConfigs) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message bot';
        
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        
        if (text) {
            const textNode = document.createElement('div');
            textNode.className = 'markdown-content';
            textNode.innerHTML = window.marked ? marked.parse(text) : text;
            bubble.appendChild(textNode);
        }

        if (chartConfigs && Array.isArray(chartConfigs)) {
            // Loop through all generated charts
            chartConfigs.forEach(config => {
                const chartWrapper = document.createElement('div');
                chartWrapper.className = 'chart-wrapper';
                
                const canvas = document.createElement('canvas');
                const canvasId = 'chart-' + Math.random().toString(36).substr(2, 9);
                canvas.id = canvasId;
                
                chartWrapper.appendChild(canvas);
                bubble.appendChild(chartWrapper);
                
                try {
                    // Render chart
                    setTimeout(() => {
                        new Chart(document.getElementById(canvasId), config);
                    }, 50);
                } catch (err) {
                    console.error("Failed to render chart:", err);
                    const errDiv = document.createElement('div');
                    errDiv.style.color = 'red';
                    errDiv.textContent = 'Error rendering chart.';
                    bubble.appendChild(errDiv);
                }
            });
        }
        
        msgDiv.appendChild(bubble);
        chatHistoryEl.appendChild(msgDiv);
        scrollToBottom();
    }

    function appendTypingIndicator(id) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message bot';
        msgDiv.id = id;
        
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.innerHTML = '<span></span><span></span>';
        
        bubble.appendChild(indicator);
        msgDiv.appendChild(bubble);
        chatHistoryEl.appendChild(msgDiv);
        scrollToBottom();
    }

    function removeElement(id) {
        const el = document.getElementById(id);
        if (el) {
            el.remove();
        }
    }

    function scrollToBottom() {
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    }

    function showError(message) {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        setTimeout(() => {
            errorEl.classList.add('hidden');
        }, 5000);
    }

    // Initialize UI
    renderSidebar();
});
