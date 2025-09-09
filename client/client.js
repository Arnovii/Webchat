// client.js
// Cambia WS_URL por tu servidor, o deja en blanco y escribe la URL en la UI.
let WS_URL = ""; // opcional: "ws://mi_dominio:9000" o "wss://mi_dominio"

let ws = null;
let myId = null;
let clients = {}; // id -> {name, ip, port}
let selectedUserName = ""; // almacena el nombre del usuario seleccionado


const nameInput = document.getElementById("nameInput");
const serverInput = document.getElementById("serverInput");
// Sugerir wss:// en el placeholder si la web está en https y puerto correcto
if (window.location.protocol === "https:") {
  serverInput.placeholder = "wss://localhost:24454";
}
const connectBtn = document.getElementById("connectBtn");
const statusSpan = document.getElementById("status");
const usersList = document.getElementById("usersList");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const fileInput = document.getElementById("fileInput");
const attachBtn = document.getElementById("attachBtn");
const sendBtn = document.getElementById("sendBtn");
const privateTargetSpan = document.getElementById("privateTarget");

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function appendMsg(html) {
  const d = document.createElement("div");
  d.className = "msg";
  d.innerHTML = html;
  messagesDiv.appendChild(d);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function renderUsers() {
  usersList.innerHTML = "";
  Object.entries(clients).forEach(([id, c]) => {
    const li = document.createElement("li");
    li.textContent = `${c.name} (${id}) @ ${c.ip}:${c.port}`;
    li.dataset.id = id;
    
    // Destacar y deshabilitar si es el usuario actual
    if (id === myId) {
      li.classList.add("current-user");
      li.title = "Este eres tú";
    } else {
      li.onclick = () => {
        // seleccionar como objetivo privado
        document.querySelector("input[name=mode][value=private]").checked = true;
        privateTargetSpan.textContent = ` -> ${c.name} (${id})`;
        privateTargetSpan.dataset.target = id;
        selectedUserName = c.name; // <<< aquí se guarda el nombre seleccionado
      };
    }
    usersList.appendChild(li);
  });
}

connectBtn.onclick = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    return;
  }
  const name = nameInput.value.trim() || "Anon";
  let url = (WS_URL && WS_URL.length) ? WS_URL : (serverInput.value.trim() || null);
  if (!url) {
    alert("Especifica la URL del WebSocket (ej: wss://localhost:24454)");
    return;
  }
  // Si la web está en https, forzar wss://
  if (window.location.protocol === "https:" && url.startsWith("ws://")) {
    url = "wss://" + url.slice(5);
  }
  if (window.location.protocol === "https:" && !url.startsWith("wss://")) {
    url = url.replace(/^ws:\/\//, "wss://");
    if (!url.startsWith("wss://")) url = "wss://" + url.replace(/^.*?:\/\//, "");
  }
  try {
    ws = new WebSocket(url);
  } catch (err) {
    alert("URL de WebSocket inválida: " + url);
    statusSpan.textContent = "Error URL";
    return;
  }
  statusSpan.textContent = "Conectando...";
  ws.onopen = () => {
    statusSpan.textContent = "Conectado";
    connectBtn.textContent = "Desconectar";
    // enviar registro
    ws.send(JSON.stringify({type: "register", name}));
    appendMsg(`<div class="meta">[sistema] conectado al servidor</div>`);
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      handleMessage(msg);
    } catch (e) {
      console.error("Mensaje no JSON:", ev.data);
    }
  };
  ws.onclose = () => {
    statusSpan.textContent = "Desconectado";
    connectBtn.textContent = "Conectar";
    appendMsg(`<div class="meta">[sistema] desconectado</div>`);
    clients = {};
    renderUsers();
    myId = null;
    privateTargetSpan.textContent = "";
    privateTargetSpan.dataset.target = "";
  };
  ws.onerror = (e) => {
    statusSpan.textContent = "Error";
    appendMsg(`<div class='meta'>[error] No se pudo conectar a ${url}. ¿Servidor activo? ¿Certificado válido? ¿Puerto correcto?</div>`);
    console.error("WebSocket error:", e);
  };
};

