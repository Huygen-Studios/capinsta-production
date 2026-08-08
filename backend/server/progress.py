from fastapi import WebSocket
from typing import Dict, List, Tuple
import asyncio
import threading
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # dictionary mapping job_id to a list of active websocket connections
        self.active_connections: Dict[str, List[Tuple[WebSocket, asyncio.AbstractEventLoop]]] = {}
        # thread-safe lock (works across event loops and threads)
        self.lock = threading.Lock()

    async def connect(self, websocket: WebSocket, job_id: str):
        await websocket.accept()
        loop = asyncio.get_running_loop()
        with self.lock:
            if job_id not in self.active_connections:
                self.active_connections[job_id] = []
            self.active_connections[job_id].append((websocket, loop))
        logger.info(f"WebSocket connected for job {job_id}")

    async def disconnect(self, websocket: WebSocket, job_id: str):
        with self.lock:
            if job_id in self.active_connections:
                self.active_connections[job_id] = [
                    item for item in self.active_connections[job_id] if item[0] is not websocket
                ]
                if not self.active_connections[job_id]:
                    del self.active_connections[job_id]
        logger.info(f"WebSocket disconnected for job {job_id}")

    async def _send_json(
        self,
        connection: WebSocket,
        loop: asyncio.AbstractEventLoop,
        message: dict,
    ) -> bool:
        try:
            if loop is asyncio.get_running_loop():
                await connection.send_json(message)
            else:
                future = asyncio.run_coroutine_threadsafe(connection.send_json(message), loop)
                await asyncio.wrap_future(future)
            return True
        except Exception as e:
            logger.warning(f"Failed to send to websocket, removing: {e}")
            return False

    async def broadcast_progress(self, job_id: str, status: str, percent: int, details: str = ""):
        message = {
            "type": "progress",
            "job_id": job_id,
            "status": status,
            "percent": percent,
            "details": details
        }
        
        with self.lock:
            connections = list(self.active_connections.get(job_id, []))

        dead = []
        for connection, loop in connections:
            if not await self._send_json(connection, loop, message):
                dead.append(connection)

        if dead:
            with self.lock:
                for conn in dead:
                    if job_id in self.active_connections:
                        self.active_connections[job_id] = [
                            item for item in self.active_connections[job_id] if item[0] is not conn
                        ]

    async def broadcast(self, job_id: str, data: dict):
        # Allow sending generic dictionaries 
        message = {
            "type": "progress",
            "job_id": job_id,
            **data
        }
        with self.lock:
            connections = list(self.active_connections.get(job_id, []))

        dead = []
        for connection, loop in connections:
            if not await self._send_json(connection, loop, message):
                dead.append(connection)

        if dead:
            with self.lock:
                for conn in dead:
                    if job_id in self.active_connections:
                        self.active_connections[job_id] = [
                            item for item in self.active_connections[job_id] if item[0] is not conn
                        ]

manager = ConnectionManager()
