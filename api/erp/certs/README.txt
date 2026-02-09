Certificados Sectigo (intermedio + raiz) para cadena SSL completa
=================================================================

El archivo sectigo-dv-r36.pem debe contener DOS bloques de certificado
(en este orden): primero el intermedio, luego el raiz.

1) INTERMEDIO - Sectigo Public Server Authentication CA DV R36
   - El .crt que descargaste de Sectigo (DV TLS Intermediate).
   - Abrelo con Bloc de notas. Copia TODO (-----BEGIN CERTIFICATE----- hasta -----END CERTIFICATE-----).
   - Pegalo en sectigo-dv-r36.pem.

2) RAIZ - Sectigo Public Server Authentication Root R46
   Sin este, Node dara "unable to get issuer certificate".
   - En la misma pagina de Sectigo (Root & Intermediate 2025), descarga el "Root" R46.
   - O descarga PEM desde: https://ssl-tools.net/certificates/2b18947a6a9fc7764fd8b5fb18a863b0c6dac24f.pem
   - Abre ese archivo, copia todo el bloque -----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----.
   - PEGALO A CONTINUACION del intermedio en sectigo-dv-r36.pem (en la misma linea o linea siguiente al END del primero).
   - Guarda. El archivo debe quedar con dos bloques BEGIN/END.

Si el .crt del intermedio es binario (DER): en cmd/powershell:
   openssl x509 -inform DER -in TU_ARCHIVO.crt -out intermedio.pem
   Luego copia el contenido de intermedio.pem a sectigo-dv-r36.pem y anade el raiz como arriba.
