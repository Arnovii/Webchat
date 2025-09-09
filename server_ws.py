# server_ws.py (fix: handler acepta path opcional, no limpia consola cada vez)

import asyncio
import json
import uuid
import traceback
from typing import Dict, Any, Optional
import ssl
import websockets
from websockets import exceptions
from rich import print
from rich.table import Table
from rich.console import Console
from rich.panel import Panel
from rich.pretty import Pretty

console = Console()


HOST = "0.0.0.0"
PORT = 24454  # Cambia el puerto si lo deseas
USE_SSL = True  # Cambia a False si no quieres SSL
CERT_FILE = "cert.pem"
KEY_FILE = "key.pem"

# clients: id -> {'ws': WebSocket, 'name': str, 'addr': (ip,port)}
clients: Dict[str, dict] = {}
clients_lock = asyncio.Lock()

async def send_json(ws: Any, obj: dict):
    try:
        text = json.dumps(obj)
        await ws.send(text)
    except Exception:
        raise

async def show_clients_table():
    """Muestra tabla de clientes (no borra la consola para conservar logs)."""
    table = Table(title="Clientes conectados", show_edge=True)
    table.add_column("ID", style="cyan", no_wrap=True)
    table.add_column("Nombre", style="green")
    table.add_column("IP", style="magenta")
    table.add_column("Puerto", style="yellow")
    async with clients_lock:
        for cid, info in clients.items():
            ip = info["addr"][0] if info.get("addr") else "-"
            port = str(info["addr"][1]) if info.get("addr") else "-"
            table.add_row(cid, info["name"], ip, port)
    console.print(Panel.fit(table, title="[bold blue]Estado de clientes[/bold blue]"))

async def broadcast_list():
    """Enviar la lista actual de clientes a todos los conectados"""
    async with clients_lock:
        payload = {
            "type": "list",
            "clients": [
                {"id": cid, "name": info["name"], "ip": info["addr"][0], "port": info["addr"][1]}
                for cid, info in clients.items()
            ],
        }
        items = list(clients.items())
    to_remove = []
    for cid, info in items:
        try:
            await send_json(info["ws"], payload)
        except Exception:
            to_remove.append(cid)
    for cid in to_remove:
        await remove_client(cid)
    await show_clients_table()

async def remove_client(cid: str):
    async with clients_lock:
        info = clients.pop(cid, None)
    if info:
        try:
            await info["ws"].close()
        except Exception:
            pass
        console.print(f"[red][DISCONNECT][/red] {cid} - [bold]{info['name']}[/] @ {info['addr'][0]}:{info['addr'][1]}")
        await broadcast_list()

