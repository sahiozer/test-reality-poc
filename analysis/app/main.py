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

# Local opt-in only. The legacy/deployment configuration leaves this disabled.
if os.environ.get("LOCAL_TEST_REPAIR_ENABLED") == "true":
    from app import local_repair
    from pydantic import ConfigDict, Field, StrictInt
    from typing import Optional

    @app.on_event("startup")
    def initialize_local_repair():
        local_repair.initialize()

    class LocalDemand(BaseModel):
        model_config = ConfigDict(extra="forbid")
        domain: Literal["CUSTOMER_LENDING", "CARDS"]
        metric_key: Optional[str] = Field(default=None, max_length=160)
        required: Optional[StrictInt] = Field(default=None, ge=0, le=2147483647)
        reason: str = Field(default="", max_length=500)
        token: Optional[str] = Field(default=None, max_length=64)
        count: Optional[StrictInt] = Field(default=None, ge=1, le=100)

    @app.get("/local-demand/status")
    def demand_status(domain: Literal["CUSTOMER_LENDING", "CARDS"], metric_key: Optional[str] = None):
        try:
            with local_repair.connection() as conn:
                return local_repair.status(conn, domain, metric_key)
        except local_repair.RepairError as error:
            raise HTTPException(409, str(error))

    @app.post("/local-demand/{action}")
    def demand_action(action: Literal["save", "preview", "apply", "inject", "health-preview", "health-apply"], body: LocalDemand):
        try:
            with local_repair.connection() as conn:
                if action.startswith('health-'):
                    if body.metric_key is not None or body.required is not None or body.count is not None or body.reason:
                        raise local_repair.RepairError('Health correction accepts only domain and preview token')
                    return local_repair.health_preview(conn,body.domain) if action=='health-preview' else local_repair.health_apply(conn,body.domain,body.token)
                if action == "save": return local_repair.save(conn, body.domain, body.required, body.reason, body.metric_key)
                if action == "preview": return local_repair.preview(conn, body.domain, body.metric_key)
                if action == "apply": return local_repair.apply(conn, body.domain, body.token, body.metric_key)
                return local_repair.inject(conn, body.domain, body.count, body.metric_key)
        except local_repair.RepairError as error:
            raise HTTPException(409, str(error))
        except psycopg.Error:
            log.error("Local repair transaction failed and rolled back")
            raise HTTPException(409, "Repair transaction rolled back; no changes committed")

    @app.get("/local-demand/findings")
    def findings_demand(domain: Literal["CUSTOMER_LENDING", "CARDS"]):
        try:
            with local_repair.connection() as conn:
                return local_repair.findings_status(conn, domain)
        except local_repair.RepairError as error:
            raise HTTPException(409, str(error))
