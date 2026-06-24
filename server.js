const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Port configuration
const PORT = process.env.PORT || 3000;

// Room state in-memory database
// roomId -> { code: string, language: string, users: { socketId: { username: string, color: string } } }
const rooms = {};

// Visual color palette for user cursors (highly visible neon HSL)
const USER_COLORS = [
  'hsl(263, 90%, 65%)',  // Violet
  'hsl(162, 84%, 48%)',  // Emerald
  'hsl(38, 92%, 50%)',   // Amber
  'hsl(329, 86%, 56%)',  // Pink
  'hsl(199, 89%, 48%)',  // Sky Blue
  'hsl(271, 91%, 65%)',  // Purple
  'hsl(32, 98%, 56%)',   // Orange
  'hsl(79, 78%, 46%)'    // Lime Green
];

// Initial templates for each IDE type
const TEMPLATES = {
  java: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, collaborative Java workspace!");
        // Your code here
        for (int i = 1; i <= 5; i++) {
            System.out.println("Step " + i);
        }
    }
}`,
  python: `def main():
    print("Hello, collaborative Python workspace!")
    # Your code here
    for i in range(1, 6):
        print(f"Step {i}")

if __name__ == "__main__":
    main()`,
  oracle: `-- Oracle SQL Workspace
-- Explore tables (EMPLOYEES, DEPARTMENTS, JOBS, LOCATIONS) in the DB schema explorer on the right!