async def handle_message(sender_id: str, msg: dict):
    """Maneja mensajes recibidos desde clientes ya registrados"""
    mtype = msg.get("type")
    async with clients_lock:
        sender = clients.get(sender_id)
    sender_name = sender["name"] if sender else "<unknown>"

    if mtype == "list_request":
        async with clients_lock:
            payload = {
                "type": "list",
                "clients": [
                    {"id": cid, "name": info["name"], "ip": info["addr"][0], "port": info["addr"][1]}
                    for cid, info in clients.items()
                ],
            }
        await send_json(sender["ws"], payload)
        console.print(f"[blue][LIST_REQUEST][/blue] {sender_name} ({sender_id}) pidió la lista")

    elif mtype == "group":
        # Comprobar si es un mensaje de texto o un archivo
        if "file" in msg:
            file_name = msg["file"].get("name", "unknown")
            payload = {
                "type": "message",
                "from": sender_id,
                "name": sender_name,
                "file": msg["file"],
                "group": True,
            }
            console.print(f"[green][GROUP-FILE][/green] {sender_name} ({sender_id}) -> [bold]GRUPO[/]: {file_name}")
        else:
            text = (msg.get("text") or "").strip()
            if not text:
                return
            payload = {
                "type": "message",
                "from": sender_id,
                "name": sender_name,
                "text": text,
                "group": True,
            }
            console.print(f"[green][GROUP][/green] {sender_name} ({sender_id}) -> [bold]GRUPO[/]: {text}")
        to_remove = []
        async with clients_lock:
            items = list(clients.items())
        for cid, info in items:
            try:
                await send_json(info["ws"], payload)
            except Exception:
                to_remove.append(cid)
        for cid in to_remove:
            await remove_client(cid)

    elif mtype == "private":
        to_id = msg.get("to")
        if not to_id:
            await send_json(sender["ws"], {"type": "error", "message": "private requires 'to'"})
            return
            
        # Comprobar si es un archivo o texto
        if "file" in msg:
            file_info = msg["file"]
            if not file_info:
                await send_json(sender["ws"], {"type": "error", "message": "invalid file data"})
                return
        else:
            text = (msg.get("text") or "").strip()
            if not text:
                await send_json(sender["ws"], {"type": "error", "message": "private requires 'text' or 'file'"})
                return
        async with clients_lock:
            target = clients.get(to_id)
        if not target:
            await send_json(sender["ws"], {"type": "error", "message": "target not connected"})
            console.print(f"[yellow][PRIVATE-FAILED][/yellow] {sender_name} -> {to_id} : target not connected")
            return
        # Crear el payload según sea archivo o texto
        if "file" in msg:
            file_name = msg["file"].get("name", "unknown")
            payload = {
                "type": "message",
                "from": sender_id,
                "name": sender_name,
                "file": msg["file"],
                "group": False,
                "to": to_id
            }
            console.print(f"[magenta][PRIVATE-FILE][/magenta] {sender_name} ({sender_id}) -> {target['name']} ({to_id}): {file_name}")
        else:
            payload = {
                "type": "message",
                "from": sender_id,
                "name": sender_name,
                "text": text,
                "group": False,
                "to": to_id
            }
            console.print(f"[magenta][PRIVATE][/magenta] {sender_name} ({sender_id}) -> {target['name']} ({to_id}): {text}")
        try:
            # Enviar el mensaje tanto al destinatario como al remitente
            await send_json(target["ws"], payload)
            await send_json(sender["ws"], payload)  # El remitente también ve su mensaje
        except Exception:
            await send_json(sender["ws"], {"type": "error", "message": "failed to deliver"})
            await remove_client(to_id)

    else:
        await send_json(sender["ws"], {"type": "error", "message": "unknown message type"})
        console.print(f"[red][UNKNOWN][/red] from {sender_name}: {Pretty(msg)}")

# <-- FIX: path is optional to support websockets versions that call handler(ws) or handler(ws, path)
async def register_handler(ws: Any, path: Optional[str] = None):
    """
    Handler para cada conexión websocket.
    Exige que el primer mensaje sea:
      {"type": "register", "name": "Alice"}
    """
    remote = getattr(ws, "remote_address", None) or ("-", "-")  # (ip, port) or fallback
    client_id = str(uuid.uuid4())[:8]
    try:
        raw = await ws.recv()
        try:
            msg = json.loads(raw)
        except Exception:
            await ws.send(json.dumps({"type": "error", "message": "first message must be valid JSON register"}))
            await ws.close()
            return

        if msg.get("type") != "register" or not msg.get("name"):
            await ws.send(json.dumps({"type": "error", "message": "first message must be register with name"}))
            await ws.close()
            return

        name = str(msg["name"])[:32]
        async with clients_lock:
            clients[client_id] = {"ws": ws, "name": name, "addr": remote}

        console.print(f"[cyan][CONNECT][/cyan] {client_id} - [bold]{name}[/] @ {remote[0]}:{remote[1]}")
        await send_json(ws, {"type": "registered", "id": client_id})
        await broadcast_list()

        while True:
            raw = await ws.recv()
            try:
                msg = json.loads(raw)
            except Exception:
                await send_json(ws, {"type": "error", "message": "invalid json"})
                continue
            await handle_message(client_id, msg)

    except exceptions.ConnectionClosed:
        console.print(f"[red][CLOSED][/red] conexión cerrada {client_id}")
        await remove_client(client_id)
    except Exception:
        console.print("[bold red]ERROR en handler:[/]")
        traceback.print_exc()
        await remove_client(client_id)


async def main():
    ssl_context = None
    proto = "ws"
    if USE_SSL:
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
        proto = "wss"
    console.print(Panel(f"[bold green]Servidor WebSocket con Rich[/bold green]\nEscuchando conexiones", title="Server"))
    # websockets.serve puede llamar al handler con 1 o 2 args dependiendo de la versión.
    # Configurar el tamaño máximo del mensaje a 6MB
    async with websockets.serve(
        register_handler,
        HOST,
        PORT,
        ssl=ssl_context,
        max_size=6 * 1024 * 1024,  # 6MB para permitir archivos de 5MB + overhead
    ):
        console.print(f"[bold]Listening on[/] {proto}://{HOST}:{PORT}")
        await show_clients_table()
        await asyncio.Future()  # keep running

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        console.print("[yellow]Shutting down server (KeyboardInterrupt)[/yellow]")
