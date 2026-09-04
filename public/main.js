/* ==========================================================================
   iChat Client Application Logic (main.js)
   ========================================================================== */

// Local Storage & Global State
let authToken = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let socket = null;
let currentConversationId = null;
let isLoginMode = true;

// Audio Notification Tone
const messageTone = new Audio('/message-tone.mp3');

// Group Chat Base64 SVG Avatar
const GROUP_AVATAR_SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f1c40f'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";

// ==========================================================================
// 1. App Initialization & DOM Binding
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Intercept form submissions to prevent default page reloads
    setupFormListeners();

    // Setup live search handler
    setupSearchListener();

    // Check existing login status
    if (authToken && currentUser) {
        showChatUI();
        initSocket();
    } else {
        showAuthUI();
    }
});

function setupFormListeners() {
    const singleAuthForm = document.getElementById('auth-form');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const messageForm = document.getElementById('message-form');

    if (singleAuthForm) {
        singleAuthForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitAuth();
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            isLoginMode = true;
            submitAuth();
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            isLoginMode = false;
            submitAuth();
        });
    }

    if (messageForm) {
        messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleSendMessage();
        });
    }
}

// Helper to safely get the sidebar list element
function getListContainer() {
    return document.getElementById('conversations-list-container') || document.getElementById('conversations-list');
}

// ==========================================================================
// 2. Authentication UI & Network Logic
// ==========================================================================

function toggleAuthMode(event, mode) {
    if (event) event.preventDefault();

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    if (mode) {
        isLoginMode = (mode === 'login');
        if (mode === 'register') {
            if (loginForm) loginForm.classList.add('hidden');
            if (registerForm) registerForm.classList.remove('hidden');
        } else {
            if (registerForm) registerForm.classList.add('hidden');
            if (loginForm) loginForm.classList.remove('hidden');
        }
    } else {
        isLoginMode = !isLoginMode;
        const titleEl = document.getElementById('auth-title');
        const toggleEl = document.getElementById('auth-toggle');
        if (titleEl) titleEl.innerText = isLoginMode ? 'Login' : 'Register';
        if (toggleEl) toggleEl.innerText = isLoginMode ? 'Need an account? Register' : 'Have an account? Login';
    }
}

async function submitAuth() {
    const usernameInput = document.getElementById('auth-username') || document.getElementById('login-username') || document.getElementById('reg-username');
    const passwordInput = document.getElementById('auth-password') || document.getElementById('login-password') || document.getElementById('reg-password');

    if (!usernameInput || !passwordInput) {
        alert('Authentication inputs missing from form');
        return;
    }

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const endpoint = isLoginMode ? 'login' : 'register';

    if (!username || !password) {
        alert('Please fill out all fields.');
        return;
    }

    try {
        const res = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Authentication failed');

        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('token', authToken);
        localStorage.setItem('user', JSON.stringify(currentUser));

        showChatUI();
        initSocket();
    } catch (err) {
        alert(err.message);
    }
}

function showAuthUI() {
    const authContainer = document.getElementById('auth-container');
    const chatContainer = document.getElementById('chat-main');

    if (authContainer) {
        authContainer.style.display = 'block';
        authContainer.classList.remove('hidden');
    }
    if (chatContainer) {
        chatContainer.style.display = 'none';
        chatContainer.classList.add('hidden');
    }
}

