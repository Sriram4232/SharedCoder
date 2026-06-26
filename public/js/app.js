/**
 * NEXUS COLLABORATIVE IDE - CLIENT CORE LOGIC
 */

// Global State Object
const state = {
  socket: null,
  editor: null,
  db: null,
  roomId: null,
  username: null,
  language: null, // 'java' | 'python' | 'oracle'
  collaborators: {},
  remoteCursors: {},
  isApplyingRemoteChanges: false,
  selfId: null,
  editMode: 'global' // 'global' | 'local'
};

// ==========================================================================
// TOAST ALERT SYSTEM
// ==========================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  // Icon selector
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'warning') icon = 'fa-triangle-exclamation';
  if (type === 'error') icon = 'fa-circle-exclamation';
  
  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Slide out and remove
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}

// ==========================================================================
// CLIENT ROUTER (SPA VIEWS MANAGER)
// ==========================================================================
function router() {
  const hash = window.location.hash;
  const dashboardView = document.getElementById('dashboard-view');
  const roomView = document.getElementById('room-view');
  
  if (hash.startsWith('#/room/')) {
    // We are entering a room!
    const targetRoomId = hash.replace('#/room/', '');
    
    // If username is not set, force them back to dashboard to join properly
    if (!state.username) {
      showToast('Please enter your name to connect to the workspace.', 'warning');
      window.location.hash = '#/';
      
      // Auto-populate join details on dashboard
      document.getElementById('join-room-id').value = targetRoomId;
      document.getElementById('join-username').focus();
      return;
    }
    
    // Switch Views
    dashboardView.classList.remove('active');
    roomView.classList.add('active');
    
    state.roomId = targetRoomId;
    initRoomConnection();
  } else {
    // Render Dashboard
    roomView.classList.remove('active');
    dashboardView.classList.add('active');
    
    // Disconnect socket if going back to dashboard
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
    state.roomId = null;
    state.collaborators = {};
    
    // Clear and clean DOM elements
    document.getElementById('avatar-container').innerHTML = '';
    document.getElementById('chat-messages').innerHTML = '<div class="chat-log-event">Welcome to the Nexus workspace. Share your link with friends to code together!</div>';
    document.getElementById('console-output').className = 'console-output';
    document.getElementById('console-output').textContent = 'Console is idle. Click "Run Code" above to execute.';
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('load', () => {
  // Setup Language card clicking
  const langOptions = document.querySelectorAll('.lang-option');
  langOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      langOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
  
  // Set default language selection to Java
  document.querySelector('.lang-option[data-lang="java"]').classList.add('selected');
  
  // Setup Workspace Mode Toggle
  const btnGlobal = document.getElementById('btn-mode-global');
  const btnLocal = document.getElementById('btn-mode-local');
  
  if (btnGlobal && btnLocal) {
    btnGlobal.addEventListener('click', () => {
      if (state.editMode === 'global') return;
      state.editMode = 'global';
      btnLocal.classList.remove('active');
      btnGlobal.classList.add('active');
      
      const statusSpan = document.getElementById('sync-status');
      statusSpan.className = 'sync-status status-success';
      statusSpan.innerHTML = '<i class="fa-solid fa-circle-check"></i> Connected & Synced';
      
      // Sync current local text to overwrite room buffer
      if (state.socket && state.editor) {
        state.socket.emit('sync-full-code', {
          roomId: state.roomId,
          fullCode: state.editor.getValue()
        });
      }
      showToast('Switched to Global Mode. Workspace is synchronized.', 'success');
    });
    
    btnLocal.addEventListener('click', () => {
      if (state.editMode === 'local') return;
      state.editMode = 'local';
      btnGlobal.classList.remove('active');
      btnLocal.classList.add('active');
      
      const statusSpan = document.getElementById('sync-status');
      statusSpan.className = 'sync-status status-disconnected';
      statusSpan.innerHTML = '<i class="fa-solid fa-laptop-code"></i> Local (Private Sandbox)';
      
      // Clear peer cursors since templates will drift
      if (state.editor) {
        Object.keys(state.remoteCursors).forEach(userId => {
          state.editor.deltaDecorations(state.remoteCursors[userId], []);
          delete state.remoteCursors[userId];
        });
      }
      showToast('Switched to Local Mode. Editor changes are private.', 'info');
    });
  }
  
  router();
});

// ==========================================================================
// WORKSPACE ACTIONS (FORMS SUBMIT)
// ==========================================================================
document.getElementById('create-room-form').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const name = document.getElementById('create-username').value.trim();
  const roomName = document.getElementById('create-room-name').value.trim();
  const selectedLangOption = document.querySelector('.lang-option.selected');
  const lang = selectedLangOption ? selectedLangOption.getAttribute('data-lang') : 'java';
  
  if (!name || !roomName) return;
  
  state.username = name;
  state.language = lang;
  
  // Create a clean random Room ID
  const roomUUID = Math.random().toString(36).substring(2, 8) + '-' + Math.random().toString(36).substring(2, 8);
  
  // Store details to localStorage for convenience
  localStorage.setItem('nexus_room_name', roomName);
  
  window.location.hash = `#/room/${roomUUID}`;
});

