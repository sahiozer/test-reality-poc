FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 POLARS_MAX_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
WORKDIR /app
COPY analysis/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY analysis/app ./app
COPY analysis/tests ./tests
COPY infra/init.sql ./init.sql
COPY demo-data ./demo_data
USER 10001:10001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
