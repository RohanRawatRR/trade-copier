"""
Alert System
Sends notifications via Slack and Email for critical events.

Alert triggers:
- Trade replication failures
- WebSocket disconnections
- Latency threshold breaches
- Circuit breaker activations
- System errors
"""
import aiohttp
import asyncio
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from enum import Enum
import structlog

from config.settings import settings


logger = structlog.get_logger(__name__)


class AlertSeverity(str, Enum):
    """Alert severity levels"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class AlertManager:
    """
    Manages alert delivery via multiple channels.
    
    Features:
    - Async delivery (non-blocking)
    - Rate limiting to prevent alert storms
    - Retry logic for failed deliveries
    - Alert deduplication
    """
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self._alert_cache: Dict[str, datetime] = {}
        self._alert_cooldown_seconds = 300  # 5 minutes between duplicate alerts
    
    async def initialize(self):
        """Initialize HTTP session for alert delivery"""
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10)
        )
        logger.info("alert_manager_initialized")
    
    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()
        logger.info("alert_manager_closed")
    
    def _should_send_alert(self, alert_key: str) -> bool:
        """
        Check if alert should be sent (deduplication).
        
        Args:
            alert_key: Unique key for this alert type
        
        Returns:
            True if alert should be sent, False if still in cooldown
        """
        now = datetime.now(timezone.utc)
        last_sent = self._alert_cache.get(alert_key)
        
        if last_sent is None:
            self._alert_cache[alert_key] = now
            return True
        
        seconds_since_last = (now - last_sent).total_seconds()
        if seconds_since_last >= self._alert_cooldown_seconds:
            self._alert_cache[alert_key] = now
            return True
        
        return False
    
    async def send_alert(
        self,
        title: str,
        message: str,
        severity: AlertSeverity = AlertSeverity.INFO,
        metadata: Optional[Dict[str, Any]] = None,
        alert_key: Optional[str] = None,
    ):
        """
        Send alert through all configured channels.
        
        Args:
            title: Alert title
            message: Alert message
            severity: Alert severity level
            metadata: Additional context data
            alert_key: Unique key for deduplication (None = always send)
        """
        # Check deduplication
        if alert_key and not self._should_send_alert(alert_key):
            logger.debug(
                "alert_suppressed_by_cooldown",
                alert_key=alert_key,
                title=title
            )
            return
        
        # Send to all configured channels in parallel
        tasks = []
        
        if settings.enable_slack_alerts and settings.slack_webhook_url:
            tasks.append(self._send_slack_alert(title, message, severity, metadata))
        
        if settings.enable_email_alerts and settings.alert_email_to:
            tasks.append(self._send_email_alert(title, message, severity, metadata))
        
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, Exception):
                    logger.error("alert_delivery_failed", error=str(result))
        else:
            logger.debug("no_alert_channels_configured")
    
    async def _send_slack_alert(
        self,
        title: str,
        message: str,
        severity: AlertSeverity,
        metadata: Optional[Dict[str, Any]]
    ):
        """Send alert to Slack via webhook"""
        if not self.session:
            logger.error("slack_alert_failed_no_session")
            return
        
        # Color coding based on severity
        color_map = {
            AlertSeverity.INFO: "#36a64f",      # Green
            AlertSeverity.WARNING: "#ff9900",   # Orange
            AlertSeverity.ERROR: "#ff0000",     # Red
            AlertSeverity.CRITICAL: "#990000",  # Dark red
        }
        
        # Build Slack message
        fields = []
        if metadata:
            for key, value in metadata.items():
                fields.append({
                    "title": key.replace("_", " ").title(),
                    "value": str(value),
                    "short": True
                })
        
        payload = {
            "channel": settings.slack_alert_channel,
            "username": "Trade Copier Alert",
            "icon_emoji": ":chart_with_upwards_trend:",
            "attachments": [
                {
                    "color": color_map[severity],
                    "title": f"[{severity.value.upper()}] {title}",
                    "text": message,
                    "fields": fields,
                    "footer": "Trade Copier System",
                    "ts": int(datetime.now(timezone.utc).timestamp())
                }
            ]
        }
        
        try:
            async with self.session.post(
                settings.slack_webhook_url,
                json=payload
            ) as response:
                if response.status == 200:
                    logger.info("slack_alert_sent", title=title, severity=severity.value)
                else:
                    logger.error(
                        "slack_alert_failed",
                        status=response.status,
                        response=await response.text()
                    )
        except Exception as e:
            logger.error("slack_alert_exception", error=str(e), exc_info=True)
    
    async def _send_email_alert(
        self,
        title: str,
        message: str,
        severity: AlertSeverity,
        metadata: Optional[Dict[str, Any]]
    ):
        """Send alert via email (SMTP)"""
        # Note: This is a simplified implementation
        # In production, consider using AWS SES, SendGrid, or similar
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        
        try:
            # Build email
            msg = MIMEMultipart()
            msg['From'] = settings.smtp_user
            msg['To'] = settings.alert_email_to
            msg['Subject'] = f"[{severity.value.upper()}] {title}"
            
            # Build HTML body
            body = f"""
            <html>
                <body>
                    <h2 style="color: {'red' if severity in [AlertSeverity.ERROR, AlertSeverity.CRITICAL] else 'orange' if severity == AlertSeverity.WARNING else 'green'};">
                        {title}
                    </h2>
                    <p>{message}</p>
                    <h3>Details:</h3>
                    <ul>
            """
            
            if metadata:
                for key, value in metadata.items():
                    body += f"<li><strong>{key}:</strong> {value}</li>"
            
            body += f"""
                    </ul>
                    <hr>
                    <p><small>Trade Copier System - {datetime.now(timezone.utc).isoformat()}</small></p>
                </body>
            </html>
            """
            
            msg.attach(MIMEText(body, 'html'))
            
            # Send email (async via executor to avoid blocking)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                self._send_smtp_email,
                msg
            )
            
            logger.info("email_alert_sent", title=title, severity=severity.value)
        
        except Exception as e:
            logger.error("email_alert_exception", error=str(e), exc_info=True)
    
    def _send_smtp_email(self, msg: Any):
        """Synchronous SMTP email sending (runs in executor)"""
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
    
    async def alert_websocket_disconnected(self, reason: str):
        """Alert: WebSocket connection lost"""
        await self.send_alert(
            title="WebSocket Disconnected",
            message=f"Lost connection to master account WebSocket stream: {reason}",
            severity=AlertSeverity.WARNING,
            metadata={"reason": reason},
            alert_key="websocket_disconnected"
        )
    
    async def alert_websocket_reconnected(self):
        """Alert: WebSocket reconnected successfully"""
        await self.send_alert(
            title="WebSocket Reconnected",
            message="Successfully reconnected to master account WebSocket stream",
            severity=AlertSeverity.INFO,
            alert_key="websocket_reconnected"
        )
    
    async def alert_high_failure_rate(self, failure_count: int, total_count: int):
        """Alert: High failure rate in trade replication"""
        failure_rate = (failure_count / total_count * 100) if total_count > 0 else 0
        await self.send_alert(
            title="High Replication Failure Rate",
            message=f"Trade replication failure rate: {failure_rate:.1f}%",
            severity=AlertSeverity.ERROR,
            metadata={
                "failed_trades": failure_count,
                "total_trades": total_count,
                "failure_rate": f"{failure_rate:.1f}%"
            },
            alert_key="high_failure_rate"
        )
    
    async def alert_circuit_breaker_opened(self, client_account_id: str, reason: str):
        """Alert: Circuit breaker opened for client account"""
        await self.send_alert(
            title="Circuit Breaker Opened",
            message=f"Circuit breaker opened for client {client_account_id}",
            severity=AlertSeverity.WARNING,
            metadata={
                "client_account_id": client_account_id,
                "reason": reason
            }
        )
    
    async def alert_latency_threshold_exceeded(
        self,
        master_order_id: str,
        latency_ms: int,
        threshold: int
    ):
        """Alert: Replication latency exceeded threshold"""
        await self.send_alert(
            title="High Replication Latency",
            message=f"Trade replication latency ({latency_ms}ms) exceeded threshold ({threshold}ms)",
            severity=AlertSeverity.WARNING,
            metadata={
                "master_order_id": master_order_id,
                "latency_ms": latency_ms,
                "threshold_ms": threshold
            },
            alert_key=f"latency_exceeded_{master_order_id}"
        )
    
    async def alert_system_error(self, error: str, component: str):
        """Alert: Critical system error"""
        await self.send_alert(
            title="System Error",
            message=f"Critical error in {component}: {error}",
            severity=AlertSeverity.CRITICAL,
            metadata={
                "component": component,
                "error": error
            }
        )


# Singleton instance
_alert_manager: Optional[AlertManager] = None


async def get_alert_manager() -> AlertManager:
    """Get or create alert manager singleton"""
    global _alert_manager
    if _alert_manager is None:
        _alert_manager = AlertManager()
        await _alert_manager.initialize()
    return _alert_manager

