https://lavenderblush-lark-407478.hostingersite.com
# WebChat - Servidor de Chat en Tiempo Real

Un servidor de chat en tiempo real construido con Python WebSockets y una interfaz web moderna.

## �� Características

- **Chat en tiempo real** usando WebSockets
- **Mensajes privados** entre usuarios
- **Mensajes grupales** para todos los conectados
- **Lista de usuarios** conectados en tiempo real
- **Interfaz de consola** con colores y tablas (Rich)
- **Soporte SSL/TLS** para conexiones seguras

## 📋 Requisitos

- Python 3.7 o superior
- pip (gestor de paquetes de Python)

## ��️ Instalación

### 1. Clonar el repositorio
```bash
git clone <tu-repositorio>
cd Webchat-3
```

### 2. Crear entorno virtual
```bash
# Crear entorno virtual
python -m venv venv

# Activar entorno virtual
# En Windows:
venv\Scripts\activate
# En Linux/Mac:
source venv/bin/activate
```

### 3. Instalar dependencias
```bash
pip install -r requirements.txt
```

## �� Uso

### 1. Configurar certificados SSL (opcional)
Si quieres usar SSL, coloca tus certificados en la raíz del proyecto:
- `cert.pem` - Certificado SSL
- `key.pem` - Clave privada SSL

### 2. Ejecutar el servidor
```bash
python server_ws.py
```

El servidor se ejecutará en:
- **Sin SSL**: `ws://localhost:24454`
- **Con SSL**: `wss://localhost:24454`

### 3. Conectar clientes
Abre `client/index.html` en tu navegador o conecta clientes WebSocket al servidor.

