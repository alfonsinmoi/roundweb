# Round - Manual de Despliegue

## Requisitos del servidor

- **Node.js** 18+ (recomendado 20 LTS)
- **npm** 9+
- **Nginx** (como reverse proxy y servidor de archivos estticos)
- Acceso HTTPS al dominio donde se desplegar

---

## 1. Clonar el proyecto

```bash
# Copiar el proyecto al servidor
scp -r ./Round usuario@servidor:/var/www/round

# O clonar desde el repositorio si lo tenis en git
git clone <url-repo> /var/www/round
cd /var/www/round
```

## 2. Instalar dependencias y compilar

```bash
cd /var/www/round
npm install
npm run build
```

Esto genera la carpeta `dist/` con los archivos estticos (HTML, JS, CSS).

**Resultado esperado:**
```
dist/
  index.html
  assets/
    index-XXXXX.js    (~340 KB)
    index-XXXXX.css   (~19 KB)
  favicon.svg
```

---

## 3. Configurar Nginx

La app necesita un **reverse proxy** para las llamadas a la API de WiemsPro, ya que el navegador no puede hacer peticiones directas a `pro.wiemspro.com` por CORS.

### Crear configuracin Nginx

```bash
sudo nano /etc/nginx/sites-available/round
```

Contenido:

```nginx
server {
    listen 80;
    server_name round.tudominio.com;

    # Redirigir HTTP a HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name round.tudominio.com;

    # Certificados SSL (usar Let's Encrypt o los vuestros)
    ssl_certificate     /etc/letsencrypt/live/round.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/round.tudominio.com/privkey.pem;

    # Archivos estticos de la app
    root /var/www/round/dist;
    index index.html;

    # SPA: todas las rutas que no son archivos van a index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy reverso para la API de WiemsPro
    location /wiemspro/ {
        proxy_pass https://pro.wiemspro.com/wiemspro/;
        proxy_set_header Host pro.wiemspro.com;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_ssl_server_name on;

        # Necesario: el certificado SSL de WiemsPro puede dar problemas
        proxy_ssl_verify off;

        # CRITICO: pasar las cabeceras de autenticacion de la API al navegador
        proxy_pass_header X-CustomToken;
        proxy_pass_header X-TRAINER_MANAGER;

        # Timeouts generosos para llamadas lentas
        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
        proxy_send_timeout 30s;
    }

    # Cache de archivos estticos
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 1000;
}
```

### Activar el sitio

```bash
sudo ln -s /etc/nginx/sites-available/round /etc/nginx/sites-enabled/
sudo nginx -t          # Verificar configuracin
sudo systemctl reload nginx
```

---

## 4. Certificado SSL (Let's Encrypt)

Si no tenis certificado SSL propio:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d round.tudominio.com
```

---

## 5. Verificar el despliegue

1. Abrir `https://round.tudominio.com` en el navegador
2. Debe aparecer la pantalla de login
3. Iniciar sesin con credenciales de WiemsPro
4. Verificar que carga la lista de clientes (confirma que el proxy funciona)

### Comprobar el proxy manualmente

```bash
# Desde el propio servidor, probar que el proxy llega a WiemsPro
curl -k -s -o /dev/null -w "%{http_code}" https://round.tudominio.com/wiemspro/account/loginEasy
# Debe devolver 405 (Method Not Allowed) porque es GET en vez de POST, pero confirma que el proxy funciona
```

---

## 6. Actualizaciones

Cuando haya cambios en el cdigo:

```bash
cd /var/www/round
git pull                 # o copiar los archivos nuevos
npm install              # solo si cambiaron dependencias
npm run build            # recompila dist/
# No hace falta reiniciar Nginx - los archivos estticos se sirven directamente
```

---

## Arquitectura

```
Navegador
    |
    |  HTTPS
    v
  Nginx (round.tudominio.com)
    |
    |--- /            --> dist/index.html (SPA React)
    |--- /assets/*    --> dist/assets/* (JS, CSS)
    |--- /wiemspro/*  --> proxy a https://pro.wiemspro.com/wiemspro/*
```

**Importante:** La app NO tiene backend propio. Es una SPA (Single Page Application) que se comunica directamente con la API de WiemsPro a travs del proxy de Nginx. No hay base de datos ni servidor Node en produccin.

---

## Alternativa: Docker

Si prefers usar Docker:

```dockerfile
# Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

Con el `nginx.conf` adaptado (sin SSL, el SSL lo gestiona el balanceador o proxy externo):

```nginx
server {
    listen 80;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /wiemspro/ {
        proxy_pass https://pro.wiemspro.com/wiemspro/;
        proxy_set_header Host pro.wiemspro.com;
        proxy_ssl_server_name on;
        proxy_ssl_verify off;
        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
```

```bash
docker build -t round .
docker run -d -p 80:80 --name round round
```

---

## Notas importantes

- **No hay variables de entorno** que configurar. La URL de la API est hardcodeada como `/wiemspro` (ruta relativa) y el proxy de Nginx la redirige.
- **La sesin se guarda en `sessionStorage`** del navegador. Al cerrar la pestaa se pierde la sesin (esto es intencionado).
- **No se almacena ningn dato en el servidor**. Todo viene de la API de WiemsPro en tiempo real.
- El proxy es **imprescindible** porque la API de WiemsPro no permite CORS desde navegadores.
- Si el certificado SSL de `pro.wiemspro.com` da problemas, la directiva `proxy_ssl_verify off` en Nginx lo soluciona (igual que en desarrollo).

---

## Contacto

Cualquier duda sobre el cdigo fuente, contactar con el equipo de desarrollo.