document.getElementById('join-room-form').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const name = document.getElementById('join-username').value.trim();
  let roomIdInput = document.getElementById('join-room-id').value.trim();
  
  // Clean room input if they pasted a full URL
  if (roomIdInput.includes('#/room/')) {
    roomIdInput = roomIdInput.split('#/room/')[1];
  }
  
  if (!name || !roomIdInput) return;
  
  state.username = name;
  state.roomId = roomIdInput;
  state.language = null; // Backend will feed room configuration
  
  window.location.hash = `#/room/${roomIdInput}`;
});

document.getElementById('btn-exit').addEventListener('click', () => {
  if (confirm('Are you sure you want to exit this collaborative workspace?')) {
    window.location.hash = '#/';
  }
});

document.getElementById('nav-btn-home').addEventListener('click', (e) => {
  e.preventDefault();
  if (confirm('Are you sure you want to leave the workspace?')) {
    window.location.hash = '#/';
  }
});

// Clipboard Invite Link Share
document.getElementById('btn-copy-link').addEventListener('click', () => {
  const inviteLink = `${window.location.origin}${window.location.pathname}#/room/${state.roomId}`;
  navigator.clipboard.writeText(inviteLink).then(() => {
    showToast('Workspace invite link copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback copy
    const tempInput = document.createElement('input');
    tempInput.value = inviteLink;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    showToast('Workspace invite link copied!', 'success');
  });
});

// Clear console
document.getElementById('btn-clear-console').addEventListener('click', () => {
  const consoleOut = document.getElementById('console-output');
  consoleOut.className = 'console-output';
  consoleOut.textContent = 'Console cleared. Ready to execute code.';
});

// Tab navigation handler
const tabButtons = document.querySelectorAll('.tab-btn');
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.getAttribute('data-tab');
    
    // Toggle active state on buttons
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Toggle active state on panes
    const tabPanes = document.querySelectorAll('.tab-pane');
    tabPanes.forEach(pane => {
      pane.classList.remove('active');
      if (pane.id === `pane-${targetTab}`) {
        pane.classList.add('active');
      }
    });
  });
});