function showChatUI() {
    const authContainer = document.getElementById('auth-container');
    const chatContainer = document.getElementById('chat-main');

    if (authContainer) {
        authContainer.style.display = 'none';
        authContainer.classList.add('hidden');
    }
    if (chatContainer) {
        chatContainer.style.display = 'flex';
        chatContainer.classList.remove('hidden');
    }

    const loggedUsername = document.getElementById('logged-username');
    const loggedAvatar = document.getElementById('logged-avatar') || document.getElementById('user-avatar');

    if (loggedUsername && currentUser) loggedUsername.innerText = currentUser.username;
    if (loggedAvatar && currentUser) {
        loggedAvatar.src = currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(currentUser.username)}`;
    }

    // Default view shows sidebar first
    showSidebar();
    loadConversations();
}

function logout() {
    localStorage.clear();
    window.location.reload();
}

// ==========================================================================
// 3. Socket.IO Real-time Connection
// ==========================================================================

function initSocket() {
    socket = io({ auth: { token: authToken } });

    socket.on('connect', () => {
        loadConversations();
    });

    socket.on('clients-total', (count) => {
        const clientsTotal = document.getElementById('client-total') || document.getElementById('clients-total');
        if (clientsTotal) clientsTotal.innerText = `Total Clients: ${count}`;
    });

    // FIXED: Receive real-time messages for both group and direct conversations
    socket.on('receive-conversation-message', (data) => {
        const currentUserId = currentUser.id || currentUser._id;
        
        // Update sidebar preview subtitle dynamically
        const targetId = data.conversationId || 'group';
        const previewEl = document.getElementById(`preview-${targetId}`);
        if (previewEl) {
            previewEl.innerText = targetId === 'group' ? `${data.sender}: ${data.message}` : data.message;
        }

        // Display incoming message bubble if viewing this active chat session
        const isCurrentRoom = String(data.conversationId) === String(currentConversationId);
        if (isCurrentRoom) {
            try { messageTone.play(); } catch (e) {}
            addMessageToUI(String(data.senderId) === String(currentUserId), data);
        }
    });
}

// ==========================================================================
// 4. Conversation Side Panel & Single Chat Navigation
// ==========================================================================

function openSingleChatView(titleName) {
    const sidebar = document.querySelector('.sidebar') || document.getElementById('sidebar');
    const chatWindow = document.getElementById('chat-window');
    const titleEl = document.getElementById('current-chat-title');

    if (titleEl) titleEl.innerText = titleName;

    if (sidebar) sidebar.classList.add('hidden');
    if (chatWindow) chatWindow.classList.remove('hidden');

    const container = getListContainer();
    if (container) {
        container.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    }
    const activeEl = document.getElementById(`conv-${currentConversationId}`);
    if (activeEl) activeEl.classList.add('active');
}

function showSidebar() {
    const sidebar = document.querySelector('.sidebar') || document.getElementById('sidebar');
    const chatWindow = document.getElementById('chat-window');

    if (chatWindow) chatWindow.classList.add('hidden');
    if (sidebar) sidebar.classList.remove('hidden');
}

async function loadConversations() {
    if (!authToken || !currentUser) return;

    try {
        const userId = currentUser.id || currentUser._id;
        const res = await fetch(`/api/conversations/${userId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const conversations = await res.json();
        renderConversationsList(conversations);
    } catch (err) {
        console.error('Failed to load conversations:', err);
    }
}

async function getGroupLatestMessage() {
    try {
        const res = await fetch(`/api/messages/filtered?targetUserId=group`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return 'Public Room';
        const messages = await res.json();
        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            return `${lastMsg.sender}: ${lastMsg.message}`;
        }
    } catch (err) {
        console.error('Failed to load group message preview:', err);
    }
    return 'Public Room';
}

async function renderConversationsList(conversations = []) {
    const container = getListContainer();
    if (!container) return;
    container.innerHTML = '';

    const groupPreviewText = await getGroupLatestMessage();

    // 1. Group Chat Item
    const groupLi = document.createElement('li');
    groupLi.className = `user-item ${currentConversationId === 'group' ? 'active' : ''}`;
    groupLi.id = `conv-group`;
    groupLi.innerHTML = `
        <img src="${GROUP_AVATAR_SVG}" alt="Group Chat" style="background: #2a344d; padding: 4px; border-radius: 50%;">
        <div class="conv-info">
            <span class="conv-title">Group Chat</span>
            <span class="conv-subtitle" id="preview-group">${escapeHTML(groupPreviewText)}</span>
        </div>
    `;
    groupLi.onclick = () => selectGroupChat();
    container.appendChild(groupLi);

    // 2. Direct 1-on-1 Items
    conversations.forEach(conv => {
        const userId = currentUser.id || currentUser._id;
        const otherUser = conv.users.find(u => String(u._id) !== String(userId)) || conv.users[0];
        const convName = (otherUser && otherUser.username) ? otherUser.username : "User";
        const avatar = (otherUser && otherUser.avatar) 
            ? otherUser.avatar 
            : `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(convName)}`;

        const lastMsgText = conv.latestMessage 
            ? (typeof conv.latestMessage === 'string' ? conv.latestMessage : conv.latestMessage.message)
            : 'No messages yet';

        const li = document.createElement('li');
        li.className = `user-item ${currentConversationId === conv._id ? 'active' : ''}`;
        li.id = `conv-${conv._id}`;
        li.innerHTML = `
            <img src="${avatar}" alt="${escapeHTML(convName)}">
            <div class="conv-info">
                <span class="conv-title">${escapeHTML(convName)}</span>
                <span class="conv-subtitle" id="preview-${conv._id}">${escapeHTML(lastMsgText)}</span>
            </div>
        `;
        li.onclick = () => selectConversation(conv._id, convName);
        
        // Auto join user to all their direct conversation rooms on load
        if (socket) socket.emit('join-conversation', conv._id);
        
        container.appendChild(li);
    });
}

