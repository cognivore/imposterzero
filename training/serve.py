"""
WebSocket inference server for Imposter Zero.

Accepts observation dicts from game clients, runs the trained policy,
and returns action indices. Protocol mirrors collapsization's serve.py.

Request:  { "type": "get_action", "player": int, "observation": {...} }
Response: { "type": "action", "action": int }
"""

import asyncio
import json

import websockets


async def handle_client(websocket):
    async for raw in websocket:
        msg = json.loads(raw)

        if msg["type"] == "get_action":
            # TODO: load policy, encode observation, run inference
            action = 0
            await websocket.send(json.dumps({
                "type": "action",
                "action": action,
            }))


async def main(host: str = "localhost", port: int = 8765):
    async with websockets.serve(handle_client, host, port):
        print(f"Inference server listening on ws://{host}:{port}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