// ==========================================================================
// REAL-TIME WEBSOCKET SYNC CONNECTION
// ==========================================================================
function initRoomConnection() {
  if (state.socket) return; // Prevent double setup
  
  // Establish WebSocket connection using only websockets to support Render free tier load balancing (no sticky sessions)
  state.socket = io({
    transports: ['websocket']
  });
  
  // Handle connection error
  state.socket.on('connect_error', () => {
    document.getElementById('sync-status').className = 'sync-status status-error';
    document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Connection Offline';
  });
  
  // Notify connection start
  document.getElementById('sync-status').className = 'sync-status status-loading';
  document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to room...';
  
  const savedRoomName = localStorage.getItem('nexus_room_name') || 'Shared Workspace';
  
  state.socket.emit('join-room', {
    roomId: state.roomId,
    username: state.username,
    language: state.language || 'java' // defaults if joining from link
  });
  
  // Receive full room state
  state.socket.on('room-state', ({ code, language, users, selfId }) => {
    state.language = language;
    state.selfId = selfId;
    state.collaborators = users;
    
    // Update headers and page titles
    const displayLangs = { java: 'JAVA IDE', python: 'PYTHON IDE', oracle: 'ORACLE DB' };
    const fileLangs = { java: 'Main.java', python: 'main.py', oracle: 'oracle_schema.sql' };
    
    document.getElementById('display-room-name').textContent = savedRoomName;
    document.getElementById('display-room-id').textContent = state.roomId;
    
    const langBadge = document.getElementById('display-room-lang');
    langBadge.textContent = displayLangs[language] || language.toUpperCase();
    langBadge.className = `badge ${language}-badge`;
    
    document.getElementById('editor-file-title').textContent = fileLangs[language] || 'main.code';
    
    // Update UI for Oracle SQL
    const tabOracle = document.getElementById('tab-oracle-db');
    if (language === 'oracle') {
      tabOracle.style.display = 'flex';
      initOracleDB(); // Initialize SQLite Virtual Engine
    } else {
      tabOracle.style.display = 'none';
      // Switch back to runner console tab if SQL was active
      document.querySelector('.tab-btn[data-tab="runner"]').click();
    }
    
    // Initialize Monaco Editor with language and code values
    initMonacoEditor(code, language);
    
    // Render active avatars
    renderCollaboratorAvatars();
    
    // Update connection status label
    document.getElementById('sync-status').className = 'sync-status status-success';
    document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-circle-check"></i> Connected & Synced';
    
    document.getElementById('chat-count').textContent = `${Object.keys(users).length} online`;
    showToast(`Successfully connected to ${savedRoomName}!`, 'success');
  });
  
  // Handle new user joins
  state.socket.on('user-joined', ({ userId, user }) => {
    state.collaborators[userId] = user;
    renderCollaboratorAvatars();
    
    // Update chat active count
    const totalUsers = Object.keys(state.collaborators).length;
    document.getElementById('chat-count').textContent = `${totalUsers} online`;
    
    // Write system join log in chat
    appendChatLog(`${user.username} has joined the workspace.`);
    showToast(`${user.username} entered the room.`, 'info');
  });
  
  // Handle user leaves
  state.socket.on('user-left', ({ userId, username }) => {
    // Clear user visual decorations
    if (state.remoteCursors[userId]) {
      state.editor.deltaDecorations(state.remoteCursors[userId], []);
      delete state.remoteCursors[userId];
    }
    
    delete state.collaborators[userId];
    renderCollaboratorAvatars();
    
    const totalUsers = Object.keys(state.collaborators).length;
    document.getElementById('chat-count').textContent = `${totalUsers} online`;
    
    appendChatLog(`${username} has left the workspace.`);
    showToast(`${username} left the room.`, 'warning');
    
    // Clean up dynamic user style tag
    const styleEl = document.getElementById(`user-style-${userId}`);
    if (styleEl) styleEl.remove();
  });
  
  // Receive code changes from peers
  state.socket.on('code-change', ({ changes }) => {
    if (!state.editor || state.editMode === 'local') return;
    
    state.isApplyingRemoteChanges = true;
    
    const model = state.editor.getModel();
    
    // Apply Monaco Edits
    state.editor.executeEdits('remote-sync', changes.map(change => ({
      range: new monaco.Range(
        change.range.startLineNumber,
        change.range.startColumn,
        change.range.endLineNumber,
        change.range.endColumn
      ),
      text: change.text,
      forceMoveMarkers: true
    })));
    
    state.isApplyingRemoteChanges = false;
  });

  // Receive full code override
  state.socket.on('code-override', ({ fullCode }) => {
    if (!state.editor || state.editMode === 'local') return;
    
    state.isApplyingRemoteChanges = true;
    state.editor.setValue(fullCode);
    state.isApplyingRemoteChanges = false;
    showToast('Workspace synchronized by collaborator.', 'info');
  });

  // Receive global execution indicators
  state.socket.on('global-run-start', ({ username }) => {
    if (state.editMode === 'local') return;
    
    const runBtn = document.getElementById('btn-run');
    const consoleOut = document.getElementById('console-output');
    
    // Auto shift view to runner console tab
    document.querySelector('.tab-btn[data-tab="runner"]').click();
    
    consoleOut.className = 'console-output running';
    consoleOut.textContent = `[Global Run] Initiated by ${username}...\nLaunching compiler runner process...\n`;
    runBtn.disabled = true;
    runBtn.innerHTML = '<span>Running...</span><i class="fa-solid fa-spinner fa-spin"></i>';
  });

  // Receive global execution results
  state.socket.on('global-run-result', (data) => {
    if (state.editMode === 'local') return;
    
    const runBtn = document.getElementById('btn-run');
    const consoleOut = document.getElementById('console-output');
    
    runBtn.disabled = false;
    runBtn.innerHTML = '<span>Run Code</span><i class="fa-solid fa-play"></i>';
    
    if (data.error === 'compiler_missing') {
      runMockSimulation(state.editor.getValue(), document.getElementById('console-stdin').value);
      return;
    }
    
    if (data.success) {
      consoleOut.className = 'console-output success';
      consoleOut.textContent = data.output || '(No console outputs)';
      showToast('Global execution completed.', 'success');
    } else {
      consoleOut.className = 'console-output error';
      consoleOut.textContent = data.output || 'Compiler execution error.';
      showToast('Global execution exited with error.', 'error');
    }
  });

  // Receive global SQL query run
  state.socket.on('global-sql-run', ({ sqlText, username }) => {
    if (state.editMode === 'local') return;
    
    showToast(`${username} executed a SQL query globally.`, 'info');
    // Execute query locally on client-side DB
    executeSQLQuery(sqlText);
  });
  
  // Receive cursor coordinates updates from peers
  state.socket.on('cursor-move', ({ userId, user, position, selection }) => {
    if (!state.editor || state.editMode === 'local') return;
    
    // Proactively inject user cursors styling rules
    injectUserStyleRules(userId, user.username, user.color);
    
    const oldDecorations = state.remoteCursors[userId] || [];
    const newDecorations = [];
    
    // Add remote cursor decoration
    if (position) {
      newDecorations.push({
        range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        options: {
          className: `remote-cursor-${userId}`,
          beforeContentClassName: `remote-cursor-label-${userId}`,
          hoverMessage: { value: `**${user.username}**` }
        }
      });
    }
    
    // Add selection highlights
    if (selection && (selection.startLineNumber !== selection.endLineNumber || selection.startColumn !== selection.endColumn)) {
      newDecorations.push({
        range: new monaco.Range(selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn),
        options: {
          className: `remote-selection-${userId}`
        }
      });
    }
    
    state.remoteCursors[userId] = state.editor.deltaDecorations(oldDecorations, newDecorations);
  });
  
  // Chat stream messages
  state.socket.on('chat-message', (msg) => {
    appendChatMessage(msg);
  });
}

