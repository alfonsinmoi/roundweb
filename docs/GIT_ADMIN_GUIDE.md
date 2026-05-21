# Guía del administrador — Git, usuarios y aprobaciones

> Documento para **ti** (Moisés, lead del proyecto). Explica paso a paso
> cómo activar las protecciones de la rama, añadir compañeros al repo y
> aprobar sus Pull Requests.
>
> Si eres un dev nuevo, lee mejor [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

---

## Resumen del nuevo flujo

```
┌──────────────────────────────────────────────────────────────────────┐
│   1. Issue/feature             2. Rama automática     3. Dev trabaja │
│      (label "feature")    →       feat/xxx-yyyy    →   commits +     │
│                                                          push        │
│                                                                      │
│   6. Squash & merge       ←   5. Review aprueba   ←   4. Abre PR     │
│      a main                       CI pasa                            │
└──────────────────────────────────────────────────────────────────────┘
```

Hay **dos cosas que tú debes hacer una sola vez** para activarlo todo:
A. Push del commit con la config + activar branch protection en GitHub.
B. Invitar a los compañeros y editar CODEOWNERS.

Lo demás (PRs, review, merge) son acciones del día a día.

---

## A · Activación inicial (una sola vez)

### A.1 Push del commit con la configuración

Desde tu terminal:

```bash
cd ~/Documents/Desarrollo/Web/RoundWeb
git status        # asegúrate que estás en main y sin cambios sueltos
git log --oneline -3
# Debes ver:
#   1b1f8fb docs(arquitectura): manual completo de funcionamiento para onboarding
#   954f772 chore(ci): set up team workflow — PRs, CODEOWNERS, CI, hooks
#   …

git push origin main
```

Cuando el hook `pre-push` te avise:

```
⚠️  Empujando directamente a main.
    El flujo normal es: crear rama → PR → review → merge.
    ¿Seguro que quieres continuar? [y/N]:
```

Responde `y`. **Esta es la única vez que se te permitirá** — después de
hacer el A.2 ni siquiera tú podrás pushear directo a `main`.

Verifica que en GitHub aparecen:
- `.github/workflows/ci.yml`
- `.github/workflows/auto-branch-from-issue.yml`
- `.github/CODEOWNERS`
- `CONTRIBUTING.md` y `docs/ARCHITECTURE.md`

### A.2 Activar Branch Protection en GitHub

Abre en el navegador:
`https://github.com/alfonsinmoi/roundweb/settings/branches`

Click en **"Add branch ruleset"** (o "Add branch protection rule" si tienes la UI clásica) y rellena:

| Campo | Valor |
|---|---|
| **Branch name pattern** | `main` |
| ☑ Require a pull request before merging | activado |
| └ ☑ Require approvals | **1** |
| └ ☑ Dismiss stale pull request approvals when new commits are pushed | activado |
| └ ☑ Require review from Code Owners | activado |
| ☑ Require status checks to pass before merging | activado |
| └ ☑ Require branches to be up to date before merging | activado |
| └ Status checks required (buscador) | `Build & Test` |
| ☑ Require conversation resolution before merging | activado |
| ☑ Do not allow bypassing the above settings | activado |
| ☑ Restrict who can push to matching branches | activado (deja la lista vacía → nadie pushea directo) |

**Save changes**. A partir de este momento:
- Nadie (ni tú) puede pushear directamente a `main`.
- Cada PR necesita 1 aprobación + CI verde + reviewer de CODEOWNERS.

### A.3 Etiquetas (labels) en GitHub

`https://github.com/alfonsinmoi/roundweb/labels`

Crea estas labels (si no existen) — son las que dispararán el bot:

| Label | Color sugerido |
|---|---|
| `feature` | verde `#10B981` |
| `bug` | rojo `#EF4444` |
| `chore` | gris `#6B7280` |
| `docs` | azul `#3B82F6` |
| `refactor` | morado `#8B5CF6` |

### A.4 Crear el `.env.local` para los compañeros

El `VITE_CONFIG_API_TOKEN` no se commitea. Tienes que pasárselo a cada
compañero por canal seguro (Bitwarden, mensaje privado, etc.). Ellos lo
guardarán en `RoundWeb/.env.local` así:

```
VITE_CONFIG_API_TOKEN=<el-token-real>
```

Sin esa variable, todas las llamadas al backend Round dan 401 y la app no
funciona (ver [`ARCHITECTURE.md` §10](./ARCHITECTURE.md)).

---

## B · Añadir un compañero al repo

### B.1 Invitarle a colaborar

`https://github.com/alfonsinmoi/roundweb/settings/access`

1. Click en **"Add people"**
2. Buscar su usuario de GitHub (o su email asociado)
3. Asignarle rol:
   - **Write** — puede crear ramas, abrir PRs, push a ramas que no sean main. *Recomendado para devs*.
   - **Maintain** — además puede gestionar issues/labels. Para sub-leads.
   - **Admin** — todo (solo tú).
4. Send invitation. Cuando acepte, aparece en la lista.

### B.2 Añadirlo a CODEOWNERS

Edita [`.github/CODEOWNERS`](../.github/CODEOWNERS) y descomenta/ajusta
las líneas según el área que le toque. Ejemplo si le asignas Clientes:

```
/src/pages/Clients/    @su-handle-github
```

Si va a tocar varias áreas, repite la línea. Si dos personas son owners
del mismo área, sepáralas con espacio:

```
/src/pages/Clients/    @su-handle  @otro-handle
```

Sube el cambio con una PR normal (no se puede pushear directo a main):

```bash
./scripts/new-feature.sh chore "asignar owners a clientes"
# Edita el archivo y commit
git commit -am "chore: asignar @fulano como owner de /src/pages/Clients"
git push
# Abre la PR en GitHub, te apruebas tú mismo a ti (si tu org lo permite) o
# pídeselo al sub-lead.
```

### B.3 Pasarle los secretos

Envíale por canal seguro:
- El `VITE_CONFIG_API_TOKEN` (para `.env.local`)
- Credenciales de test NoofitPro si las necesita (`roundgestion@noofit.com` / `1234abcd`)
- (Opcional) Clave SSH al VPS — solo si va a hacer deploys o tocar Flask

### B.4 Decirle qué leer

Pásale estos enlaces — en este orden:

1. [`CONTRIBUTING.md`](../CONTRIBUTING.md) — flujo de trabajo, hooks, naming
2. [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — cómo funciona el código
3. [`CLAUDE.md`](../CLAUDE.md) — infraestructura del VPS (solo si toca deploy)

---

## C · Día a día — aprobar Pull Requests

### C.1 Cómo te llega que hay una PR pendiente

- GitHub te manda email automáticamente porque eres **Code Owner** del área tocada.
- También las ves en `https://github.com/alfonsinmoi/roundweb/pulls`.
- O en la home de GitHub → "Review requested" en la sidebar izquierda.

### C.2 Revisar una PR — paso a paso

Abre la PR. Verás 4 pestañas: **Conversation**, **Commits**, **Checks**, **Files changed**.

**1. Mira el resumen** (pestaña Conversation):
- ¿Tiene descripción clara? ¿Refiere a un issue?
- ¿Hay screenshots si toca UI?
- ¿El checklist está marcado?

**2. Comprueba el CI** (pestaña Checks):
- Debe estar verde **✓ Build & Test**.
- Si está rojo → comenta a tu compañero que mire los logs antes de revisar.

**3. Revisa el código** (pestaña Files changed):

- Por cada archivo verás un diff. Puedes:
  - **Marcar como visto** (☑ Viewed) — colapsa el archivo y lo marca como
    leído, útil cuando son archivos largos.
  - **Comentar en una línea**: hover sobre el número de línea → botón "+"
    azul → escribe comentario → "Add single comment" (público y suelto) o
    "Start a review" (se quedan en draft hasta que termines).
  - **Sugerir un cambio inline**: en el comentario, click en el icono ±,
    escribe el cambio dentro del bloque ` ```suggestion`. Tu compañero
    puede aceptarlo con un click.

**4. Decidir veredicto** (botón verde "Review changes" arriba a la derecha):

| Opción | Cuándo |
|---|---|
| **Comment** | Para dudas/preguntas, sin bloquear ni aprobar |
| **Approve** | Está bien, ya se puede mergear |
| **Request changes** | Hay cosas que cambiar antes de mergear (bloquea el merge) |

Escribe un resumen y submit.

### C.3 Cosas que debes mirar siempre

- [ ] El código no rompe convenciones del [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [ ] No hay `console.log` olvidados
- [ ] No hay credenciales/tokens en el código
- [ ] No hay `window.alert/confirm` (deben usar Toast/ConfirmDialog)
- [ ] Si toca UI: usa CSS variables, no hex hardcodeados
- [ ] Si añade una librería pesada (charts, xlsx…): solo en la página que la usa, no en el bundle global
- [ ] Si toca `api.js`/`configApi.js`: ¿se mantiene la cache? ¿se invalida cuando se debe?
- [ ] Tests pasan (lo verifica el CI, pero confirma que hay tests si la PR los necesita)

### C.4 Mergear

Cuando la PR esté **Approved** + CI verde + conversaciones resueltas:

Botón verde abajo: **"Squash and merge"** (recomendado — un commit limpio en main).

- Edita el título del commit final si hace falta (debe seguir conventional commits)
- Confirm squash and merge
- GitHub borrará la rama automáticamente (si está marcado en Settings → "Automatically delete head branches")

### C.5 Si la PR necesita cambios

- Click "Request changes", deja tu feedback
- El autor empuja nuevos commits a su rama
- **Importante**: tu aprobación previa se descarta automáticamente (porque
  marcamos "Dismiss stale approvals" en branch protection)
- Vuelves a revisar y apruebas (o pides más cambios)

---

## D · Casos especiales

### D.1 Una PR urgente sin que esté el dueño del área

Si necesitas mergear algo urgente y el Code Owner del archivo está
ausente, **temporalmente** puedes desactivar "Require review from Code
Owners" en branch protection, mergeas, y lo vuelves a activar.

⚠️ Hazlo solo para hotfixes reales y avisa al equipo.

### D.2 Cambiar el flujo más adelante (más aprobaciones, etc.)

`Settings → Branches → main → Edit`. Puedes cambiar:
- Required approvals: 1 → 2 (si crece el equipo y quieres dos pares de ojos)
- Añadir más status checks si añades workflows (lint, security, deploy preview, etc.)

### D.3 Un dev se va del equipo

`Settings → Access → su-handle → Remove`. Y edita CODEOWNERS para
quitar/reasignar sus áreas. Sin esto, sus PRs quedan colgando esperando
aprobación de alguien que ya no está.

### D.4 Revocar el token API porque se filtró

Cambia `VITE_CONFIG_API_TOKEN` en el backend (es valor único compartido).
Pasa el nuevo a todo el equipo. Cada uno actualiza su `.env.local` y
reconstruye en local. En el deploy de producción tendrás que rebuildear
el bundle y subirlo.

---

## E · Comandos útiles que vas a usar

```bash
# Ver el estado actual
git status
git log --oneline --graph --decorate -10

# Pull antes de hacer nada (siempre)
git checkout main
git pull origin main

# Crear una rama nueva con el helper
./scripts/new-feature.sh feat "descripción corta"
# o
npm run new-feature

# Si una rama vieja te molesta localmente (ya está mergeada)
git branch -d feat/cosa-vieja           # borra local
git push origin --delete feat/cosa-vieja # borra remota

# Sincronizar tu rama con main mientras trabajas
git fetch origin
git rebase origin/main      # más limpio que merge
# Si hay conflictos, resuélvelos y:
git add . && git rebase --continue
git push --force-with-lease  # necesario tras rebase
```

---

## F · FAQ rápido

**Q: ¿Y si un dev mete `console.log` y se cuela?**
A: Tendrás que pedir cambios en la PR. No hay linter automático aún (es un
TODO posible — ESLint + lint-staged). Por ahora, revisión humana.

**Q: ¿Puedo aprobar mi propia PR?**
A: GitHub por defecto **no** te deja aprobarte a ti mismo. Si eres el
único admin, tienes que dejar "Required approvals = 0" o pedirle a otra
persona que revise. Recomendación: incluso si trabajas solo, abre PRs (no
push directo) para que quede el historial; auto-mérgelas si "Require
approvals = 0".

**Q: ¿Y los hotfixes urgentes?**
A: Sigue el mismo flujo, etiqueta la PR con `hotfix` o `urgent` para
visibilidad. Si hay protección estricta y nadie puede aprobar, sigue D.1.

**Q: ¿Cómo veo cuántas PRs están abiertas y de quién?**
A: `https://github.com/alfonsinmoi/roundweb/pulls`. Filtra por `is:open author:nombre`.

**Q: ¿El CI falla y el dev dice que en local le pasa?**
A: Suele ser que tiene archivos sin commitear, o `.env.local` distinto, o
un cache de Vite roto. Pídele:
```bash
rm -rf node_modules dist .vite
npm install
npm test && npm run build
```

**Q: ¿El hook `commit-msg` rechaza un mensaje y el dev no entiende por qué?**
A: El error explica el formato. Si insiste, puede saltarlo con
`git commit --no-verify` (no recomendado, queda en el historial con
formato malo y se nota en code review).

**Q: ¿El bot no crea la rama cuando etiqueto un issue?**
A: Pestaña **Actions** del repo → busca el workflow "Auto-create feature
branch from issue" → mira el log del último run. Suele ser:
- La label no es exactamente `feature/bug/chore/docs/refactor`
- Permisos del `GITHUB_TOKEN` insuficientes (mira Settings → Actions → General → Workflow permissions: ☑ "Read and write")
