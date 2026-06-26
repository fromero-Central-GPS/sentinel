export default function LiveOppPage() {
  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Motor Live Opp</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Detecta oportunidades abiertas en riesgo de perderse
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
          <svg className="h-6 w-6 text-blue-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-900">Motor Live Opp</h2>
        <p className="mt-2 text-sm text-zinc-500 max-w-sm mx-auto">
          Este motor analiza oportunidades abiertas y detecta las que están en riesgo de perderse antes de que suceda.
        </p>
        <div className="mt-6 inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
          En desarrollo — CEN-1055
        </div>
      </div>
    </div>
  );
}
