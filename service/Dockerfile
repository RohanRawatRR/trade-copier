# Multi-stage Dockerfile for production deployment
FROM python:3.10-slim as builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --user -r requirements.txt

# Production stage
FROM python:3.10-slim

# Create non-root user
RUN useradd -m -u 1000 tradecopier && \
    mkdir -p /app/data && \
    chown -R tradecopier:tradecopier /app

# Set working directory
WORKDIR /app

# Copy Python dependencies from builder
COPY --from=builder /root/.local /home/tradecopier/.local

# Copy application code
COPY --chown=tradecopier:tradecopier . .

# Set environment variables
ENV PATH=/home/tradecopier/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Switch to non-root user
USER tradecopier

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python scripts/test_connection.py || exit 1

# Run application
CMD ["python", "main.py"]