SELECT e.employee_id, e.first_name, e.last_name, e.salary, d.department_name
FROM employees e
JOIN departments d ON e.department_id = d.department_id
WHERE e.salary > 6000
ORDER BY e.salary DESC;`
};

// Check if a command is available locally
function isCommandAvailable(cmd) {
  return new Promise((resolve) => {
    const check = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd]);
    check.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

// Compile and run Java code
function runJava(code, stdin) {
  return new Promise((resolve) => {
    // Determine class name (defaults to Main)
    const match = code.match(/public\s+class\s+(\w+)/);
    const className = match ? match[1] : 'Main';
    
    const runId = Math.random().toString(36).substring(2, 9);
    const tempDir = path.join(__dirname, 'scratch', `run_${runId}`);
    
    // Create temporary run directory
    fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `${className}.java`);
    fs.writeFileSync(filePath, code);
    
    // Compile Java file
    const javac = spawn('javac', [`${className}.java`], { cwd: tempDir });
    let compileErr = '';
    
    javac.stderr.on('data', (data) => {
      compileErr += data.toString();
    });
    
    javac.on('close', (codeVal) => {
      if (codeVal !== 0) {
        // Cleanup and resolve compilation error
        fs.rmSync(tempDir, { recursive: true, force: true });
        return resolve({ success: false, output: compileErr || 'Compilation failed.' });
      }
      
      // Run compiled Java program
      const javaProcess = spawn('java', [className], { cwd: tempDir });
      let stdout = '';
      let stderr = '';
      
      if (stdin) {
        javaProcess.stdin.write(stdin);
        javaProcess.stdin.end();
      }
      
      // Timeout guard (5 seconds)
      const timeout = setTimeout(() => {
        javaProcess.kill();
        resolve({ success: false, output: 'Execution timed out (Limit: 5s).' });
      }, 5000);
      
      javaProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      javaProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      javaProcess.on('close', () => {
        clearTimeout(timeout);
        // Clean directory
        fs.rmSync(tempDir, { recursive: true, force: true });
        resolve({
          success: stderr === '',
          output: stderr !== '' ? stderr : stdout
        });
      });
    });
  });
}

// Run Python code
function runPython(code, stdin) {
  return new Promise((resolve) => {
    const runId = Math.random().toString(36).substring(2, 9);
    const scratchDir = path.join(__dirname, 'scratch');
    fs.mkdirSync(scratchDir, { recursive: true });
    
    const filePath = path.join(scratchDir, `temp_${runId}.py`);
    fs.writeFileSync(filePath, code);
    
    // Spawn python process
    // On Windows, python is usually 'python', sometimes 'py' or 'python3'
    const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
    const pyProcess = spawn(pyCmd, [filePath]);
    let stdout = '';
    let stderr = '';
    
    if (stdin) {
      pyProcess.stdin.write(stdin);
      pyProcess.stdin.end();
    }
    
    // Timeout guard (5 seconds)
    const timeout = setTimeout(() => {
      pyProcess.kill();
      resolve({ success: false, output: 'Execution timed out (Limit: 5s).' });
    }, 5000);
    
    pyProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pyProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    pyProcess.on('close', () => {
      clearTimeout(timeout);
      // Clean temp file
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      resolve({
        success: stderr === '',
        output: stderr !== '' ? stderr : stdout
      });
    });
  });
}

// REST Endpoint to execute scripts
app.post('/api/run', async (req, res) => {
  const { code, language, stdin } = req.body;
  if (!code || !language) {
    return res.status(400).json({ error: 'Missing code or language' });
  }
  
  if (language === 'python') {
    const hasPython = await isCommandAvailable('python') || await isCommandAvailable('python3');
    if (!hasPython) {
      return res.json({ 
        error: 'compiler_missing', 
        message: 'Python is not installed or not in PATH on this server. Running in mock-simulation mode.' 
      });
    }
    const result = await runPython(code, stdin);
    return res.json(result);
  } else if (language === 'java') {
    const hasJavac = await isCommandAvailable('javac');
    if (!hasJavac) {
      return res.json({ 
        error: 'compiler_missing', 
        message: 'Java Compiler (javac) is not installed or not in PATH on this server. Running in mock-simulation mode.' 
      });
    }
    const result = await runJava(code, stdin);
    return res.json(result);
  } else {
    return res.status(400).json({ error: 'Language not supported for backend execution' });
  }
});

// Socket.io Real-time connection management
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;
  
  // When a user requests to join a room
  socket.on('join-room', ({ roomId, username, language }) => {
    currentRoom = roomId;
    currentUser = username;
    
    // Create room state if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        code: TEMPLATES[language] || '',
        language: language,
        users: {}
      };
    }
    
    // Allocate a random distinct color from our palette
    const colorIndex = Object.keys(rooms[roomId].users).length % USER_COLORS.length;
    const userColor = USER_COLORS[colorIndex];
    
    // Save user details
    rooms[roomId].users[socket.id] = {
      username: username,
      color: userColor
    };
    
    socket.join(roomId);
    
    // Send state back to the newly connected user
    socket.emit('room-state', {
      code: rooms[roomId].code,
      language: rooms[roomId].language,
      users: rooms[roomId].users,
      selfId: socket.id
    });
    
    // Notify other users in the room
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      user: rooms[roomId].users[socket.id]
    });
  });
  
  // When code changes in Monaco
  socket.on('code-change', ({ roomId, changes, fullCode }) => {
    if (rooms[roomId]) {
      rooms[roomId].code = fullCode; // Keep server buffer in sync
      socket.to(roomId).emit('code-change', { changes });
    }
  });

  // Force sync entire code buffer (e.g. on Local -> Global switch)
  socket.on('sync-full-code', ({ roomId, fullCode }) => {
    if (rooms[roomId]) {
      rooms[roomId].code = fullCode;
      socket.to(roomId).emit('code-override', { fullCode });
    }
  });

  // Collaborate global runs (Java/Python)
  socket.on('run-code', async ({ roomId, code, stdin, language }) => {
    if (!rooms[roomId]) return;
    
    // Broadcast starting loader state to all clients in the room
    io.in(roomId).emit('global-run-start', { username: rooms[roomId].users[socket.id]?.username || 'Collaborator' });
    
    let result = { success: false, output: '' };
    
    if (language === 'python') {
      const hasPython = await isCommandAvailable('python') || await isCommandAvailable('python3');
      if (!hasPython) {
        result = { error: 'compiler_missing' };
      } else {
        result = await runPython(code, stdin);
      }
    } else if (language === 'java') {
      const hasJavac = await isCommandAvailable('javac');
      if (!hasJavac) {
        result = { error: 'compiler_missing' };
      } else {
        result = await runJava(code, stdin);
      }
    }
    
    // Broadcast compile outcome to all clients in the room
    io.in(roomId).emit('global-run-result', result);
  });

  // Collaborative SQL execution (broadcasts statement to run locally on all SQLite engines)
  socket.on('run-sql', ({ roomId, sqlText }) => {
    if (rooms[roomId]) {
      // Broadcast to other users to execute in their local SQL sandbox
      socket.to(roomId).emit('global-sql-run', {
        sqlText,
        username: rooms[roomId].users[socket.id]?.username || 'Collaborator'
      });
    }
  });
  
  // When a cursor or selection moves
  socket.on('cursor-move', ({ roomId, position, selection }) => {
    if (rooms[roomId] && rooms[roomId].users[socket.id]) {
      socket.to(roomId).emit('cursor-move', {
        userId: socket.id,
        user: rooms[roomId].users[socket.id],
        position,
        selection
      });
    }
  });
  
  // When a chat message is sent
  socket.on('chat-message', ({ roomId, text }) => {
    if (rooms[roomId] && rooms[roomId].users[socket.id]) {
      const user = rooms[roomId].users[socket.id];
      const message = {
        userId: socket.id,
        username: user.username,
        color: user.color,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      
      io.in(roomId).emit('chat-message', message);
    }
  });
  
  // On client disconnect
  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const user = rooms[currentRoom].users[socket.id];
      delete rooms[currentRoom].users[socket.id];
      
      // Notify remaining users
      socket.to(currentRoom).emit('user-left', {
        userId: socket.id,
        username: user ? user.username : 'Someone'
      });
      
      // Clean up room if completely empty
      if (Object.keys(rooms[currentRoom].users).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`   Nexus Collaborative IDE Server is Running!     `);
  console.log(`   URL: http://localhost:${PORT}                  `);
  console.log(`==================================================`);
});
