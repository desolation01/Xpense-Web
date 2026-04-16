(function() {
    console.log("Chat system initializing...");
    
    // --- SECURITY & CSRF ---
    let csrfToken = null;
    async function fetchCsrfToken() {
        if (csrfToken) return csrfToken;
        try {
            const r = await fetch("/api/api?action=token");
            const data = await r.json();
            csrfToken = data.token;
            return csrfToken;
        } catch (e) {
            return null;
        }
    }

    // Use more specific selectors to avoid any conflicts
    const chatPanel = document.querySelector('#globalChatPanel');
    const chatMessages = document.querySelector('#globalChatMessages');
    const chatForm = document.querySelector('#globalChatForm');
    const chatInput = document.querySelector('#globalChatInput');
    const chatNickname = document.querySelector('#globalChatNickname');
    const chatOnlineCount = document.querySelector('#globalOnlineCount');
    const chatToggle = document.querySelector('#globalChatToggle');
    
    if (!chatPanel || !chatToggle) {
        console.error("Global Chat elements missing!", {panel: !!chatPanel, toggle: !!chatToggle});
        return;
    }

    let lastMessageId = null;
    let isFetching = false;
    let pollInterval = null;

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    // Load nickname from localStorage
    chatNickname.value = localStorage.getItem('chat_nickname') || 'Guest' + Math.floor(Math.random() * 900 + 100);
    chatNickname.addEventListener('input', () => {
        localStorage.setItem('chat_nickname', chatNickname.value.trim());
    });

    async function fetchMessages() {
        if (isFetching) return;
        isFetching = true;
        try {
            const res = await fetch('api/chat?action=get');
            if (!res.ok) throw new Error("Server error");
            const data = await res.json();
            
            if (chatOnlineCount) chatOnlineCount.textContent = data.online || 1;
            
            const newEntries = data.messages || [];
            if (newEntries.length > 0 && (lastMessageId === null || newEntries[newEntries.length - 1].id !== lastMessageId)) {
                renderMessages(newEntries);
                lastMessageId = newEntries[newEntries.length - 1].id;
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        } catch (e) {
            console.warn("Global Chat sync failed. This is normal if you are offline.");
        } finally {
            isFetching = false;
        }
    }

    function renderMessages(messages) {
        if (!chatMessages) return;
        chatMessages.innerHTML = messages.map(msg => {
            const safeUser = escapeHtml(msg.user || 'Anonymous');
            const safeTime = escapeHtml(msg.time || '');
            const safeText = escapeHtml(msg.text || '').replace(/\n/g, '<br>');
            return `
                <div class="chatbot-row assistant">
                    <div class="chatbot-bubble" style="padding: 0.5rem 0.75rem;">
                        <span style="font-weight: 600; color: var(--color-primary); font-size: 0.8rem;">${safeUser}</span>
                        <span style="font-size: 0.7rem; color: var(--color-muted-foreground); margin-left: 5px;">${safeTime}</span>
                        <div style="margin-top: 2px;">${safeText}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    if (chatForm) {
        chatForm.onsubmit = async (e) => {
            e.preventDefault();
            if (!chatInput) return;
            const text = chatInput.value.trim();
            if (!text) return;
            
            chatInput.value = '';
            try {
                const token = await fetchCsrfToken();
                await fetch('api/chat?action=send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': token
                    },
                    body: JSON.stringify({
                        text: text,
                        user: (chatNickname && chatNickname.value.trim()) || 'Anonymous'
                    })
                });
                fetchMessages();
            } catch (e) {}
        };
    }

    function setOpen(open) {
        console.log("Setting chat open:", open);
        chatPanel.hidden = !open;
        chatToggle.setAttribute('aria-expanded', String(open));
        if (open) {
            fetchMessages();
            if (!pollInterval) pollInterval = setInterval(fetchMessages, 3000);
            if (chatInput) chatInput.focus();
            if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
        }
    }

    // Use addEventListener instead of onclick to be safer
    chatToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(chatPanel.hidden);
    });

    console.log("Chat system initialized.");
    fetchMessages();
})();
