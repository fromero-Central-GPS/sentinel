'use client';

import { useAuth } from '@clerk/nextjs';
import { useOrganizationList, useOrganization } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type WizardStep = 'welcome' | 'create_org' | 'ghl' | 'meta' | 'done';

type GhlStatus = 'loading' | 'configured' | 'missing' | 'error';
type MetaStatus = 'loading' | 'configured' | 'missing' | 'error';

export default function OnboardingPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { organization } = useOrganization();
  const { isLoaded: orgListLoaded, userMemberships, createOrganization } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const router = useRouter();

  const [step, setStep] = useState<WizardStep>('welcome');
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [orgError, setOrgError] = useState('');

  // GHL form
  const [ghlToken, setGhlToken] = useState('');
  const [ghlLocationId, setGhlLocationId] = useState('');
  const [ghlSaving, setGhlSaving] = useState(false);
  const [ghlError, setGhlError] = useState('');

  // Meta form
  const [metaWabaId, setMetaWabaId] = useState('');
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaError, setMetaError] = useState('');

  const [ghlStatus, setGhlStatus] = useState<GhlStatus>('loading');
  const [metaStatus, setMetaStatus] = useState<MetaStatus>('loading');

  // Redirect unauthenticated users
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push('/sign-in?redirect_url=/onboarding');
    }
  }, [isLoaded, isSignedIn, router]);

  // Detect existing configuration and redirect if already fully configured
  useEffect(() => {
    if (!isSignedIn || !orgListLoaded) return;

    const hasOrg = userMemberships?.data && userMemberships.data.length > 0;

    if (!hasOrg) {
      setStep('create_org');
      return;
    }

    // Check GHL status
    fetch('/api/settings/ghl')
      .then((r) => r.json())
      .then((data: any) => {
        if (data.ghlApiToken && data.ghlLocationId) {
          setGhlStatus('configured');
          setGhlToken(data.ghlApiToken);
          setGhlLocationId(data.ghlLocationId);

          // Check Meta status
          return fetch('/api/settings/meta').then((r2) => r2.json());
        }
        setStep('ghl');
        setGhlStatus('missing');
        return null;
      })
      .then((metaData: any) => {
        if (!metaData) return;
        if (metaData.metaWabaId && metaData.metaAccessToken) {
          setMetaStatus('configured');
          // Everything is configured — redirect to dashboard
          router.push('/dashboard');
        } else {
          setStep('meta');
          setMetaStatus('missing');
        }
      })
      .catch(() => {
        setGhlStatus('error');
      });
  }, [isSignedIn, orgListLoaded, userMemberships, router]);

  // Auto-advance when org exists
  useEffect(() => {
    if (step === 'create_org' && orgListLoaded && userMemberships?.data && userMemberships.data.length > 0) {
      if (ghlStatus === 'loading') {
        // Trigger check
        fetch('/api/settings/ghl')
          .then((r) => r.json())
          .then((data: any) => {
            if (data.ghlApiToken && data.ghlLocationId) {
              setGhlStatus('configured');
              setStep('meta');
            } else {
              setStep('ghl');
              setGhlStatus('missing');
            }
          })
          .catch(() => setGhlStatus('error'));
      } else {
        setStep('ghl');
      }
    }
  }, [step, orgListLoaded, userMemberships, ghlStatus]);

  async function handleCreateOrg() {
    if (!orgName.trim()) return;
    setCreatingOrg(true);
    setOrgError('');

    try {
      const created = await createOrganization!({
        name: orgName.trim(),
        slug: orgSlug.trim() || undefined,
      });
      if (created) {
        // Sync org and user to Neon DB immediately (bypasses webhook delay)
        try {
          await fetch('/api/orgs/sync', { method: 'POST' });
        } catch {
          // Non-critical — webhook will catch it eventually
          console.warn('Org sync to Neon failed, webhook will handle');
        }
        setStep('ghl');
      }
    } catch (e: any) {
      setOrgError(e.errors?.[0]?.message || 'Error al crear la organización. Intenta de nuevo.');
    } finally {
      setCreatingOrg(false);
    }
  }

  async function handleSaveGhl() {
    if (!ghlToken.trim() || !ghlLocationId.trim()) return;
    setGhlSaving(true);
    setGhlError('');

    try {
      const res = await fetch('/api/settings/ghl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ghlApiToken: ghlToken, ghlLocationId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al guardar');
      }
      setGhlStatus('configured');
      setStep('meta');
    } catch (e: any) {
      setGhlError(e.message);
    } finally {
      setGhlSaving(false);
    }
  }

  async function handleSaveMeta() {
    if (!metaWabaId.trim() || !metaPhoneNumberId.trim() || !metaAccessToken.trim()) return;
    setMetaSaving(true);
    setMetaError('');

    try {
      const res = await fetch('/api/settings/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metaWabaId, metaPhoneNumberId, metaAccessToken }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al guardar');
      }
      setMetaStatus('configured');
      setStep('done');
    } catch (e: any) {
      setMetaError(e.message);
    } finally {
      setMetaSaving(false);
    }
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-lg">
        {/* Step indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {(['create_org', 'ghl', 'meta', 'done'] as WizardStep[]).map((s, i) => {
            const stepIndex = ['create_org', 'ghl', 'meta', 'done'].indexOf(step);
            const currentIdx = ['create_org', 'ghl', 'meta', 'done'].indexOf(s);
            const isActive = currentIdx <= stepIndex;
            return (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-200 text-zinc-400'
                  }`}
                >
                  {isActive && stepIndex > currentIdx ? '✓' : i + 1}
                </div>
                {i < 3 && (
                  <div
                    className={`h-0.5 w-8 ${currentIdx < stepIndex ? 'bg-blue-600' : 'bg-zinc-200'}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          {/* Step: Welcome (only shown before org detection) */}
          {step === 'welcome' && (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
                <svg className="h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold">Bienvenido a Sentinel</h1>
              <p className="text-zinc-500">
                Analiza conversaciones de tu equipo comercial, recupera oportunidades perdidas y optimiza tu pipeline.
              </p>
              <div className="animate-pulse text-sm text-blue-600 font-medium">
                Preparando tu espacio de trabajo...
              </div>
            </div>
          )}

          {/* Step: Create Organization */}
          {step === 'create_org' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-bold">Crea tu empresa</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Este será tu espacio de trabajo en Sentinel. Cada empresa tiene sus propias credenciales y datos.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Nombre de la empresa *
                  </label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => {
                      setOrgName(e.target.value);
                      setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
                    }}
                    placeholder="Ej: Transportes del Sur Ltda."
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Slug (identificador único)
                  </label>
                  <input
                    type="text"
                    value={orgSlug}
                    onChange={(e) => setOrgSlug(e.target.value)}
                    placeholder="transportes-del-sur"
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                  />
                  <p className="mt-1 text-xs text-zinc-400">
                    Usado en URLs. Sugerido: {orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || '...'}
                  </p>
                </div>

                {orgError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {orgError}
                  </div>
                )}

                <button
                  onClick={handleCreateOrg}
                  disabled={creatingOrg || !orgName.trim()}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {creatingOrg ? 'Creando...' : 'Crear empresa'}
                </button>
              </div>
            </div>
          )}

          {/* Step: Connect GHL */}
          {step === 'ghl' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-bold">Conectá GoHighLevel</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Sentinel necesita acceso a tu cuenta de GHL para analizar conversaciones y oportunidades.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    GHL API Token *
                  </label>
                  <input
                    type="password"
                    value={ghlToken}
                    onChange={(e) => setGhlToken(e.target.value)}
                    placeholder="Ingresá tu API token de GHL"
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Location ID *
                  </label>
                  <input
                    type="text"
                    value={ghlLocationId}
                    onChange={(e) => setGhlLocationId(e.target.value)}
                    placeholder="Ej: abc123xyz"
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                  />
                </div>

                {ghlError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {ghlError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={handleSaveGhl}
                    disabled={ghlSaving || !ghlToken.trim() || !ghlLocationId.trim()}
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {ghlSaving ? 'Guardando...' : 'Guardar y continuar'}
                  </button>
                  <button
                    onClick={() => setStep('meta')}
                    className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
                  >
                    Omitir
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step: Connect Meta/WhatsApp */}
          {step === 'meta' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-bold">Conectá WhatsApp Business</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Opcional. Conectá tu cuenta de WhatsApp Business para analizar conversaciones de Meta.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    WABA ID (WhatsApp Business Account ID)
                  </label>
                  <input
                    type="text"
                    value={metaWabaId}
                    onChange={(e) => setMetaWabaId(e.target.value)}
                    placeholder="Ej: 123456789012345"
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Phone Number ID
                  </label>
                  <input
                    type="text"
                    value={metaPhoneNumberId}
                    onChange={(e) => setMetaPhoneNumberId(e.target.value)}
                    placeholder="Ej: 987654321098765"
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Access Token (System User)
                  </label>
                  <input
                    type="password"
                    value={metaAccessToken}
                    onChange={(e) => setMetaAccessToken(e.target.value)}
                    placeholder="Token permanente de Meta"
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                  />
                </div>

                {metaError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {metaError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={handleSaveMeta}
                    disabled={metaSaving}
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {metaSaving ? 'Guardando...' : 'Guardar y continuar'}
                  </button>
                  <button
                    onClick={() => setStep('done')}
                    className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
                  >
                    Omitir
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div className="text-center space-y-6">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <svg className="h-8 w-8 text-green-600" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold">¡Todo listo!</h1>
              <p className="text-zinc-500">
                {ghlStatus === 'configured' && metaStatus === 'configured'
                  ? 'Tenés GHL y WhatsApp Business conectados. Ya podés empezar a analizar conversaciones.'
                  : ghlStatus === 'configured'
                  ? 'GHL está conectado. Podés configurar WhatsApp más tarde desde Settings.'
                  : 'Podés completar la configuración de GHL y WhatsApp en cualquier momento desde Settings.'}
              </p>
              <button
                onClick={() => router.push('/dashboard')}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                Ir al Dashboard
                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Skip to dashboard link */}
        {step !== 'welcome' && step !== 'done' && (
          <div className="mt-4 text-center">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              Ya configuré todo — ir al Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