// Render dynamic colored user avatar circles
function renderCollaboratorAvatars() {
  const container = document.getElementById('avatar-container');
  container.innerHTML = '';
  
  Object.entries(state.collaborators).forEach(([id, user]) => {
    const avatar = document.createElement('div');
    avatar.className = 'collab-avatar';
    avatar.style.backgroundColor = user.color;
    avatar.title = user.username + (id === state.selfId ? ' (You)' : '');
    
    // Initials
    const initials = user.username.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    avatar.textContent = initials || '?';
    
    container.appendChild(avatar);
  });
}

// Inject runtime CSS class overrides for custom Monaco decorations
function injectUserStyleRules(userId, username, color) {
  const styleId = `user-style-${userId}`;
  let styleEl = document.getElementById(styleId);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  
  // CSS mapping color to dynamic declarations
  styleEl.innerHTML = `
    .remote-cursor-${userId} {
      border-left: 2px solid ${color} !important;
      position: absolute;
      z-index: 10;
    }
    .remote-cursor-label-${userId}::before {
      content: "${username}";
      background-color: ${color};
      color: #000000;
      font-size: 9px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
      position: absolute;
      top: -16px;
      left: 0;
      white-space: nowrap;
      z-index: 20;
      pointer-events: none;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }
    .remote-selection-${userId} {
      background-color: ${color.replace(')', ', 0.18)').replace('hsl', 'hsla')} !important;
    }
  `;
}

// ==========================================================================
// MONACO EDITOR LOADER & CONFIG
// ==========================================================================
function initMonacoEditor(initialCode, language) {
  // Load editor assets using AMD loader config
  require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' } });
  
  require(['vs/editor/editor.main'], function () {
    const editorContainer = document.getElementById('editor-container');
    editorContainer.innerHTML = ''; // clear loading state
    
    // Map languages standard Monaco tokens
    const monacoLangs = { java: 'java', python: 'python', oracle: 'sql' };
    const currentEditorLang = monacoLangs[language] || 'plaintext';
    
    // Build Editor
    state.editor = monaco.editor.create(editorContainer, {
      value: initialCode,
      language: currentEditorLang,
      theme: 'vs-dark',
      fontFamily: 'Fira Code, Courier New, monospace',
      fontSize: 14,
      lineHeight: 22,
      fontLigatures: true,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollbar: {
        vertical: 'visible',
        horizontal: 'visible',
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8
      },
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      wordWrap: 'on',
      padding: { top: 12 }
    });
    
    // Listen for code changes (Local Typing)
    state.editor.onDidChangeModelContent((event) => {
      if (state.isApplyingRemoteChanges) return; // avoid looping echoes
      
      const fullCode = state.editor.getValue();
      
      // Emit changes to WebSockets backend if in Global Mode
      if (state.editMode === 'global') {
        state.socket.emit('code-change', {
          roomId: state.roomId,
          changes: event.changes,
          fullCode: fullCode
        });
      }
    });
    
    // Listen for cursor position adjustments
    state.editor.onDidChangeCursorPosition((e) => {
      if (state.editMode === 'global') {
        const selection = state.editor.getSelection();
        state.socket.emit('cursor-move', {
          roomId: state.roomId,
          position: e.position,
          selection: selection
        });
      }
    });
    
    // Listen for cursor selection selections
    state.editor.onDidChangeCursorSelection((e) => {
      if (state.editMode === 'global') {
        state.socket.emit('cursor-move', {
          roomId: state.roomId,
          position: state.editor.getPosition(),
          selection: e.selection
        });
      }
    });
  });
}

