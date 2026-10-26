import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from backend.app.core.config import settings
from backend.app.api.chat import create_chat_router
from backend.app.services.chat import get_chat_service
from backend.app.api import flight, hotels, destination , team
from fastapi.middleware.cors import CORSMiddleware
import os
@asynccontextmanager
async def lifespan(app: FastAPI):
    service = await asyncio.to_thread(get_chat_service)
    try:
        yield
    finally:
        await asyncio.to_thread(service.close)
        get_chat_service.cache_clear()


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:4173", "http://127.0.0.1:4173",
        "http://localhost:8081", "http://127.0.0.1:8081",
        *[origin.strip() for origin in os.getenv("CORS_ORIGINS", "").split(",") if origin.strip()],
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(flight.router, prefix=f"{settings.API_V1_STR}/flights", tags=["Flights"])
app.include_router(hotels.router, prefix=f"{settings.API_V1_STR}/hotels", tags=["Hotels"])
app.include_router(destination.router, prefix=f"{settings.API_V1_STR}/destinations", tags=["Destinations"])
app.include_router(team.router, prefix=f"{settings.API_V1_STR}/team", tags=["Team"])
app.include_router(create_chat_router(), prefix=f"{settings.API_V1_STR}/chat", tags=["Chat"])

@app.get("/")
def root():
    return {"message": "Travel Agent API is running 🚀 "}
