import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BE_DIR = Path(__file__).resolve().parent
WEB_DIR = BE_DIR.parent / "web"

load_dotenv(BE_DIR / ".env")

ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY", "").strip()
ZHIPU_MODEL = os.getenv("ZHIPU_MODEL", "glm-4v-plus").strip()
ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"

app = FastAPI(
    title="图片文字提取 API",
    version="1.0.0",
    description="基于智谱 GLM-4V-Plus 的 OCR 文字提取服务",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExtractRequest(BaseModel):
    image_url: str
    prompt: str


def _parse_zhipu_error(response: httpx.Response) -> str:
    try:
        data = response.json()
        if isinstance(data, dict):
            if "error" in data and isinstance(data["error"], dict):
                return data["error"].get("message", response.text)
            if "message" in data:
                return data["message"]
    except (json.JSONDecodeError, ValueError):
        pass
    return response.text or f"HTTP {response.status_code}"


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "configured": bool(ZHIPU_API_KEY),
        "model": ZHIPU_MODEL,
        "python": "3.11.9",
    }


@app.post("/api/extract")
async def extract_text(req: ExtractRequest):
    if not ZHIPU_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="未配置 ZHIPU_API_KEY，请复制 .env.example 为 .env 并填入密钥",
        )

    if not req.image_url.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="图片格式无效，需要 base64 data URL")

    payload = {
        "model": ZHIPU_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": req.prompt},
                    {"type": "image_url", "image_url": {"url": req.image_url}},
                ],
            }
        ],
        "temperature": 0.1,
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                ZHIPU_API_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {ZHIPU_API_KEY}",
                },
                json=payload,
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="智谱 API 请求超时，请稍后重试")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"网络请求失败: {exc}")

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=_parse_zhipu_error(response),
        )

    return response.json()


app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="static")
