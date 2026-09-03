let authToken = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let socket = null;
let currentConversationId = null;
let isLoginMode = true;

const authContainer = document.getElementById('auth-container');
const chatContainer = document.getElementById('chat-main');
const messageContainer = document.getElementById('message-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const clientsTotal = document.getElementById('client-total');
const messageTone = new Audio('/message-tone.mp3');


if (authToken && currentUser) {
    showChatUI();
    initSocket();
} else {
    showAuthUI();
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? 'Login' : 'Register';
    document.getElementById('auth-toggle').innerText = isLoginMode ? 'Need an account? Register' : 'Have an account? Login';
}

async function submitAuth() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const endpoint = isLoginMode ? 'login' : 'register';

    try {
        const res = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

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

// Socket listener updates previews in real-time
function initSocket() {
    socket = io({ auth: { token: authToken } });

    socket.on('connect', () => {
        loadConversations();
    });

    socket.on('clients-total', (count) => {
        if (clientsTotal) clientsTotal.innerText = `Total Clients: ${count}`;
    });

    socket.on('receive-conversation-message', (data) => {
        const currentUserId = currentUser.id || currentUser._id;
        
        // Update side panel subtitle preview
        const targetId = data.conversationId || 'group';
        const previewEl = document.getElementById(`preview-${targetId}`);
        if (previewEl) {
            previewEl.innerText = targetId === 'group' ? `${data.sender}: ${data.message}` : data.message;
        }

        if (data.conversationId === currentConversationId && data.senderId !== currentUserId) {
            try { messageTone.play(); } catch (e) {}
            addMessageToUI(false, data);
        }
    });
}

// Get the conversations list DOM element (supports both possible ID names in your HTML)
function getListContainer() {
    return document.getElementById('conversations-list-container') || document.getElementById('conversations-list');
}

// Fetch all existing conversations for current user
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


// Fetch public group chat latest message preview
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

// Clean base64-encoded SVG avatar for Group Chat (prevents string escaping issues)
const GROUP_AVATAR_SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f1c40f'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";

// Render conversations side panel
async function renderConversationsList(conversations = []) {
    const container = getListContainer();
    if (!container) return;
    container.innerHTML = '';

    // Fetch latest group chat preview text
    const groupPreviewText = await getGroupLatestMessage();

    // 1. Group Chat Item
    const groupLi = document.createElement('li');
    groupLi.className = `user-item ${currentConversationId === 'group' ? 'active' : ''}`;
    groupLi.id = `conv-group`;
    groupLi.innerHTML = `
        <img src="${GROUP_AVATAR_SVG}" alt="Group Chat" style="background: #2a344d; padding: 4px; border-radius: 50%;">
        <div class="conv-info">
            <span class="conv-title">Group Chat</span>
            <span class="conv-subtitle" id="preview-group">${groupPreviewText}</span>
        </div>
    `;
    groupLi.onclick = () => selectGroupChat();
    container.appendChild(groupLi);

    // 2. Direct 1-on-1 Conversations
    conversations.forEach(conv => {
        const userId = currentUser.id || currentUser._id;
        const otherUser = conv.users.find(u => u._id !== userId) || conv.users[0];
        const convName = (otherUser && otherUser.username) ? otherUser.username : "User";
        const avatar = (otherUser && otherUser.avatar) 
            ? otherUser.avatar 
            : `https://api.dicebear.com/7.x/bottts/svg?seed=${convName}`;

        const lastMsgText = conv.latestMessage 
            ? (typeof conv.latestMessage === 'string' ? conv.latestMessage : conv.latestMessage.message)
            : 'No messages yet';

        const li = document.createElement('li');
        li.className = `user-item ${currentConversationId === conv._id ? 'active' : ''}`;
        li.id = `conv-${conv._id}`;
        li.innerHTML = `
            <img src="${avatar}" alt="${convName}">
            <div class="conv-info">
                <span class="conv-title">${convName}</span>
                <span class="conv-subtitle" id="preview-${conv._id}">${lastMsgText}</span>
            </div>
        `;
        li.onclick = () => selectConversation(conv._id, convName);
        container.appendChild(li);
    });
}

// Select Group Chat
async function selectGroupChat() {
    currentConversationId = 'group';

    const titleEl = document.getElementById('current-chat-title');
    if (titleEl) titleEl.innerText = 'Group Chat';

    const chatMain = document.getElementById('chat-main');
    const chatWindow = document.getElementById('chat-window');

    if (chatMain) chatMain.classList.add('expanded');
    if (chatWindow) chatWindow.classList.remove('hidden');

    const container = getListContainer();
    if (container) {
        container.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    }
    const groupEl = document.getElementById('conv-group');
    if (groupEl) groupEl.classList.add('active');

    if (socket) socket.emit('join-conversation', 'group');

    await loadConversationMessages('group');
}

// Select Direct Message Conversation
async function selectConversation(conversationId, titleName) {
    currentConversationId = conversationId;

    const titleEl = document.getElementById('current-chat-title');
    if (titleEl) titleEl.innerText = titleName;

    const chatMain = document.getElementById('chat-main');
    const chatWindow = document.getElementById('chat-window');

    if (chatMain) chatMain.classList.add('expanded');
    if (chatWindow) chatWindow.classList.remove('hidden');

    const container = getListContainer();
    if (container) {
        container.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    }
    const activeEl = document.getElementById(`conv-${conversationId}`);
    if (activeEl) activeEl.classList.add('active');

    if (socket) socket.emit('join-conversation', conversationId);

    await loadConversationMessages(conversationId);
}

// User Search Handler
async function handleUserSearch() {
    const searchInput = document.getElementById('user-search-input');
    if (!searchInput) return;
    const query = searchInput.value.trim();

    if (!query) {
        loadConversations();
        return;
    }

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
            if (u._id === userId) return;

            const avatarSrc = u.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`;
            const li = document.createElement('li');
            li.className = 'user-item';
            li.innerHTML = `
                <img src="${avatarSrc}" alt="${u.username}">
                <div class="conv-info">
                    <span class="conv-title">${u.username}</span>
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

// Update search input handler to restore conversation list when search is cleared
const searchInput = document.getElementById('user-search-input');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (!query) {
            loadConversations(); // 👈 Restores Group Chat & Conversations when input is empty
        } else {
            handleUserSearch();
        }
    });
}

