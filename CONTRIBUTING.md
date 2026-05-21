# Contribuir a Round

Guía rápida para trabajar en equipo en este repo.

## 1. Setup inicial (una sola vez por PC)

```bash
git clone https://github.com/alfonsinmoi/roundweb.git
cd roundweb
npm install               # instala deps + activa husky automáticamente
chmod +x scripts/*.sh     # asegura permisos del helper
```

## 2. Flujo de trabajo por feature

### Opción A — desde un Issue (recomendado)

1. Crea un Issue en GitHub describiendo lo que vas a hacer.
2. Etiquétalo con uno de: `feature`, `bug`, `chore`, `docs`, `refactor`.
3. El workflow [`auto-branch-from-issue.yml`](.github/workflows/auto-branch-from-issue.yml) **crea automáticamente la rama** y comenta en el issue cómo trabajar:
   ```
   git fetch origin
   git checkout feat/123-mi-rama
   ```

### Opción B — desde tu terminal (script local)

```bash
./scripts/new-feature.sh feat "Nuevo filtro de clientes por categoría"
# → crea, publica y se cambia a la rama feat/nuevo-filtro-de-clientes-por-categoria
```

Sin argumentos lanza un wizard interactivo:

```bash
./scripts/new-feature.sh
```

## 3. Convenciones de naming

### Ramas

```
<tipo>/<descripcion-en-kebab-case>
```

Tipos: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`, `perf`

### Commits — Conventional Commits

```
<tipo>(<scope opcional>): <descripción imperativa>
```

Ejemplos:

```
feat(clientes): añadir filtro por categoría
fix(login): respetar return tras login exitoso
refactor(api): centralizar manejo de 401 en interceptor
docs(readme): documentar variable VITE_CONFIG_API_TOKEN
```

El hook `commit-msg` valida automáticamente cada commit. Si necesitas saltarlo:

```bash
git commit --no-verify -m "wip: experimento"
```

## 4. Antes de hacer push

El hook `pre-push` lanza automáticamente:

```bash
npm test
npm run build
```

Si falla, el push se cancela. Salta con `git push --no-verify` (no recomendado).

## 5. Pull Requests

1. Abre PR desde tu rama hacia `main`.
2. La plantilla [`pull_request_template.md`](.github/pull_request_template.md) se rellena sola.
3. GitHub Actions ejecutará el [pipeline CI](.github/workflows/ci.yml) — debe pasar verde.
4. CODEOWNERS exige aprobación de los owners del área tocada (ver [`.github/CODEOWNERS`](.github/CODEOWNERS)).
5. Una vez aprobada y con CI verde → **Squash and merge** a `main`.

### Reglas de oro

- **Una PR = un cambio coherente.** Si descubres bugs colaterales, abre otra rama.
- **Renueva tu rama con `main` antes de pedir review** si han pasado días:
  ```bash
  git fetch origin
  git rebase origin/main   # o merge, lo que prefieras
  ```
- **No pushees a `main` directamente.** El hook te avisará y la branch protection te lo bloqueará.

## 6. Branch protection (configurar UNA vez en GitHub)

Como admin del repo, en GitHub:

`Settings → Branches → Add branch protection rule → main`

Marcar:
- [x] **Require a pull request before merging**
  - [x] Require approvals: **1**
  - [x] Dismiss stale pull request approvals when new commits are pushed
  - [x] Require review from Code Owners
- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - [x] Status checks required: `Build & Test`
- [x] **Require conversation resolution before merging**
- [x] **Do not allow bypassing the above settings**
- [x] **Restrict who can push to matching branches** (vacío = nadie hace push directo)

## 7. Estructura del proyecto

| Carpeta | Owner por defecto |
|---|---|
| `src/utils/` y `src/contexts/` | lead (API/auth core) |
| `src/components/UI.jsx`, `src/index.css` | lead (design system) |
| `src/pages/Clients/` | (asignar a quien lleve Clientes) |
| `src/pages/Clases.jsx`, `Actividades.jsx` | (asignar a quien lleve Agenda) |
| `src/pages/Listados.jsx`, `Dashboard.jsx` | (asignar a quien lleve Reporting) |
| `.github/`, `vite.config.js`, `package.json` | lead (infra) |

Edita [`.github/CODEOWNERS`](.github/CODEOWNERS) según se reparta el equipo.

## 8. Deploy

El deploy a `https://round.wiemspro.com` es **manual** (no automático en merge).
Hazlo solo cuando el lead lo apruebe:

```bash
npm run build
# scp dist/ al servidor (ver CLAUDE.md sección "Despliegues")
```
