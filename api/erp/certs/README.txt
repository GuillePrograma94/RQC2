Certificado intermedio Sectigo (CA DV R36)
==========================================

1. Abre el archivo .crt que descargaste de Sectigo con Bloc de notas.
2. Si ves texto que empieza por -----BEGIN CERTIFICATE----- :
   - Copia TODO el contenido (desde -----BEGIN hasta -----END CERTIFICATE-----).
   - Abre el archivo sectigo-dv-r36.pem (en esta misma carpeta) con Bloc de notas.
   - Borra la linea "REPLACE_WITH_CONTENT_OF_YOUR_CRT_FILE" y pega lo que copiaste.
   - Guarda sectigo-dv-r36.pem.

3. Si el .crt se abre con caracteres raros (formato binario DER):
   En cmd o PowerShell, en la carpeta donde esta tu .crt:
   openssl x509 -inform DER -in TU_ARCHIVO.crt -out sectigo-dv-r36.pem
   Luego copia el contenido del sectigo-dv-r36.pem generado al archivo
   api/erp/certs/sectigo-dv-r36.pem de este proyecto.

Este certificado se usa para que las peticiones desde Vercel al ERP
puedan verificar la cadena SSL cuando el servidor no envia el intermedio.