// Open or create a conversation with a target user ID
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

        if (searchInput) searchInput.value = '';

        await loadConversations();
        selectConversation(conversation._id, targetUsername);
    } catch (err) {
        console.error('Failed to create/open conversation:', err);
    }
}

// Load message history for a given room
async function loadConversationMessages(conversationId) {
    try {
        const res = await fetch(`/api/messages/filtered?targetUserId=${conversationId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const messages = await res.json();
        if (messageContainer) messageContainer.innerHTML = '';

        const userId = currentUser.id || currentUser._id;
        messages.forEach(msg => {
            const isOwn = msg.senderId === userId;
            addMessageToUI(isOwn, {
                _id: msg._id,
                sender: msg.sender,
                message: msg.message,
                createdAt: msg.createdAt
            });
        });
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}


// Render message bubble
function addMessageToUI(isOwnMessage, data) {
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
        <p class="message">${data.message}</p>
        <span>${data.sender} • ${formattedTime}</span>
    `;

    messageContainer.appendChild(li);
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// Back Button Action to hide Chat Window & reduce container width
function showSidebar() {
    const chatMain = document.getElementById('chat-main');
    const chatWindow = document.getElementById('chat-window');

    if (chatMain) chatMain.classList.remove('expanded');
    if (chatWindow) chatWindow.classList.add('hidden');
}

function showAuthUI() {
    if (authContainer) authContainer.style.display = 'block';
    if (chatContainer) chatContainer.style.display = 'none';
}

function showChatUI() {
    if (authContainer) authContainer.style.display = 'none';
    if (chatContainer) chatContainer.style.display = 'flex';

    const loggedUsername = document.getElementById('logged-username');
    const loggedAvatar = document.getElementById('logged-avatar');

    if (loggedUsername) loggedUsername.innerText = currentUser.username;
    if (loggedAvatar) {
        loggedAvatar.src = currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`;
    }

    loadConversations();
}

function logout() {
    localStorage.clear();
    window.location.reload();
}