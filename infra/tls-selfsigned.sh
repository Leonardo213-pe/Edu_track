#!/bin/sh
# Generates a local self-signed certificate on first start (volume tls_certs). Local Compose only: NOT a trusted
# certificate; production must mount an institutional/ACME certificate at the same paths.
set -eu
dir=/etc/nginx/tls
if [ ! -s "$dir/server.crt" ] || [ ! -s "$dir/server.key" ]; then
  openssl req -x509 -newkey rsa:2048 -sha256 -days 397 -nodes \
    -keyout "$dir/server.key" -out "$dir/server.crt" \
    -subj "/O=EduTrack local (autofirmado)/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
  chmod 600 "$dir/server.key"
  echo "tls-selfsigned: generated local self-signed certificate"
fi
