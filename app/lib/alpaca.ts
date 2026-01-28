// Alpaca API Wrapper for Next.js
// Provides utilities to interact with Alpaca API

interface AlpacaConfig {
  apiKey: string;
  secretKey: string;
  baseUrl?: string;
}

export class AlpacaClient {
  private apiKey: string;
  private secretKey: string;
  private baseUrl: string;

  constructor(config: AlpacaConfig) {
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl || 'https://paper-api.alpaca.markets';
  }

  private getHeaders(): HeadersInit {
    return {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.secretKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get account information
   */
  async getAccount(): Promise<any> {
    const url = `${this.baseUrl}/v2/account`;
    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      let errorMessage: string;
      try {
        // Clone the response before reading to avoid "Body has already been read" errors
        const responseClone = response.clone();
        // Try to parse as JSON first (Alpaca usually returns JSON errors)
        const errorData = await responseClone.json();
        errorMessage = errorData.message || errorData.error || JSON.stringify(errorData);
      } catch (jsonError) {
        // If JSON parsing fails, try to get text from a fresh clone
        try {
          const textClone = response.clone();
          errorMessage = await textClone.text();
        } catch (textError) {
          // If we can't read the body at all, use status text
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }
      }

      // Provide more helpful error messages based on status code
      if (response.status === 401) {
        throw new Error(`Unauthorized: Invalid API credentials. ${errorMessage}`);
      } else if (response.status === 403) {
        throw new Error(`Forbidden: API key does not have permission. ${errorMessage}`);
      } else if (response.status === 404) {
        throw new Error(`Not Found: Account not found. Check if you're using the correct base URL (paper vs live). ${errorMessage}`);
      } else {
        throw new Error(`Failed to fetch account (${response.status}): ${errorMessage}`);
      }
    }

    return response.json();
  }

  /**
   * Get current positions
   */
  async getPositions(): Promise<any[]> {
    const response = await fetch(`${this.baseUrl}/v2/positions`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch positions: ${error}`);
    }

    return response.json();
  }

  /**
   * Get all orders
   */
  async getOrders(status: 'all' | 'open' | 'closed' = 'all'): Promise<any[]> {
    const response = await fetch(`${this.baseUrl}/v2/orders?status=${status}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch orders: ${error}`);
    }

    return response.json();
  }

  /**
   * Cancel all open orders
   */
  async cancelAllOrders(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/v2/orders`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to cancel orders: ${error}`);
    }

    return response.json();
  }

  /**
   * Get account activities (trades)
   */
  async getActivities(activityType: string = 'FILL', pageSize: number = 100): Promise<any[]> {
    const response = await fetch(
      `${this.baseUrl}/v2/account/activities/${activityType}?page_size=${pageSize}`,
      {
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch activities: ${error}`);
    }

    return response.json();
  }

  /**
   * Get account portfolio history (equity and P/L over time)
   * @param period - Time period: '1D', '1W', '1M', '3M', '1Y', 'all'
   * @param timeframe - Timeframe: '1Min', '5Min', '15Min', '1H', '1D'
   * @param endDate - End date (ISO 8601 format)
   * @param startDate - Start date (ISO 8601 format)
   * @returns Portfolio history with equity and profit/loss data
   */
  async getPortfolioHistory(params?: {
    period?: '1D' | '1W' | '1M' | '3M' | '1Y' | 'all';
    timeframe?: '1Min' | '5Min' | '15Min' | '1H' | '1D';
    endDate?: string;
    startDate?: string;
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    
    if (params?.period) {
      queryParams.append('period', params.period);
    }
    if (params?.timeframe) {
      queryParams.append('timeframe', params.timeframe);
    }
    if (params?.endDate) {
      queryParams.append('end_date', params.endDate);
    }
    if (params?.startDate) {
      queryParams.append('start_date', params.startDate);
    }

    const url = `${this.baseUrl}/v2/account/portfolio/history${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || JSON.stringify(errorData);
      } catch (jsonError) {
        errorMessage = await response.text();
      }
      throw new Error(`Failed to fetch portfolio history: ${errorMessage}`);
    }

    return response.json();
  }
}

/**
 * Create Alpaca client from provided credentials
 * 
 * @deprecated This function is kept for backward compatibility but should not be used.
 * Master account credentials should be loaded from the database via the API routes.
 * 
 * @param apiKey - API key (required)
 * @param secretKey - Secret key (required)
 * @returns AlpacaClient instance
 */
export function createAlpacaClient(apiKey?: string, secretKey?: string): AlpacaClient {
  if (!apiKey || !secretKey) {
    throw new Error('API key and secret key are required. Master account credentials should be loaded from the database.');
  }
  
  return new AlpacaClient({
    apiKey,
    secretKey,
    baseUrl: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
  });
}

