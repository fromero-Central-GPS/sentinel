export default function WonTrackPage() {
  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Motor Won Track</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Monitorea umbrales de conversaciones ganadas
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
          <svg className="h-6 w-6 text-green-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-900">Motor Won Track</h2>
        <p className="mt-2 text-sm text-zinc-500 max-w-sm mx-auto">
          Analiza oportunidades ganadas para extraer patrones de éxito y definir umbrales que alimentan Live Opp.
        </p>
        <div className="mt-6 inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
          En desarrollo — CEN-1056
        </div>
      </div>
    </div>
  );
}
