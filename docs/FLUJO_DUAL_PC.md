# Flujo de trabajo dual-PC + VPS

Setup para trabajar el mismo proyecto desde dos ordenadores en distintos sitios,
con el VPS como copia de respaldo y "Claude Code remoto" siempre disponible.

## Inventario actual

### Repos en GitHub

| Repo | URL | Contenido |
|---|---|---|
| `roundweb` | `github.com/alfonsinmoi/roundweb.git` | Frontend React + backend Flask + módulo Odoo (proyecto principal) |
| `odoo-deploy` | `github.com/calcaldecampusport-maker/odoo-deploy.git` | Scripts de instalación Odoo, automatizaciones banking, docs HANDOFF |
| `claude-projects` | `github.com/calcaldecampusport-maker/claude-projects.git` | Skills programadas (facturas, informes, …) |

### VPS

- **Host:** `212.227.40.122`
- **Alias SSH local:** `round-vps`
- **Repos clonados en:** `/root/projects/{roundweb,odoo-deploy,claude-projects}`
- **Backups WordPress:** `/var/backups/wordpress/2026-04-14/` (5 archivos, 572 MB)
- **Claude Code instalado:** `/usr/local/bin/claude` (v2.1.119)

## Flujo diario

### Al empezar a trabajar (en cualquier PC)

```bash
cd /ruta/al/repo
git pull --rebase            # traer cambios del otro PC / VPS
npm install                  # solo si package.json cambió
```

### Al terminar / cambiar de máquina

```bash
git add -A
git commit -m "wip: …"
git push
```

### Continuar Claude Code en otra máquina

Si dejas una sesión a medias en el VPS y quieres seguirla desde otro PC:

```bash
ssh round-vps
cd /root/projects/roundweb
claude --continue
```

Si quieres que la sesión la lance Claude Code de tu PC local (más cómodo
visualmente con tu Chrome para Playwright):

```bash
cd C:/Users/pc/Documents/roundwebnoofit
git pull
claude --continue
```

## Setup en un PC nuevo (segundo ordenador)

### 1. Instalar prerequisitos

- **Git for Windows**: https://git-scm.com/download/win
- **Node.js LTS**: https://nodejs.org/
- **Claude Code**: `npm install -g @anthropic-ai/claude-code`
- **VS Code** (opcional): https://code.visualstudio.com/

### 2. Configurar Git

```bash
git config --global user.name "Tu nombre"
git config --global user.email "calcalde@wiemspro.com"
git config --global credential.helper manager
```

### 3. Clonar los repos

```bash
mkdir -p ~/Documents
cd ~/Documents
git clone https://github.com/alfonsinmoi/roundweb.git
git clone https://github.com/calcaldecampusport-maker/odoo-deploy.git
git clone https://github.com/calcaldecampusport-maker/claude-projects.git
```

### 4. Copiar la clave SSH del VPS

Desde el PC original copia `~/.ssh/odoo_carajfam` (sin extensión) al nuevo PC
en la misma ruta. **NO se sube a git.** Usa USB, Bitwarden, 1Password o
copia segura.

### 5. Configurar alias SSH

Edita `~/.ssh/config` (créalo si no existe):

```
Host round-vps
  HostName 212.227.40.122
  User root
  IdentityFile ~/.ssh/odoo_carajfam
  IdentitiesOnly yes
  ServerAliveInterval 60
  ServerAliveCountMax 3
```

En Windows desde Git Bash: `chmod 600 ~/.ssh/odoo_carajfam` o el comando equivalente.

### 6. Probar la conexión

```bash
ssh round-vps "hostname"
# Debe imprimir: ubuntu
```

### 7. Instalar dependencias del proyecto

```bash
cd ~/Documents/roundweb
npm install
```

### 8. Login en Round (frontend)

Abre `https://round.wiemspro.com` o `https://round.noofit.com` en el
navegador y haz login con tus credenciales habituales.

## Comandos útiles

### Backups WordPress

```bash
# Listar backups disponibles en el VPS
ssh round-vps "ls -lh /var/backups/wordpress/"

# Descargar un backup completo a local
scp -r round-vps:/var/backups/wordpress/2026-04-14 ~/Downloads/

# Descargar solo el de DB (más ligero)
scp round-vps:/var/backups/wordpress/2026-04-14/backup_*-db.gz ~/Downloads/
```

### Servicios Round en VPS

```bash
ssh round-vps "systemctl status round_config_api"
ssh round-vps "journalctl -u round_config_api -n 50 --no-pager"
ssh round-vps "systemctl list-timers round_*"
```

### Despliegue rápido frontend

Desde el repo local tras compilar:

```bash
npm run build
scp -r dist/. round-vps:/var/www/round/
```

### Despliegue rápido backend

```bash
scp round_config_api/app/foo.py round-vps:/opt/round_config_api/app/
ssh round-vps "systemctl restart round_config_api"
```

## Reglas de convivencia dual-PC

1. **Siempre `git pull` antes de empezar.** Si te olvidas, te tocará resolver
   conflictos.
2. **Siempre `git push` antes de cerrar sesión.** El otro PC necesita verlo.
3. **Si tienes cambios sin pushear y vas a otro sitio, llévate el portátil
   o haz `git stash; git push --force-with-lease` para forzar guardar.**
4. **No edites el VPS directamente** salvo emergencias. Edita en local,
   commit, push, y `ssh round-vps "cd ... && git pull"` para que el VPS
   tenga lo mismo.
5. **Las claves SSH y los `.env`** NUNCA van a git. Se transfieren por
   canal seguro (gestor de contraseñas, USB, Bitwarden).

## Qué NO está en GitHub (porque no debe)

- `.env` con credenciales (DB, Resend, NoofitPro, Odoo)
- Claves SSH (`~/.ssh/odoo_carajfam`)
- Backups WordPress (están en VPS `/var/backups/wordpress/`)
- AnyDesk.exe y otros instaladores

## Acceso desde móvil

Con la app **Termius** (iOS/Android) o **JuiceSSH** (Android):

1. Importas la clave `odoo_carajfam`
2. Configuras host `212.227.40.122` user `root`
3. Conectas y puedes lanzar `cd /root/projects/roundweb && claude --continue`

Útil para:
- Revisar logs de cron
- Ver el estado del CRM
- Continuar una conversación con Claude Code mientras estás de viaje