// ==========================================================================
// LIVE CHAT ROOM LOGIC
// ==========================================================================
document.getElementById('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const chatInput = document.getElementById('chat-input');
  const text = chatInput.value.trim();
  
  if (!text) return;
  
  // Emit to socket
  state.socket.emit('chat-message', {
    roomId: state.roomId,
    text: text
  });
  
  chatInput.value = '';
});

// Append regular chat text bubbles
function appendChatMessage(msg) {
  const chatMessages = document.getElementById('chat-messages');
  const isSelf = msg.userId === state.selfId;
  
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isSelf ? 'chat-bubble-self' : ''}`;
  
  bubble.innerHTML = `
    <div class="chat-bubble-header">
      <span class="chat-user" style="color: ${isSelf ? '#a7f3d0' : msg.color}">${msg.username}</span>
      <span class="chat-time">${msg.time}</span>
    </div>
    <div class="chat-text">${escapeHTML(msg.text)}</div>
  `;
  
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight; // autoscroll
}

// Append system connection logs (joined/left)
function appendChatLog(text) {
  const chatMessages = document.getElementById('chat-messages');
  const eventLog = document.createElement('div');
  eventLog.className = 'chat-log-event';
  eventLog.textContent = text;
  
  chatMessages.appendChild(eventLog);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Helper utility to sanitize HTML
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// ==========================================================================
// CODE COMPILATION RUNNER
// ==========================================================================
document.getElementById('btn-run').addEventListener('click', () => {
  const runBtn = document.getElementById('btn-run');
  const consoleOut = document.getElementById('console-output');
  
  if (!state.editor) return;
  
  const code = state.editor.getValue();
  const stdin = document.getElementById('console-stdin').value;
  
  // SQL evaluation override
  if (state.language === 'oracle') {
    if (state.editMode === 'local') {
      executeSQLQuery(code);
    } else {
      executeSQLQuery(code);
      // Broadcast SQL run statement to all other peers
      state.socket.emit('run-sql', { roomId: state.roomId, sqlText: code });
    }
    return;
  }
  
  // If running code globally, emit websocket trigger instead of calling fetch directly
  if (state.editMode === 'global') {
    state.socket.emit('run-code', {
      roomId: state.roomId,
      code: code,
      stdin: stdin,
      language: state.language
    });
    return;
  }
  
  // Set console visually running
  consoleOut.className = 'console-output running';
  consoleOut.textContent = 'Launching compiler runner process...\n';
  runBtn.disabled = true;
  runBtn.innerHTML = '<span>Running...</span><i class="fa-solid fa-spinner fa-spin"></i>';
  
  // Trigger Server compilation
  fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, language: state.language, stdin })
  })
  .then(res => res.json())
  .then(data => {
    runBtn.disabled = false;
    runBtn.innerHTML = '<span>Run Code</span><i class="fa-solid fa-play"></i>';
    
    if (data.error === 'compiler_missing') {
      // Execute mock program simulation locally
      runMockSimulation(code, stdin);
      return;
    }
    
    if (data.success) {
      consoleOut.className = 'console-output success';
      consoleOut.textContent = data.output || '(No console outputs)';
      showToast('Execution completed successfully.', 'success');
    } else {
      consoleOut.className = 'console-output error';
      consoleOut.textContent = data.output || 'Compiler execution error.';
      showToast('Program exited with error codes.', 'error');
    }
  })
  .catch(err => {
    runBtn.disabled = false;
    runBtn.innerHTML = '<span>Run Code</span><i class="fa-solid fa-play"></i>';
    
    // Server execution errored / disconnected, fallback to simulated run
    runMockSimulation(code, stdin, true);
  });
});

// Mock simulation of runtime code (used when local compilers are missing or server is offline)
function runMockSimulation(code, stdin, isOffline = false) {
  const consoleOut = document.getElementById('console-output');
  consoleOut.className = 'console-output success';
  
  let simulatedOutput = '';
  
  if (isOffline) {
    simulatedOutput += `[System Notice: Collaborative backend server is offline or unreachable]\n`;
    simulatedOutput += `[Simulating execution logs inside offline sandboxed context]\n\n`;
  } else {
    simulatedOutput += `[System Notice: Local compiler is not set up on this server environment]\n`;
    simulatedOutput += `[Simulating execution logs inside sandboxed context]\n\n`;
  }
  
  // Let's run a mock analysis of the code
  if (state.language === 'python') {
    // Basic python simulator checks
    if (code.includes('print(')) {
      // Extract print statements
      const prints = code.match(/print\((['"])(.*?)\1\)/g);
      if (prints) {
        simulatedOutput += `>>> python3 main.py\n`;
        prints.forEach(p => {
          const content = p.match(/print\((['"])(.*?)\1\)/)[2];
          simulatedOutput += `${content}\n`;
        });
      } else {
        simulatedOutput += `>>> python3 main.py\n(Executed successfully. Returned exit code 0)`;
      }
    } else {
      simulatedOutput += `>>> python3 main.py\n(No print statements detected. Python program executed successfully.)`;
    }
  } else if (state.language === 'java') {
    // Basic java simulator checks
    if (code.includes('System.out.println(')) {
      const prints = code.match(/System\.out\.println\((['"])(.*?)\1\)/g);
      if (prints) {
        simulatedOutput += `$ javac Main.java\n$ java Main\n`;
        prints.forEach(p => {
          const content = p.match(/System\.out\.println\((['"])(.*?)\1\)/)[2];
          simulatedOutput += `${content}\n`;
        });
      } else {
        simulatedOutput += `$ javac Main.java\n$ java Main\n(Java class Main executed successfully)`;
      }
    } else {
      simulatedOutput += `$ javac Main.java\n$ java Main\n(Class Main compiled and executed successfully)`;
    }
  }
  
  consoleOut.textContent = simulatedOutput;
  showToast('Execution simulation complete.', 'success');
}

// ==========================================================================
// ORACLE DATABASE CLIENT ENGINE (SQLITE WASM PORT)
// ==========================================================================
function initOracleDB() {
  const schemaTree = document.getElementById('schema-tree');
  schemaTree.innerHTML = '<div class="chat-status"><i class="fa-solid fa-spinner fa-spin"></i> Initializing db...</div>';
  
  // Config locate file for sqlite WASM loaded from public CDNs
  initSqlJs({
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
  }).then(SQL => {
    state.db = new SQL.Database();
    
    // Seed Database tables
    resetDatabaseSchema();
    
    // Setup Database Schema diagrams list
    renderDBSchemaTree();
    
    showToast('Oracle HR Virtual Database loaded successfully.', 'success');
  }).catch(err => {
    console.error(err);
    schemaTree.innerHTML = '<div class="text-warning"><i class="fa-solid fa-triangle-exclamation"></i> Error loading DB WASM</div>';
    showToast('Failed to initialize WebAssembly Relational Database.', 'error');
  });
}

function resetDatabaseSchema() {
  if (!state.db) return;
  
  // Create tables mimicking Oracle's schema structures
  state.db.run(`
    DROP TABLE IF EXISTS employees;
    DROP TABLE IF EXISTS departments;
    DROP TABLE IF EXISTS jobs;
    DROP TABLE IF EXISTS locations;
    
    CREATE TABLE locations (
      location_id INTEGER PRIMARY KEY,
      street_address VARCHAR(40),
      postal_code VARCHAR(12),
      city VARCHAR(30) NOT NULL,
      state_province VARCHAR(25),
      country_id CHAR(2)
    );
    
    CREATE TABLE jobs (
      job_id VARCHAR(10) PRIMARY KEY,
      job_title VARCHAR(35) NOT NULL,
      min_salary NUMERIC(6),
      max_salary NUMERIC(6)
    );
    
    CREATE TABLE departments (
      department_id INTEGER PRIMARY KEY,
      department_name VARCHAR(30) NOT NULL,
      manager_id INTEGER,
      location_id INTEGER,
      FOREIGN KEY (location_id) REFERENCES locations(location_id)
    );
    
    CREATE TABLE employees (
      employee_id INTEGER PRIMARY KEY,
      first_name VARCHAR(20),
      last_name VARCHAR(25) NOT NULL,
      email VARCHAR(25) NOT NULL,
      hire_date DATE,
      job_id VARCHAR(10),
      salary NUMERIC(8,2),
      department_id INTEGER,
      FOREIGN KEY (job_id) REFERENCES jobs(job_id),
      FOREIGN KEY (department_id) REFERENCES departments(department_id)
    );
  `);
  
  // Seed Locations
  state.db.run(`
    INSERT INTO locations VALUES (1400, '2014 Jabberwocky Rd', '26192', 'Southlake', 'Texas', 'US');
    INSERT INTO locations VALUES (1500, '2011 Interiors Blvd', '99236', 'South San Francisco', 'California', 'US');
    INSERT INTO locations VALUES (1700, '2004 Charade Rd', '98199', 'Seattle', 'Washington', 'US');
    INSERT INTO locations VALUES (1800, '147 Spadina Ave', 'M5V 2L7', 'Toronto', 'Ontario', 'CA');
    INSERT INTO locations VALUES (2500, 'Magdalen Centre, The Oxford Science Park', 'OX4 4GA', 'Oxford', 'Oxfordshire', 'UK');
  `);
  
  // Seed Jobs
  state.db.run(`
    INSERT INTO jobs VALUES ('AD_PRES', 'President', 20080, 40000);
    INSERT INTO jobs VALUES ('AD_VP', 'Administration Vice President', 15000, 30000);
    INSERT INTO jobs VALUES ('IT_PROG', 'Programmer', 4000, 10000);
    INSERT INTO jobs VALUES ('SA_MAN', 'Sales Manager', 10000, 20080);
    INSERT INTO jobs VALUES ('SA_REP', 'Sales Representative', 6000, 12008);
    INSERT INTO jobs VALUES ('ST_CLERK', 'Stock Clerk', 2008, 5000);
  `);
  
  // Seed Departments
  state.db.run(`
    INSERT INTO departments VALUES (10, 'Administration', 200, 1700);
    INSERT INTO departments VALUES (20, 'Marketing', 201, 1800);
    INSERT INTO departments VALUES (50, 'Shipping', 121, 1500);
    INSERT INTO departments VALUES (60, 'IT', 103, 1400);
    INSERT INTO departments VALUES (80, 'Sales', 145, 2500);
    INSERT INTO departments VALUES (90, 'Executive', 100, 1700);
  `);
  
  // Seed Employees
  state.db.run(`
    INSERT INTO employees VALUES (100, 'Steven', 'King', 'SKING', '2013-06-17', 'AD_PRES', 24000.00, 90);
    INSERT INTO employees VALUES (101, 'Neena', 'Kochhar', 'NKOCHHAR', '2015-09-21', 'AD_VP', 17000.00, 90);
    INSERT INTO employees VALUES (102, 'Lex', 'De Haan', 'LDEHAAN', '2011-01-13', 'AD_VP', 17000.00, 90);
    INSERT INTO employees VALUES (103, 'Alexander', 'Hunold', 'AHUNOLD', '2016-01-03', 'IT_PROG', 9000.00, 60);
    INSERT INTO employees VALUES (104, 'Bruce', 'Ernst', 'BERNST', '2017-05-21', 'IT_PROG', 6000.00, 60);
    INSERT INTO employees VALUES (105, 'David', 'Austin', 'DAUSTIN', '2015-06-25', 'IT_PROG', 4800.00, 60);
    INSERT INTO employees VALUES (106, 'Valli', 'Pataballa', 'VPATABAL', '2016-02-05', 'IT_PROG', 4800.00, 60);
    INSERT INTO employees VALUES (107, 'Diana', 'Lorentz', 'DLORENTZ', '2017-02-07', 'IT_PROG', 4200.00, 60);
    INSERT INTO employees VALUES (120, 'Matthew', 'Weiss', 'MWEISS', '2014-07-18', 'ST_CLERK', 8000.00, 50);
    INSERT INTO employees VALUES (121, 'Adam', 'Fripp', 'AFRIPP', '2015-04-10', 'ST_CLERK', 8200.00, 50);
    INSERT INTO employees VALUES (122, 'Payam', 'Kaufling', 'PKAUFLIN', '2013-05-01', 'ST_CLERK', 7900.00, 50);
    INSERT INTO employees VALUES (145, 'John', 'Russell', 'JRUSSEL', '2014-10-01', 'SA_MAN', 14000.00, 80);
    INSERT INTO employees VALUES (149, 'Eleni', 'Zlotkey', 'EZLOTKEY', '2018-01-29', 'SA_MAN', 10500.00, 80);
    INSERT INTO employees VALUES (174, 'Ellen', 'Abel', 'EABEL', '2014-05-11', 'SA_REP', 11000.00, 80);
    INSERT INTO employees VALUES (176, 'Jonathon', 'Taylor', 'JTAYLOR', '2016-03-24', 'SA_REP', 8600.00, 80);
    INSERT INTO employees VALUES (178, 'Kimberely', 'Grant', 'KGRANT', '2017-05-24', 'SA_REP', 7000.00, 80);
  `);
}

function renderDBSchemaTree() {
  if (!state.db) return;
  const treeContainer = document.getElementById('schema-tree');
  treeContainer.innerHTML = '';
  
  // Tables to inspect
  const tables = ['EMPLOYEES', 'DEPARTMENTS', 'JOBS', 'LOCATIONS'];
  
  tables.forEach(tableName => {
    const node = document.createElement('div');
    node.className = 'schema-table-node';
    
    node.innerHTML = `
      <div class="schema-table-name"><i class="fa-solid fa-table"></i> ${tableName}</div>
      <div class="schema-column-list" id="schema-cols-${tableName.toLowerCase()}"></div>
    `;
    treeContainer.appendChild(node);
    
    // Query sqlite table columns info
    try {
      const res = state.db.exec(`PRAGMA table_info(${tableName.toLowerCase()});`);
      if (res.length > 0) {
        const columns = res[0].values;
        const colContainer = document.getElementById(`schema-cols-${tableName.toLowerCase()}`);
        
        columns.forEach(col => {
          const colName = col[1];
          const colType = col[2];
          const isPk = col[5] === 1;
          
          const colItem = document.createElement('div');
          colItem.className = 'schema-column-item';
          colItem.innerHTML = `
            <span>${colName} ${isPk ? '<i class="fa-solid fa-key text-warning" style="font-size:0.6rem"></i>' : ''}</span>
            <span class="schema-col-type">${colType}</span>
          `;
          colContainer.appendChild(colItem);
        });
      }
    } catch (e) {
      console.error(e);
    }
  });
}

// Reset Database Trigger
document.getElementById('btn-reset-db').addEventListener('click', () => {
  if (confirm('Restoring default Oracle DB tables will discard your current SQLite modifications (updates, inserts, drops). Proceed?')) {
    resetDatabaseSchema();
    renderDBSchemaTree();
    
    const wrapper = document.getElementById('db-results-wrapper');
    wrapper.innerHTML = `
      <div class="db-results-placeholder">
        <i class="fa-solid fa-table"></i>
        <p>Database schema reset! Run a SQL query in the editor to view results here.</p>
      </div>
    `;
    
    document.getElementById('db-query-status').className = 'db-query-status-ok';
    document.getElementById('db-query-status').textContent = 'Database Schema Reset Complete';
    showToast('Database reset to baseline HR schema.', 'info');
  }
});

// Run virtual Oracle DB SQL query
function executeSQLQuery(sqlText) {
  const runBtn = document.getElementById('btn-run');
  const resultsWrapper = document.getElementById('db-results-wrapper');
  const statusLabel = document.getElementById('db-query-status');
  
  if (!state.db) {
    showToast('Database engine is still compiling...', 'warning');
    return;
  }
  
  // Shift UI active tab focus to DB Explorer automatically
  document.querySelector('.tab-btn[data-tab="schema"]').click();
  
  runBtn.disabled = true;
  runBtn.innerHTML = '<span>Running Query...</span><i class="fa-solid fa-spinner fa-spin"></i>';
  
  setTimeout(() => {
    try {
      // Execute query using sql.js
      const res = state.db.exec(sqlText);
      
      runBtn.disabled = false;
      runBtn.innerHTML = '<span>Run Code</span><i class="fa-solid fa-play"></i>';
      
      if (res.length === 0) {
        // Query completed without returning data (e.g. UPDATE, INSERT, DELETE)
        resultsWrapper.innerHTML = `
          <div class="db-results-placeholder">
            <i class="fa-solid fa-circle-check text-success" style="font-size:2rem"></i>
            <p>Statement executed successfully. Database state updated.</p>
          </div>
        `;
        statusLabel.className = 'db-query-status-ok';
        statusLabel.textContent = 'Query OK (0 rows returned)';
        showToast('SQL statement executed.', 'success');
        
        // Refresh tree schema in case they made DDL modifications
        renderDBSchemaTree();
        return;
      }
      
      // Query returned table format data (e.g. SELECT)
      const columns = res[0].columns;
      const rows = res[0].values;
      
      statusLabel.className = 'db-query-status-ok';
      statusLabel.textContent = `Query OK (${rows.length} rows returned)`;
      
      // Generate clean visual HTML Table grid
      let tableHtml = '<table class="db-data-table"><thead><tr>';
      columns.forEach(col => {
        tableHtml += `<th>${col.toUpperCase()}</th>`;
      });
      tableHtml += '</tr></thead><tbody>';
      
      rows.forEach(row => {
        tableHtml += '<tr>';
        row.forEach(val => {
          const displayVal = val === null ? '<span class="text-muted">NULL</span>' : escapeHTML(String(val));
          tableHtml += `<td>${displayVal}</td>`;
        });
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody></table>';
      
      resultsWrapper.innerHTML = tableHtml;
      showToast(`Selected ${rows.length} rows from database.`, 'success');
      
    } catch (err) {
      runBtn.disabled = false;
      runBtn.innerHTML = '<span>Run Code</span><i class="fa-solid fa-play"></i>';
      
      statusLabel.className = 'db-query-status-err';
      statusLabel.textContent = 'SQL Compilation Error';
      
      resultsWrapper.innerHTML = `
        <div class="console-output error" style="margin:16px; border-radius:8px">
          <strong><i class="fa-solid fa-circle-xmark"></i> Oracle SQL Syntax Error:</strong>
          <pre style="margin-top:8px; white-space:pre-wrap">${escapeHTML(err.message)}</pre>
        </div>
      `;
      showToast('SQL query failed with syntax error.', 'error');
    }
  }, 300); // add a micro-delay so the run action feels interactive
}
