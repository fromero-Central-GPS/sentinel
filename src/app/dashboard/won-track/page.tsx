'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, TrendingUp, Clock, Target, Users, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function WonTrackPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'mock' | 'live'>('mock');

  useEffect(() => {
    fetchData(mode);
  }, [mode]);

  const fetchData = async (currentMode: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ghl/won-track?mode=${currentMode}`);
      if (!res.ok) throw new Error('Failed to fetch data');
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Won Track</h2>
          <p className="text-muted-foreground">
            Análisis de oportunidades ganadas y patrones de éxito.
          </p>
        </div>
        <div className="flex items-center space-x-2 bg-white dark:bg-zinc-950 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <Button
            variant={mode === 'mock' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('mock')}
            disabled={loading}
          >
            Demo Data
          </Button>
          <Button
            variant={mode === 'live' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('live')}
            disabled={loading}
          >
            Live GHL
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
        </div>
      ) : data?.error ? (
        <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
          <CardContent className="flex items-center gap-4 py-6">
            <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
            <div>
              <h3 className="font-semibold text-red-900 dark:text-red-200">{data.error}</h3>
              <p className="text-sm text-red-700 dark:text-red-300">{data.hint || data.detail}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Oportunidades Analizadas</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data._meta.oppCount}</div>
                <p className="text-xs text-muted-foreground">Últimas ganadas</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Tiempo de Respuesta Ideal</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">&lt; {data.successThresholds?.maxResponseTimeMinutes || 30}m</div>
                <p className="text-xs text-muted-foreground">Para maximizar cierre</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Interacciones Promedio</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.successThresholds?.avgInteractionsToClose || 5}</div>
                <p className="text-xs text-muted-foreground">Mensajes hasta ganar</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Duración de Venta</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.successThresholds?.avgDaysToClose || 14} días</div>
                <p className="text-xs text-muted-foreground">Ciclo promedio</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Patrones de Comunicación */}
            <Card>
              <CardHeader>
                <CardTitle>Patrones de Comunicación Exitosos</CardTitle>
                <CardDescription>Lo que caracteriza a las ventas cerradas</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="mb-2 text-sm font-medium">Canales Efectivos</h4>
                    <div className="flex flex-wrap gap-2">
                      {data.communicationPatterns?.topChannels?.map((channel: string) => (
                        <Badge key={channel} variant="secondary">
                          {channel}
                        </Badge>
                      )) || <span className="text-sm text-muted-foreground">Sin datos</span>}
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-sm font-medium">Días de Mayor Actividad</h4>
                    <div className="flex flex-wrap gap-2">
                      {data.communicationPatterns?.mostActiveDays?.map((day: string) => (
                        <Badge key={day} variant="outline">
                          {day}
                        </Badge>
                      )) || <span className="text-sm text-muted-foreground">Sin datos</span>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Business Features */}
            <Card>
              <CardHeader>
                <CardTitle>Perfil del Cliente Ideal (ICP)</CardTitle>
                <CardDescription>Características comunes en negocios ganados</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {data.businessFeatures?.length > 0 ? (
                    data.businessFeatures.map((feature: any, idx: number) => (
                      <div key={idx} className="flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                        <div>
                          <p className="font-medium">{feature.category}</p>
                          <p className="text-sm text-muted-foreground">
                            {feature.value} ({feature.frequency} ocurrencias)
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-4 text-muted-foreground">
                      No se encontraron características comunes significativas.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
