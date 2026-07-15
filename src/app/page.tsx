import { Show, SignInButton, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { Logo, LogoMark } from '@/components/Logo';

const ENGINES = [
  {
    title: 'Forense',
    description:
      'Clasifica cada conversación perdida por fase y causa raíz. Sabe exactamente por qué se cayó el negocio y cuáles vale la pena recuperar.',
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
  },
  {
    title: 'Live Opp',
    description:
      'Detecta oportunidades abiertas en riesgo antes de que se pierdan. Alertas tempranas por inactividad, señales de enfriamiento y próximos pasos.',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    title: 'Won Track',
    description:
      'Analiza los patrones detrás de tus deals ganados: señales, tiempos de cierre y mensajes que funcionan, para replicar el éxito en todo el equipo.',
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-950/40',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    ),
  },
  {
    title: 'Split the Funnel',
    description:
      'Separa tu funnel por intención declarada y creada. Cohortes comparables para saber qué canal y qué discurso convierten de verdad.',
    color: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V3" />
        <path d="M6 3h.01" />
        <path d="M18 3h.01" />
        <path d="M12 12v9" />
      </svg>
    ),
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Conecta tu CRM',
    description:
      'Vincula tu cuenta de GoHighLevel en minutos. Sentinel sincroniza conversaciones, oportunidades y pipelines de forma automática y segura.',
  },
  {
    number: '02',
    title: 'La IA analiza cada conversación',
    description:
      'Los motores de Sentinel clasifican negocios perdidos, detectan riesgo en oportunidades abiertas y extraen los patrones de tus ventas ganadas.',
  },
  {
    number: '03',
    title: 'Actúa antes de perder el negocio',
    description:
      'Recibe digest diarios por WhatsApp, alertas priorizadas y acciones de un clic directo a tu CRM para retomar cada oportunidad a tiempo.',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="Sentinel — inicio">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-zinc-600 md:flex dark:text-zinc-400">
            <a href="#motores" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Motores
            </a>
            <a href="#como-funciona" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Cómo funciona
            </a>
            <Link href="/pricing" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Planes
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Show when="signed-in">
              <Link
                href="/dashboard"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
              >
                Ir al dashboard
              </Link>
              <UserButton />
            </Show>
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                  Iniciar sesión
                </button>
              </SignInButton>
              <Link
                href="/sign-up"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
              >
                Comenzar
              </Link>
            </Show>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.12),_transparent_60%)]"
          />
          <div className="mx-auto flex max-w-4xl flex-col items-center px-6 pt-24 pb-20 text-center sm:pt-32">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-xs font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
              </span>
              Inteligencia comercial para equipos de venta
            </span>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">
              Recupera el revenue que tu pipeline está dejando ir
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-pretty text-zinc-600 dark:text-zinc-400">
              Sentinel analiza cada conversación de tu CRM con IA: clasifica por qué se pierden los
              negocios, alerta oportunidades en riesgo y descubre los patrones detrás de tus ventas
              ganadas.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
              <Show when="signed-in">
                <Link
                  href="/dashboard"
                  className="rounded-lg bg-indigo-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500"
                >
                  Ir al dashboard
                </Link>
              </Show>
              <Show when="signed-out">
                <Link
                  href="/sign-up"
                  className="rounded-lg bg-indigo-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500"
                >
                  Comenzar ahora
                </Link>
              </Show>
              <Link
                href="/pricing"
                className="rounded-lg border border-zinc-300 px-8 py-3.5 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
              >
                Ver planes
              </Link>
            </div>
            <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-zinc-500 dark:text-zinc-500">
              <span className="font-medium uppercase tracking-wider text-xs">Se integra con</span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">GoHighLevel</span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                WhatsApp Business
              </span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">Meta</span>
            </div>
          </div>
        </section>

        {/* Motores */}
        <section id="motores" className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Cuatro motores, un objetivo: cerrar más
              </h2>
              <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
                Cada motor ataca una etapa distinta del ciclo comercial, desde el diagnóstico de lo
                perdido hasta la réplica de lo ganado.
              </p>
            </div>
            <div className="mt-14 grid gap-6 sm:grid-cols-2">
              {ENGINES.map((engine) => (
                <div
                  key={engine.title}
                  className="rounded-2xl border border-zinc-200 bg-white p-8 transition hover:shadow-lg hover:shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:shadow-none dark:hover:border-zinc-700"
                >
                  <div
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${engine.bg} ${engine.color}`}
                  >
                    {engine.icon}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold">{engine.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {engine.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section id="como-funciona" className="border-t border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                De la conexión a la acción en el mismo día
              </h2>
              <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
                Sin implementaciones largas ni migraciones. Sentinel trabaja sobre los datos que ya
                tienes en tu CRM.
              </p>
            </div>
            <div className="mt-14 grid gap-10 md:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.number}>
                  <span className="text-sm font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                    {step.number}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="px-6 pb-24">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-800 px-8 py-16 text-center sm:px-16">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Tu pipeline ya tiene las respuestas
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-indigo-100">
              Deja de adivinar por qué se pierden los negocios. Conecta tu CRM y empieza a recuperar
              revenue hoy.
            </p>
            <div className="mt-8 flex justify-center">
              <Show when="signed-in">
                <Link
                  href="/dashboard"
                  className="rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
                >
                  Ir al dashboard
                </Link>
              </Show>
              <Show when="signed-out">
                <Link
                  href="/sign-up"
                  className="rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
                >
                  Comenzar ahora
                </Link>
              </Show>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5 text-sm text-zinc-500 dark:text-zinc-400">
            <LogoMark className="h-5 w-5" />
            <span>© {new Date().getFullYear()} Sentinel. Todos los derechos reservados.</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-zinc-500 dark:text-zinc-400">
            <Link href="/pricing" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Planes
            </Link>
            <a href="#motores" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Motores
            </a>
            <a href="#como-funciona" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Cómo funciona
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
