'use client';

import { useEffect, useState } from 'react';

interface WonTrackMetrics {
  period: string;
  won: number;
  total: number;
  conversionRate: number;
  avgTicket: number;
  avgCycleDays: number;
  alerts: { type: string; message: string }[];
}

export default function WonTrackWidget() {
  const [metrics, setMetrics] = useState<WonTrackMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMetrics() {
      try {
        const response = await fetch('/api/engines/won-track');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: WonTrackMetrics = await response.json();
        setMetrics(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    fetchMetrics();
  }, []);

  if (loading) return <div>Loading Won Track metrics...</div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;
  if (!metrics) return <div>No metrics available.</div>;

  const { won, total, conversionRate, avgTicket, avgCycleDays, alerts } = metrics;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Won Track Conversions ({metrics.period})</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-gray-600">Won Opportunities:</p>
          <p className="text-2xl font-semibold">{won}</p>
        </div>
        <div>
          <p className="text-gray-600">Total Opportunities:</p>
          <p className="text-2xl font-semibold">{total}</p>
        </div>
        <div>
          <p className="text-gray-600">Conversion Rate:</p>
          <p className={`text-2xl font-semibold ${conversionRate < 0.20 ? 'text-red-500' : 'text-green-600'}`}>
            {(conversionRate * 100).toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-gray-600">Average Ticket:</p>
          <p className="text-2xl font-semibold">${avgTicket.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-600">Average Cycle Days:</p>
          <p className="text-2xl font-semibold">{avgCycleDays}</p>
        </div>
      </div>
      {alerts.length > 0 && (
        <div className="mt-4">
          {alerts.map((alert, index) => (
            <p key={index} className="text-sm text-red-500">
              {alert.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
