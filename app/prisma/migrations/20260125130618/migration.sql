-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_login_at" DATETIME
);

-- CreateTable
CREATE TABLE "master_accounts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "account_id" TEXT NOT NULL,
    "encrypted_api_key" TEXT NOT NULL,
    "encrypted_secret_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "client_accounts" (
    "account_id" TEXT NOT NULL PRIMARY KEY,
    "encrypted_api_key" TEXT NOT NULL,
    "encrypted_secret_key" TEXT NOT NULL,
    "email" TEXT,
    "account_name" TEXT,
    "is_active" BOOLEAN NOT NULL,
    "circuit_breaker_state" TEXT NOT NULL,
    "failure_count" INTEGER NOT NULL,
    "last_failure_time" DATETIME,
    "scaling_method" TEXT,
    "scaling_multiplier" REAL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "last_successful_trade" DATETIME
);

-- CreateTable
CREATE TABLE "trade_audit_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "master_order_id" TEXT NOT NULL,
    "client_account_id" TEXT NOT NULL,
    "client_order_id" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "master_qty" REAL NOT NULL,
    "master_price" REAL,
    "client_qty" REAL,
    "client_filled_qty" REAL,
    "client_avg_price" REAL,
    "scaling_method_used" TEXT,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL,
    "replication_latency_ms" INTEGER,
    "order_submission_latency_ms" INTEGER,
    "master_trade_time" DATETIME NOT NULL,
    "replication_started_at" DATETIME NOT NULL,
    "replication_completed_at" DATETIME
);

-- CreateTable
CREATE TABLE "system_metrics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL,
    "metric_name" TEXT NOT NULL,
    "metric_value" REAL NOT NULL,
    "tags" TEXT
);

-- CreateTable
CREATE TABLE "deduplication_cache" (
    "event_id" TEXT NOT NULL PRIMARY KEY,
    "event_type" TEXT NOT NULL,
    "processed_at" DATETIME NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "content_hash" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "master_accounts_account_id_key" ON "master_accounts"("account_id");

-- CreateIndex
CREATE INDEX "ix_master_accounts_is_active" ON "master_accounts"("is_active");

-- CreateIndex
CREATE INDEX "ix_master_accounts_account_id" ON "master_accounts"("account_id");

-- CreateIndex
CREATE INDEX "ix_client_accounts_is_active" ON "client_accounts"("is_active");

-- CreateIndex
CREATE INDEX "idx_active_accounts" ON "client_accounts"("is_active", "circuit_breaker_state");

-- CreateIndex
CREATE INDEX "ix_client_accounts_account_id" ON "client_accounts"("account_id");

-- CreateIndex
CREATE INDEX "idx_client_trades" ON "trade_audit_logs"("client_account_id", "status");

-- CreateIndex
CREATE INDEX "idx_master_order" ON "trade_audit_logs"("master_order_id");

-- CreateIndex
CREATE INDEX "ix_trade_audit_logs_client_account_id" ON "trade_audit_logs"("client_account_id");

-- CreateIndex
CREATE INDEX "ix_trade_audit_logs_master_order_id" ON "trade_audit_logs"("master_order_id");

-- CreateIndex
CREATE INDEX "ix_trade_audit_logs_status" ON "trade_audit_logs"("status");

-- CreateIndex
CREATE INDEX "idx_latency_analysis" ON "trade_audit_logs"("replication_latency_ms", "master_trade_time");

-- CreateIndex
CREATE INDEX "idx_failed_trades" ON "trade_audit_logs"("status", "replication_started_at");

-- CreateIndex
CREATE INDEX "ix_trade_audit_logs_symbol" ON "trade_audit_logs"("symbol");

-- CreateIndex
CREATE INDEX "idx_symbol_trades" ON "trade_audit_logs"("symbol", "master_trade_time");

-- CreateIndex
CREATE INDEX "ix_system_metrics_metric_name" ON "system_metrics"("metric_name");

-- CreateIndex
CREATE INDEX "ix_system_metrics_timestamp" ON "system_metrics"("timestamp");

-- CreateIndex
CREATE INDEX "idx_metric_time" ON "system_metrics"("metric_name", "timestamp");

-- CreateIndex
CREATE INDEX "ix_deduplication_cache_content_hash" ON "deduplication_cache"("content_hash");

-- CreateIndex
CREATE INDEX "ix_deduplication_cache_expires_at" ON "deduplication_cache"("expires_at");

-- CreateIndex
CREATE INDEX "idx_expiry_cleanup" ON "deduplication_cache"("expires_at");
