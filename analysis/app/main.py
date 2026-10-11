import logging
import os
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Literal
import psycopg

from app.engine import analyze

app = FastAPI(title="Test Reality Analysis", version="0.1.0")
log = logging.getLogger(__name__)


class AnalysisRequest(BaseModel):
    run_id: UUID
    domain: Literal["CUSTOMER_LENDING", "CARDS"] = "CUSTOMER_LENDING"


@app.get("/health")
def health():
    try:
        with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5) as conn:
            conn.execute("SELECT 1")
        return {"status": "UP"}
    except psycopg.Error:
        raise HTTPException(503, "Database unavailable")


@app.post("/analysis/run")
def run(request: AnalysisRequest):
    try:
        with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5) as conn:
            return analyze(conn, str(request.run_id), domain=request.domain)
    except ValueError as error:
        raise HTTPException(409, str(error))
    except psycopg.Error:
        log.error("Analysis database operation failed")
        raise HTTPException(503, "Database analysis failed; inspect service health and query limits")