async function selectGroupChat() {
    currentConversationId = 'group';
    openSingleChatView('Group Chat');

    if (socket) socket.emit('join-conversation', 'group');
    await loadConversationMessages('group');
}

async function selectConversation(conversationId, titleName) {
    currentConversationId = conversationId;
    openSingleChatView(titleName);

    if (socket) socket.emit('join-conversation', conversationId);
    await loadConversationMessages(conversationId);
}

// User Search Logic
function setupSearchListener() {
    const searchInput = document.getElementById('user-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (!query) {
                loadConversations();
            } else {
                handleUserSearch(query);
            }
        });
    }
}

async function handleUserSearch(query) {
    try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const users = await res.json();

        const container = getListContainer();
        if (!container) return;
        container.innerHTML = '';

        const userId = currentUser.id || currentUser._id;
        users.forEach(u => {
            if (String(u._id) === String(userId)) return;

            const avatarSrc = u.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(u.username)}`;
            const li = document.createElement('li');
            li.className = 'user-item';
            li.innerHTML = `
                <img src="${avatarSrc}" alt="${escapeHTML(u.username)}">
                <div class="conv-info">
                    <span class="conv-title">${escapeHTML(u.username)}</span>
                    <span class="conv-subtitle">Click to chat</span>
                </div>
            `;
            li.onclick = () => createOrOpenConversation(u._id, u.username);
            container.appendChild(li);
        });
    } catch (err) {
        console.error('Search error:', err);
    }
}

async function createOrOpenConversation(targetUserId, targetUsername) {
    try {
        const userId = currentUser.id || currentUser._id;

        const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                senderId: userId,
                targetUserId: targetUserId,
                users: [userId, targetUserId],
                name: targetUsername
            })
        });

        const conversation = await res.json();

        if (!res.ok || !conversation._id) {
            alert("Failed to start conversation: " + (conversation.error || "Unknown error"));
            return;
        }

        const searchInput = document.getElementById('user-search-input');
        if (searchInput) searchInput.value = '';

        // Join room and open chat immediately
        if (socket) socket.emit('join-conversation', conversation._id);

        await loadConversations();
        selectConversation(conversation._id, targetUsername);
    } catch (err) {
        console.error('Failed to create/open conversation:', err);
    }
}

// ==========================================================================
// 5. Messaging Logic & Rendering
// ==========================================================================

async function loadConversationMessages(conversationId) {
    try {
        const res = await fetch(`/api/messages/filtered?targetUserId=${conversationId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const messages = await res.json();
        
        const messageContainer = document.getElementById('message-container');
        if (messageContainer) messageContainer.innerHTML = '';

        const userId = currentUser.id || currentUser._id;
        if (Array.isArray(messages)) {
            messages.forEach(msg => {
                const isOwn = String(msg.senderId) === String(userId);
                addMessageToUI(isOwn, {
                    _id: msg._id,
                    sender: msg.sender,
                    senderId: msg.senderId,
                    message: msg.message,
                    createdAt: msg.createdAt
                });
            });
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

function handleSendMessage() {
    const messageInput = document.getElementById('message-input');
    if (!messageInput || !currentConversationId) return;

    const messageText = messageInput.value.trim();
    if (!messageText) return;

    const userId = currentUser.id || currentUser._id;
    const messageData = {
        conversationId: currentConversationId,
        senderId: userId,
        sender: currentUser.username,
        message: messageText,
        createdAt: new Date().toISOString()
    };

    // Send over socket
    if (socket) {
        socket.emit('send-conversation-message', messageData);
    }

    messageInput.value = '';
}

function addMessageToUI(isOwnMessage, data) {
    const messageContainer = document.getElementById('message-container');
    if (!messageContainer) return;

    if (data._id && document.getElementById(`msg-${data._id}`)) {
        return;
    }

    const li = document.createElement('li');
    li.classList.add(isOwnMessage ? 'message-right' : 'message-left');
    if (data._id) li.id = `msg-${data._id}`;

    const formattedTime = data.createdAt 
        ? new Date(data.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Just now';

    li.innerHTML = `
        <p class="message">${escapeHTML(data.message)}</p>
        <span>${escapeHTML(data.sender)} • ${formattedTime}</span>
    `;

    messageContainer.appendChild(li);
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// Utility to safely render user text input
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}