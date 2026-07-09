document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const chatHistory = document.getElementById('chatHistory');
    const errorEl = document.getElementById('error');

    // Store conversation history for the LLM
    let messages = [];

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

    // Handle Enter key (Shift+Enter for new line)
    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) {
                sendMessage();
            }
        }
    });

    sendBtn.addEventListener('click', sendMessage);

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        // Reset input
        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.disabled = true;
        errorEl.classList.add('hidden');

        // Add user message to state and UI
        messages.push({ role: 'user', content: text });
        appendMessage('user', text);

        // Add bot typing indicator
        const typingId = 'typing-' + Date.now();
        appendTypingIndicator(typingId);

        try {
            const response = await fetch('http://localhost:8000/generate-chart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messages })
            });

            const responseData = await response.json();

            // Remove typing indicator
            removeElement(typingId);

            if (!response.ok) {
                throw new Error(responseData.detail || "Failed to get response from server.");
            }

            // The response should have .message and optionally .chartConfig
            const botMessage = responseData.message || "Here is your chart.";
            const chartConfig = responseData.chartConfig;

            // Save assistant message to history
            messages.push({ role: 'assistant', content: botMessage });

            // Append bot message and chart
            appendBotResponse(botMessage, chartConfig);

        } catch (error) {
            console.error("Chat error:", error);
            removeElement(typingId);
            showError(error.message || "An unexpected error occurred.");
        }
    }

    function appendMessage(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;
        
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = text;
        
        msgDiv.appendChild(bubble);
        chatHistory.appendChild(msgDiv);
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
        indicator.innerHTML = '<span></span><span></span><span></span>';
        
        bubble.appendChild(indicator);
        msgDiv.appendChild(bubble);
        chatHistory.appendChild(msgDiv);
        scrollToBottom();
    }

    function appendBotResponse(text, chartConfig) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message bot';
        
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        
        // Add text if exists
        if (text) {
            const textNode = document.createElement('div');
            textNode.textContent = text;
            bubble.appendChild(textNode);
        }

        // Add chart if config exists and is not null
        if (chartConfig) {
            const chartWrapper = document.createElement('div');
            chartWrapper.className = 'chart-wrapper';
            
            const canvas = document.createElement('canvas');
            const canvasId = 'chart-' + Date.now();
            canvas.id = canvasId;
            
            chartWrapper.appendChild(canvas);
            bubble.appendChild(chartWrapper);
            
            // Need to append to DOM before initializing Chart
            msgDiv.appendChild(bubble);
            chatHistory.appendChild(msgDiv);
            
            // Initialize chart
            try {
                new Chart(document.getElementById(canvasId), chartConfig);
            } catch (err) {
                console.error("Failed to render chart:", err);
                const errDiv = document.createElement('div');
                errDiv.style.color = 'red';
                errDiv.style.marginTop = '10px';
                errDiv.textContent = 'Error rendering chart configuration.';
                bubble.appendChild(errDiv);
            }
        } else {
            msgDiv.appendChild(bubble);
            chatHistory.appendChild(msgDiv);
        }
        
        scrollToBottom();
    }

    function removeElement(id) {
        const el = document.getElementById(id);
        if (el) {
            el.remove();
        }
    }

    function scrollToBottom() {
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function showError(message) {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        setTimeout(() => {
            errorEl.classList.add('hidden');
        }, 5000);
    }
});
