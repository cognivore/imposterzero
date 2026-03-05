"""
WebSocket inference server for Imposter Zero.

Loads a trained tabular policy and serves action selections to game clients.
Supports both the bucketed strategic abstraction (MCCFR) policy format.

Request:  { "type": "get_action", "player": int, "info_state_string": str,
            "observation_tensor": [...], "legal_actions": [int, ...] }
Response: { "type": "action", "encoded_action": int,
            "action_probs": {str: float, ...} }

Usage:
  python serve.py --model_path ./training/policy.json --port 8765
"""

import argparse
import asyncio
import json
import random

import websockets

import imposter_zero.game as ig


def load_tabular_policy(path):
    with open(path) as f:
        data = json.load(f)
    print(f"Loaded policy: {data['metadata']['info_states']} info states, "
          f"{data['metadata']['iterations']} iterations")
    return data["policy"]


async def handle_client(websocket, policy):
    async for raw in websocket:
        msg = json.loads(raw)

        if msg["type"] == "get_action":
            legal = msg["legal_actions"]
            info_state = msg.get("info_state_string", "")

            entry = policy.get(info_state)
            if entry:
                probs = {str(a): entry.get(str(a), 0.0) for a in legal}
                total = sum(probs.values())
                if total > 0:
                    probs = {a: v / total for a, v in probs.items()}
                    action = int(random.choices(
                        list(probs.keys()),
                        weights=list(probs.values()),
                        k=1,
                    )[0])
                else:
                    action = random.choice(legal)
                    probs = {str(a): 1.0 / len(legal) for a in legal}
            else:
                action = random.choice(legal)
                probs = {str(a): 1.0 / len(legal) for a in legal}

            await websocket.send(json.dumps({
                "type": "action",
                "encoded_action": action,
                "action_probs": probs,
            }))


async def main(host: str, port: int, policy):
    async with websockets.serve(lambda ws: handle_client(ws, policy), host, port):
        print(f"Inference server listening on ws://{host}:{port}")
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_path", default="./training/policy.json")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    policy = load_tabular_policy(args.model_path)
    asyncio.run(main(args.host, args.port, policy))
