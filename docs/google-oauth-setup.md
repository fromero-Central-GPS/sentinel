# Google OAuth Setup — Clerk Production Instance

## ⚠️ Diagnóstico actualizado (2026-06-26)

La API de Clerk (`clerk.supersonics.cl/v1/environment`) muestra:

1. **Google One Tap está habilitado** (`google_one_tap` en first_factors) — esto requiere Google OAuth credentials para funcionar
2. **Google OAuth está habilitado** (`oauth_google.enabled = true`)
3. **NO hay Client ID/Secret configurado** (sin `custom_credentials`)

**Si Google One Tap está activado SIN credenciales, causa exactamente el error `Missing required parameter: client_id`.**

→ Recomendación: **deshabilitar Google One Tap** en Clerk Dashboard hasta que las credenciales OAuth estén configuradas. Esto evitará el error y permitirá que email/password funcione sin interferencia.

## Problema

`clerk.supersonics.cl` es una instancia **production** de Clerk. Las instancias production **no tienen** shared OAuth credentials como las de desarrollo. El error:

```
Access blocked: Authorization Error
Missing required parameter: client_id
Error 400: invalid_request
```

ocurre porque Clerk redirige a Google OAuth sin `client_id` — no hay Client ID/Secret configurados en Clerk Dashboard.

## Prerrequisito: Google Cloud OAuth 2.0 Client ID

### 1. Crear OAuth 2.0 Client ID en Google Cloud Console

1. Ir a https://console.cloud.google.com/apis/credentials
2. Seleccionar el proyecto (ej: `snappy-surf-492813-s7` o crear uno nuevo)
3. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
4. Application type: **Web application**
5. Name: `Sentinel (Clerk)` o similar
6. **Authorized redirect URIs** — agregar:
   ```
   https://clerk.supersonics.cl/v1/oauth_callback/google
   ```
   (Este es el callback que Clerk usa después de la autenticación de Google)
7. Click **Create**
8. Copiar el **Client ID** y **Client Secret**

### 2. Configurar OAuth consent screen

Si es la primera vez:
1. Ir a https://console.cloud.google.com/apis/credentials/consent
2. User Type: **External** (para cualquier usuario de Google)
3. App name: `Sentinel`
4. User support email: `fromero@centralgps.cl`
5. Scopes: `email`, `profile`, `openid` (mínimo necesario)
6. Test users: agregar `Francisco.Analyze@gmail.com` y cualquier otro tester
7. Click **Save and continue**

## Configurar Clerk Dashboard

1. Ir a https://dashboard.clerk.com
2. Seleccionar la app de Sentinel (instancia `clerk.supersonics.cl`)
3. Ir a **User & Authentication** → **Social Connections** → **Google**
4. Activar **Use custom credentials**
5. Pegar:
   - **Client ID** (de Google Cloud Console)
   - **Client Secret** (de Google Cloud Console)
6. **Authorized redirect URIs** en Clerk deben incluir:
   ```
   https://clerk.supersonics.cl/v1/oauth_callback/google
   ```
7. Click **Save**

## Verificar

1. Ir a https://sentinel.supersonics.cl/sign-in
2. Click "Sign in with Google"
3. Debería redirigir a Google para autorización
4. Seleccionar cuenta Google
5. Redirigir de vuelta a Sentinel dashboard

## Workaround mientras se configura

El sign-in con **email + password** funciona sin Google OAuth:
1. Ir a https://sentinel.supersonics.cl/sign-up
2. Crear cuenta con email + password
3. Verificar el código enviado al email
4. Sign in con email + password

## Troubleshooting

### Error: "Missing required parameter: client_id"

1. Verificar que Google One Tap **NO** esté habilitado sin credenciales:
   - Clerk Dashboard → User & Authentication → Social Connections → Google
   - Desmarcar **"Enable Google One Tap"** si no hay Client ID configurado
2. Verificar que las credenciales OAuth estén correctamente guardadas:
   - Clerk Dashboard → Social Connections → Google
   - Debe mostrar **"Custom credentials"** como activo
   - Client ID y Client Secret deben estar completos

### Error: "redirect_uri_mismatch"

El redirect URI en Google Cloud Console no coincide con el de Clerk:
- Google Cloud Console: `https://clerk.supersonics.cl/v1/oauth_callback/google`
- Verificar que sea exactamente igual (sin `/` al final, sin http://)

### Verificar estado actual

```bash
# Ver estado de Google OAuth en Clerk
curl -s https://clerk.supersonics.cl/v1/environment | python3 -c "
import sys,json
d = json.load(sys.stdin)
google = d['user_settings']['social']['oauth_google']
print(f'Google OAuth enabled: {google[\"enabled\"]}')
# Verificar first_factors para Google One Tap
ff = d['auth_config']['first_factors']
print(f'First factors: {ff}')
if 'google_one_tap' in ff:
    print('⚠️  Google One Tap habilitado — requiere credenciales OAuth!')
"
```

## References

- Clerk Docs — Google Social Connection: https://clerk.com/docs/authentication/social-connections/google
- Google Cloud Console: https://console.cloud.google.com/apis/credentials
- Clerk Dashboard: https://dashboard.clerk.com
