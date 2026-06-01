# Generación de QRs de la app NooFit Pro

Dos QRs:

1. **QR del perfil del trainer** → cifrado.
2. **QR de "Vincular con QR"** → sin cifrar. Su contenido cambia según el flag `Trainer.cedeDatos`.

---

## 1. QR del perfil del trainer

### Contenido

```text
TRAINER;{idTrainer};{managerId};{nombreCompleto}
```

Ejemplo: `TRAINER;13666;5540;Azahara Ramos`

### Cifrado

| Parámetro       | Valor |
| --- | --- |
| Algoritmo       | AES-256-CBC (Rijndael con block size 128 bits) |
| Padding         | PKCS7 |
| Password        | `WiemsPro2023/` |
| Salt            | bytes ASCII de `WiemsPro2023/` |
| KDF             | PBKDF2-HMAC-SHA1, **1000 iteraciones** |
| Key             | primeros 32 bytes del KDF |
| IV              | siguientes 16 bytes del KDF |
| Salida          | Base64 |

### Node.js

```js
const crypto = require('crypto');

const PASSWORD = 'WiemsPro2023/';
const SALT = Buffer.from('WiemsPro2023/', 'ascii');
const derived = crypto.pbkdf2Sync(PASSWORD, SALT, 1000, 48, 'sha1');
const KEY = derived.subarray(0, 32);
const IV  = derived.subarray(32, 48);

function generarQRPerfilTrainer(idTrainer, managerId, nombreCompleto) {
  const texto = `TRAINER;${idTrainer};${managerId};${nombreCompleto}`;
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, IV);
  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return cifrado.toString('base64'); // ← este string es el contenido del QR
}
```

### PHP

```php
<?php
$password = 'WiemsPro2023/';
$salt = 'WiemsPro2023/';
$derived = hash_pbkdf2('sha1', $password, $salt, 1000, 48, true);
$key = substr($derived, 0, 32);
$iv  = substr($derived, 32, 16);

function generarQRPerfilTrainer($idTrainer, $managerId, $nombre, $key, $iv) {
    $texto = "TRAINER;$idTrainer;$managerId;$nombre";
    return base64_encode(openssl_encrypt($texto, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv));
}
```

---

## 2. QR de "Vincular con QR"

Sin cifrado. El contenido depende del flag `Trainer.cedeDatos`:

| `Trainer.cedeDatos` | Contenido del QR |
| --- | --- |
| `true` (defecto) | `TRAINERLINK;{idCliente}` |
| `false` | `cedeDatosFalse:{idCliente}:{dni}:{idTrainer}` |

Ejemplos:

- `TRAINERLINK;12345`
- `cedeDatosFalse:12345:12345678A:13666`

### Node.js

```js
function generarQRVincular(trainer, cliente) {
  if (trainer.cedeDatos === false) {
    return `cedeDatosFalse:${cliente.id}:${cliente.dni}:${trainer.id}`;
  }
  return `TRAINERLINK;${cliente.id}`;
}
```

### PHP

```php
<?php
function generarQRVincular($trainer, $cliente) {
    if ($trainer['cedeDatos'] === false) {
        return "cedeDatosFalse:{$cliente['id']}:{$cliente['dni']}:{$trainer['id']}";
    }
    return "TRAINERLINK;{$cliente['id']}";
}
```

---

## Pintar el QR

Para los dos, el string final se pinta como QR con cualquier librería:

- npm: `qrcode`
- PHP: `endroid/qr-code`
- Servicio público: `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data={textoUrlEncoded}`

---

## Referencias en el código

- Encriptación: [`WiemsProEasy/Utils/Utilidades.cs`](../WiemsProEasy/Utils/Utilidades.cs)
- QR del perfil del trainer: [`WiemsProEasy/ViewModels/GenerateQRViewModel.cs`](../WiemsProEasy/ViewModels/GenerateQRViewModel.cs)
- QR de Vincular con QR: [`WiemsProEasy/ViewModels/QRSeniorViewModel.cs`](../WiemsProEasy/ViewModels/QRSeniorViewModel.cs)
