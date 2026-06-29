# Clerk DNS — Custom Domain Setup

## Por qué necesitamos DNS de Clerk

Actualmente Sentinel usa los dominios por defecto de Clerk (`clerk.sentinel.xxx`).
Para tener URLs de autenticación profesionales con nuestro dominio necesitamos:

1. Dominio de sign-in: `auth.centralgps.cl` o `accounts.centralgps.cl`
2. Opcional: email desde dominio propio (`noreply@centralgps.cl`)

## Pasos

### 1. Obtener el CNAME target de Clerk

1. Ir a [Clerk Dashboard](https://dashboard.clerk.com) → seleccionar la app de Sentinel
2. Ir a **Domains** en el menú lateral
3. Click **Add Domain**
4. Ingresar `accounts.centralgps.cl` (o el subdominio que prefieras)
5. Clerk mostrará una pantalla con el CNAME target exacto, algo como:
   ```
   accounts.centralgps.cl  CNAME  abc123.clerk.services
   ```

### 2. Crear el registro DNS en Cloudflare

Editar `scripts/setup-cloudflare-domain.sh` y descomentar/editar esta línea:

```bash
"CNAME|accounts|<clerk-cname-target>|false|1"
```

Reemplazando `<clerk-cname-target>` con el valor que te dio Clerk.

Luego ejecutar:

```bash
export CLOUDFLARE_API_TOKEN='tu-token'
bash scripts/setup-cloudflare-domain.sh
```

### 3. Verificar en Clerk

1. Volver a Clerk Dashboard → Domains
2. El dominio debería aparecer como **Verified** en unos minutos
3. Si no verifica automáticamente, click en **Verify**

### 4. Actualizar URLs en Vercel

Una vez verificado, actualizar las env vars en Vercel:

```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=https://accounts.centralgps.cl/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=https://accounts.centralgps.cl/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=https://sentinel.centralgps.cl
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=https://sentinel.centralgps.cl
```

### 5. Probar

```bash
curl -I https://accounts.centralgps.cl/sign-in
# Debería redirigir a Clerk
```

## Registros DNS necesarios (resumen)

| Tipo  | Nombre     | Contenido              | Propósito                  |
| ----- | ---------- | ---------------------- | -------------------------- |
| CNAME | `sentinel` | `cname.vercel-dns.com` | App en Vercel              |
| CNAME | `accounts` | `<valor de Clerk>`     | Auth Clerk                 |
| CNAME | `email`    | `<valor de Clerk>`     | Email tracking (opcional)  |
| TXT   | `mail`     | `v=spf1 ...`           | SPF para emails (opcional) |
