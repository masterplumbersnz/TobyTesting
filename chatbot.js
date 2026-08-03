// ── Editor safety check ───────────────────────────────────────────────────────
// The iMIS content editor renders this content item live inside an iframe
// when you open it to edit. Without this check, Toby takes over the entire
// edit dialog, blocking access to the source editor underneath.
// The real live page on masterplumbers.org.nz is never loaded inside an
// iframe, so this check only stops execution in the editor context.
if (window.self !== window.top) {
    console.log('Toby: detected iframe context (likely the iMIS content editor) — skipping initialisation.');
} else {

document.addEventListener('DOMContentLoaded', () => {

    const input      = document.getElementById('user-input');
    const messages   = document.getElementById('messages');
    const sendButton = document.getElementById('send-button');
    const newChatBtn = document.getElementById('new-chat');

    /* ------------------------------
       24-HOUR SESSION MANAGEMENT
    ------------------------------ */

    const SESSION_KEY         = 'toby_chat_session';
    const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

    function loadSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return { previous_response_id: null, isNew: true };
            const session = JSON.parse(raw);
            if (Date.now() - session.startTime > SESSION_DURATION_MS) {
                localStorage.removeItem(SESSION_KEY);
                return { previous_response_id: null, expired: true };
            }
            return session;
        } catch {
            return { previous_response_id: null, isNew: true };
        }
    }

    function saveSession(previous_response_id) {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            const existing = raw ? JSON.parse(raw) : { startTime: Date.now() };
            localStorage.setItem(SESSION_KEY, JSON.stringify({
                ...existing,
                previous_response_id,
            }));
        } catch (e) {
            console.warn('Could not save session:', e);
        }
    }

    function startFreshSession() {
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify({
                startTime: Date.now(),
                previous_response_id: null,
            }));
        } catch (e) {
            console.warn('Could not write session:', e);
        }
    }

    const initialSession = loadSession();
    let previous_response_id = initialSession.previous_response_id;

    if (initialSession.isNew) startFreshSession();

    /* ------------------------------
       TEXTAREA AUTO EXPAND
    ------------------------------ */

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
    });

    /* ------------------------------
       MARKDOWN FORMATTER
    ------------------------------ */

    const formatMarkdown = (text) => {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/^(\d+)\.\s+(.*)$/gm, '<p><strong>$1.</strong> $2</p>')
            .replace(/\n{2,}/g, '<br><br>')
            .replace(/\n/g, '<br>');
    };

    /* ------------------------------
       STRIP CITATIONS
    ------------------------------ */

    const stripCitations = (text) => {
        return text.replace(/【\d+:\d+†[^†【】]+(?:†[^【】]*)?】/g, '');
    };

    /* ------------------------------
       SCROLL TO BOTTOM
    ------------------------------ */

    function scrollToBottom() {
        const lastMessage = messages.lastElementChild;
        if (lastMessage) {
            lastMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }

    /* ------------------------------
       CREATE MESSAGE BUBBLE
    ------------------------------ */

    const createBubble = (content, sender) => {
        const div = document.createElement('div');

        if (sender === 'bot') {
            const wrapper = document.createElement('div');
            wrapper.className = 'bot-message';

            const avatar = document.createElement('img');
            avatar.src = 'https://capable-brioche-99db20.netlify.app/Toby-Avatar.webp';
            avatar.className = 'toby-avatar';

            div.className = 'toby-bubble toby-bot';
            div.innerHTML = content;

            wrapper.appendChild(avatar);
            wrapper.appendChild(div);
            messages.appendChild(wrapper);

        } else {
            div.className = 'toby-bubble toby-user';
            div.innerText = content;
            messages.appendChild(div);
        }

        scrollToBottom();
        return div;
    };

    /* ------------------------------
       TYPING INDICATOR
    ------------------------------ */

    const showTyping = () => {
        return createBubble(`
            <div class="toby-typing">
                <span></span><span></span><span></span>
            </div>
        `, 'bot');
    };

    /* ------------------------------
       STREAMING EFFECT
    ------------------------------ */

    const typeMessage = (text, bubble) => {
        let i = 0;
        const cleaned   = stripCitations(text);
        const formatted = formatMarkdown(cleaned);

        const interval = setInterval(() => {
            bubble.innerHTML = formatted.substring(0, i);
            i++;
            scrollToBottom();

            if (i >= formatted.length) {
                clearInterval(interval);
            }
        }, 8);
    };

    /* ------------------------------
       RESET CHAT
    ------------------------------ */

    function resetChat(reason) {
        previous_response_id = null;
        startFreshSession();
        messages.innerHTML = '';
        if (reason === 'expired') {
            createBubble(
                'Your session has expired after 24 hours — starting fresh! Previous conversation context has been cleared.',
                'bot'
            );
        }
        createBubble("Hi! I'm Toby. Ask me anything about plumbing.", 'bot');
    }

    /* ------------------------------
       NEW CHAT BUTTON
    ------------------------------ */

    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => resetChat('manual'));
    }

    /* ------------------------------
       INITIAL WELCOME MESSAGE
    ------------------------------ */

    if (initialSession.expired) {
        resetChat('expired');
    } else {
        createBubble("Hi! I'm Toby. Ask me anything about plumbing.", 'bot');
    }

    /* ------------------------------
       SUGGESTED QUESTIONS
    ------------------------------ */

    document.querySelectorAll('#suggestions button').forEach(btn => {
        btn.addEventListener('click', () => {
            input.value = btn.innerText;
            handleSend();
        });
    });

    /* ------------------------------
       CORE SEND FUNCTION
       Driven by button click and Enter key — no <form> submit involved.
       This avoids conflicts with iMIS's own page-level <form> element.
    ------------------------------ */

    async function handleSend() {

        // Check session hasn't expired mid-conversation
        const currentSession = loadSession();
        if (currentSession.expired) {
            resetChat('expired');
            return;
        }

        const message = input.value.trim();
        if (!message) return;

        createBubble(message, 'user');
        input.value = '';
        input.style.height = 'auto';
        sendButton.disabled = true;

        const typingBubble = showTyping();

        try {
            const res = await fetch(
                'https://capable-brioche-99db20.netlify.app/.netlify/functions/chat',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, previous_response_id }),
                }
            );

            if (res.status === 403) {
                typingBubble.closest('.bot-message').remove();
                createBubble('Sorry, this assistant is only available within New Zealand. 🇳🇿', 'bot');
                sendButton.disabled = false;
                return;
            }

            if (!res.ok) throw new Error(`Request failed: ${res.status}`);

            const data = await res.json();
            previous_response_id = data.response_id;
            saveSession(previous_response_id);

            typingBubble.closest('.bot-message').remove();
            const botBubble = createBubble('', 'bot');
            typeMessage(data.reply || '(No response)', botBubble);

        } catch (err) {
            console.error(err);
            typingBubble.closest('.bot-message').remove();
            createBubble('🤖 My circuits got tangled for a second. Can we try that again?', 'bot');
        }

        sendButton.disabled = false;
    }

    /* ------------------------------
       EVENT LISTENERS
       Note: using click instead of form submit — iMIS safe.
    ------------------------------ */

    sendButton.addEventListener('click', handleSend);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

}); // end DOMContentLoaded

} // end iframe guard