function handleMessage(msg) {
  switch (msg.type) {
    case "registered":
      myId = msg.id;
      appendMsg(`<div class="meta">[sistema] registrado como ${myId}</div>`);
      break;
    case "list":
      clients = {};
      msg.clients.forEach(c => clients[c.id] = c);
      renderUsers();
      break;
    case "message":
      const isSender = msg.from === myId;
      const d = document.createElement("div");
      d.className = `msg ${isSender ? 'sent' : 'received'}`;
      
      const isFile = msg.file != null;
      if (msg.group) {
        d.innerHTML = `
          <div class="meta">[GRUPO] ${isSender ? 'Tú' : msg.name}</div>
          ${isFile ? renderFile(msg.file) : `<div class="text">${escapeHtml(msg.text)}</div>`}
        `;
      } else {
        // Para mensajes privados, usamos el nombre del destinatario o remitente según corresponda
        const otherUser = isSender ? (selectedUserName || clients[msg.to]?.name || 'desconocido') : msg.name;

        d.innerHTML = `
          <div class="meta">[PRIVADO] ${isSender ? `Tú → ${otherUser}` : `${otherUser} → Tú`}</div>
          ${isFile ? renderFile(msg.file) : `<div class="text">${escapeHtml(msg.text)}</div>`}
        `;
      }
      messagesDiv.appendChild(d);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      break;
    case "info":
      appendMsg(`<div class="meta">[info] ${escapeHtml(msg.message)}</div>`);
      break;
    case "error":
      appendMsg(`<div class="meta">[error] ${escapeHtml(msg.message)}</div>`);
      break;
    default:
      appendMsg(`<div class="meta">[raw] ${escapeHtml(JSON.stringify(msg))}</div>`);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

function renderFile(file) {
  // Si es una imagen, mostrarla directamente
  if (file.type.startsWith('image/')) {
    return `
      <div class="text">
        <img src="${file.data}" style="max-width: 100%; max-height: 300px; border-radius: 0.5rem;" />
        <a class="file-attachment" href="${file.data}" download="${escapeHtml(file.name)}" style="color: white;">
          <i class="fas fa-download"></i>${escapeHtml(file.name)} (${formatFileSize(file.size)})
        </a>
      </div>
    `;
  }
  
  // Para otros tipos de archivo, mostrar un enlace de descarga
  return `
    <div class="text">
      <a class="file-attachment" href="${file.data}" download="${escapeHtml(file.name)}" style="color: white;">
        <i class="fas fa-file"></i>${escapeHtml(file.name)} (${formatFileSize(file.size)})
      </a>
    </div>
  `;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

sendBtn.onclick = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert("No conectado!");
    return;
  }
  const text = messageInput.value.trim();
  if (!text) return;
  const mode = document.querySelector("input[name=mode]:checked").value;
  if (mode === "group") {
    ws.send(JSON.stringify({type: "group", text}));
  } else {
    const to = privateTargetSpan.dataset.target;
    if (!to) {
      alert("Selecciona un usuario para enviarle privado (clic en la lista).");
      return;
    }
    ws.send(JSON.stringify({type: "private", to, text}));
  }
  messageInput.value = "";
};

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

// Manejador para el botón de adjuntar
attachBtn.onclick = () => fileInput.click();

// Función para convertir archivo a base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// Manejador para cuando se selecciona un archivo
fileInput.onchange = async () => {
  const file = fileInput.files[0];
  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    alert("El archivo es demasiado grande. Máximo 5MB.");
    fileInput.value = "";
    return;
  }

    try {
      // Mostrar mensaje de carga
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'msg';
      loadingDiv.innerHTML = `
        <div class="meta">[sistema] Cargando archivo ${file.name} (${formatFileSize(file.size)})...</div>
      `;
      messagesDiv.appendChild(loadingDiv);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;

      const base64 = await fileToBase64(file);
      const mode = document.querySelector("input[name=mode]:checked").value;
      
      // Remover mensaje de carga
      messagesDiv.removeChild(loadingDiv);
      
      const message = {
        type: mode,
        file: {
          name: file.name,
          type: file.type,
          size: file.size,
          data: base64
        }
      };    if (mode === "private") {
      const to = privateTargetSpan.dataset.target;
      if (!to) {
        alert("Selecciona un usuario para enviarle el archivo (clic en la lista).");
        return;
      }
      message.to = to;
    }

    ws.send(JSON.stringify(message));
    fileInput.value = "";
  } catch (error) {
    console.error("Error al procesar el archivo:", error);
    alert("Error al procesar el archivo");
  }
};